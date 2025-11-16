import type { Message, MessageEntity } from "typegram";
import {
  loadBanSettingsByChatId,
  loadGeneralSettingsByChatId,
  loadSilenceSettingsByChatId,
  loadLimitSettingsByChatId,
  type GroupBanSettingsRecord,
  type BanRuleSetting,
  type GroupGeneralSettingsRecord,
  type SilenceSettingsRecord,
  type GroupCountLimitSettingsRecord,
} from "../../server/db/groupSettingsRepository.js";
import type { GroupChatContext, ProcessingAction } from "./types.js";
import { ensureActions } from "./utils.js";
import { logger } from "../../server/utils/logger.js";
import { getState } from "../state.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const BAN_CACHE_TTL_MS = Number.parseInt(process.env.BAN_SETTINGS_CACHE_MS ?? "45000", 10);
const GENERAL_CACHE_TTL_MS = Number.parseInt(process.env.GENERAL_SETTINGS_CACHE_MS ?? "45000", 10);
const SILENCE_CACHE_TTL_MS = Number.parseInt(process.env.SILENCE_SETTINGS_CACHE_MS ?? "45000", 10);
const LIMITS_CACHE_TTL_MS = Number.parseInt(process.env.LIMIT_SETTINGS_CACHE_MS ?? "45000", 10);

type CachedEntry = {
  expiresAt: number;
  settings: GroupBanSettingsRecord | null;
};

const banCache = new Map<string, CachedEntry>();

type CachedGeneral = { expiresAt: number; settings: GroupGeneralSettingsRecord | null };
type CachedSilence = { expiresAt: number; settings: SilenceSettingsRecord | null };
type CachedLimits = { expiresAt: number; settings: GroupCountLimitSettingsRecord | null };

const generalCache = new Map<string, CachedGeneral>();
const silenceCache = new Map<string, CachedSilence>();
const limitsCache = new Map<string, CachedLimits>();

// Per-user, per-chat counters for rate and duplicates
const rateHistory = new Map<string, number[]>();
const recentTexts = new Map<string, { text: string; at: number }[]>();

type MessageFacts = {
  text: string;
  textLower: string;
  entities: MessageEntity[];
  hasLink: boolean;
  links: string[];
  domains: string[];
  hasForward: boolean;
  hasForwardChannel: boolean;
  hasSticker: boolean;
  hasPhoto: boolean;
  hasVideo: boolean;
  hasVideoNote: boolean;
  hasVoice: boolean;
  hasAudio: boolean;
  hasDocument: boolean;
  hasAnimation: boolean;
  hasCaption: boolean;
  hasUsername: boolean;
  hasHashtag: boolean;
  hasEmoji: boolean;
  isEmojiOnly: boolean;
  hasContact: boolean;
  hasLocation: boolean;
  hasPoll: boolean;
  hasGame: boolean;
  hasInlineKeyboard: boolean;
  hasBotCommand: boolean;
  hasCaptionlessMedia: boolean;
  hasLatin: boolean;
  hasPersian: boolean;
  hasCyrillic: boolean;
  hasChinese: boolean;
  fromBot: boolean;
  viaBot: boolean;
  isReply: boolean;
  isCrossReply: boolean;
};

export async function primeBanSettings(ctx: GroupChatContext): Promise<void> {
  if (!ctx.chat) {
    return;
  }

  ctx.processing ??= {};
  const chatId = ctx.chat.id.toString();
  const groupRecord = getState().groups[chatId];
  ctx.processing.groupManaged = groupRecord ? groupRecord.managed !== false : true;

  if (!databaseAvailable || ctx.processing.groupManaged === false) {
    ctx.processing.banSettings = null;
    return;
  }

  await resolveBanSettings(ctx);
}

export async function evaluateBanGuards(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  if (ctx.processing?.groupManaged === false) {
    return [];
  }

  if (!databaseAvailable || !ctx.chat || !ctx.message) {
    return [];
  }

  const settings = await resolveBanSettings(ctx);
  if (!settings) {
    return [];
  }

  const chatId = ctx.chat.id.toString();
  const general = await getGeneralSettings(chatId);
  const silence = await getSilenceSettings(chatId);
  const limits = await getLimitSettings(chatId);

  // Silence windows enforcement (admins exempt)
  if (shouldSilenceChat(silence)) {
    const isAdmin = await isAdminOrOwner(ctx);
    if (!isAdmin) {
      const actions: ProcessingAction[] = [
        { type: "delete_message", messageId: ctx.message!.message_id, reason: "silence window" },
      ];
      return ensureActions(actions);
    }
  }

  const message = ctx.message as Message;
  const facts = collectFacts(message);
  const timestampSeconds = message.date ?? Math.floor(Date.now() / 1000);

  const triggered: string[] = [];
  const blockedLinks = getBlockedLinks(settings, facts);

  checkRule(settings, "banLinks", facts, timestampSeconds, () => {
    if (blockedLinks.length > 0) {
      triggered.push("banLinks");
    }
  });

  checkRule(settings, "banDomains", facts, timestampSeconds, () => {
    if (blockedLinks.length > 0) {
      triggered.push("banDomains");
    }
  });

  checkRule(settings, "banBots", facts, timestampSeconds, () => {
    if (facts.fromBot) {
      triggered.push("banBots");
    }
  });

  checkRule(settings, "banBotInviters", facts, timestampSeconds, () => {
    if (facts.viaBot && !facts.fromBot) {
      triggered.push("banBotInviters");
    }
  });

  checkRule(settings, "banTextPatterns", facts, timestampSeconds, () => {
    if (matchesTextPatterns(facts.text, settings)) {
      triggered.push("banTextPatterns");
    }
  });

  checkRule(settings, "banForward", facts, timestampSeconds, () => {
    if (facts.hasForward) {
      triggered.push("banForward");
    }
  });

  checkRule(settings, "banForwardChannels", facts, timestampSeconds, () => {
    if (facts.hasForwardChannel) {
      triggered.push("banForwardChannels");
    }
  });

  checkRule(settings, "banStickers", facts, timestampSeconds, () => {
    if (facts.hasSticker) {
      triggered.push("banStickers");
    }
  });

  checkRule(settings, "banPhotos", facts, timestampSeconds, () => {
    if (facts.hasPhoto) {
      triggered.push("banPhotos");
    }
  });

  checkRule(settings, "banVideos", facts, timestampSeconds, () => {
    if (facts.hasVideo || facts.hasVideoNote) {
      triggered.push("banVideos");
    }
  });

  checkRule(settings, "banVoice", facts, timestampSeconds, () => {
    if (facts.hasVoice) {
      triggered.push("banVoice");
    }
  });

  checkRule(settings, "banAudio", facts, timestampSeconds, () => {
    if (facts.hasAudio) {
      triggered.push("banAudio");
    }
  });

  checkRule(settings, "banFiles", facts, timestampSeconds, () => {
    if (facts.hasDocument || facts.hasAnimation) {
      triggered.push("banFiles");
    }
  });

  checkRule(settings, "banApps", facts, timestampSeconds, () => {
    if (facts.viaBot) {
      triggered.push("banApps");
    }
  });

  checkRule(settings, "banGif", facts, timestampSeconds, () => {
    if (facts.hasAnimation) {
      triggered.push("banGif");
    }
  });

  checkRule(settings, "banPolls", facts, timestampSeconds, () => {
    if (facts.hasPoll) {
      triggered.push("banPolls");
    }
  });

  checkRule(settings, "banInlineKeyboards", facts, timestampSeconds, () => {
    if (facts.hasInlineKeyboard) {
      triggered.push("banInlineKeyboards");
    }
  });

  checkRule(settings, "banGames", facts, timestampSeconds, () => {
    if (facts.hasGame) {
      triggered.push("banGames");
    }
  });

  checkRule(settings, "banSlashCommands", facts, timestampSeconds, () => {
    if (facts.hasBotCommand) {
      triggered.push("banSlashCommands");
    }
  });

  checkRule(settings, "banCaptionless", facts, timestampSeconds, () => {
    if (facts.hasCaptionlessMedia) {
      triggered.push("banCaptionless");
    }
  });

  checkRule(settings, "banUsernames", facts, timestampSeconds, () => {
    if (facts.hasUsername) {
      triggered.push("banUsernames");
    }
  });

  checkRule(settings, "banHashtags", facts, timestampSeconds, () => {
    if (facts.hasHashtag) {
      triggered.push("banHashtags");
    }
  });

  checkRule(settings, "banEmojis", facts, timestampSeconds, () => {
    if (facts.hasEmoji) {
      triggered.push("banEmojis");
    }
  });

  checkRule(settings, "banEmojiOnly", facts, timestampSeconds, () => {
    if (facts.isEmojiOnly) {
      triggered.push("banEmojiOnly");
    }
  });

  checkRule(settings, "banLocation", facts, timestampSeconds, () => {
    if (facts.hasLocation) {
      triggered.push("banLocation");
    }
  });

  checkRule(settings, "banPhones", facts, timestampSeconds, () => {
    if (facts.hasContact) {
      triggered.push("banPhones");
    }
  });

  checkRule(settings, "banLatin", facts, timestampSeconds, () => {
    if (facts.hasLatin) {
      triggered.push("banLatin");
    }
  });

  checkRule(settings, "banPersian", facts, timestampSeconds, () => {
    if (facts.hasPersian) {
      triggered.push("banPersian");
    }
  });

  checkRule(settings, "banCyrillic", facts, timestampSeconds, () => {
    if (facts.hasCyrillic) {
      triggered.push("banCyrillic");
    }
  });

  checkRule(settings, "banChinese", facts, timestampSeconds, () => {
    if (facts.hasChinese) {
      triggered.push("banChinese");
    }
  });

  checkRule(settings, "banUserReplies", facts, timestampSeconds, () => {
    if (facts.isReply) {
      triggered.push("banUserReplies");
    }
  });

  checkRule(settings, "banCrossReplies", facts, timestampSeconds, () => {
    if (facts.isCrossReply) {
      triggered.push("banCrossReplies");
    }
  });

  if (!triggered.length) {
    // Apply limit settings if ban rules not triggered
    const limitActions = applyLimitSettings(limits, ctx, facts);
    if (limitActions.length) {
      return ensureActions(limitActions);
    }
    return [];
  }

  const reason = `Ban settings triggered: ${triggered.join(", ")}`;
  const messageId = message.message_id;
  const userId = message.from?.id;

  const logDetails: Record<string, unknown> = {
    chatId,
    userId,
    rules: triggered,
  };
  if (blockedLinks.length > 0) {
    logDetails.blockedLinks = blockedLinks;
  }

  const actions: ProcessingAction[] = [
    {
      type: "delete_message",
      messageId,
      reason,
    },
    {
      type: "log",
      level: "info",
      message: "ban settings triggered",
      details: logDetails,
    },
  ];

  if (userId) {
    actions.push({
      type: "warn_member",
      userId,
      reason,
      severity: "medium",
    });
  }

  return ensureActions(actions);
}

async function resolveBanSettings(ctx: GroupChatContext): Promise<GroupBanSettingsRecord | null> {
  ctx.processing ??= {};
  if (ctx.processing.banSettings !== undefined) {
    return ctx.processing.banSettings ?? null;
  }

  if (!ctx.chat) {
    ctx.processing.banSettings = null;
    return null;
  }

  const chatId = ctx.chat.id.toString();
  const settings = await getBanSettings(chatId);
  ctx.processing.banSettings = settings;
  return settings;
}

async function getBanSettings(chatId: string): Promise<GroupBanSettingsRecord | null> {
  const cached = banCache.get(chatId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.settings;
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    banCache.set(chatId, { settings, expiresAt: now + BAN_CACHE_TTL_MS });
    return settings;
  } catch (error) {
    logger.debug("ban settings unavailable for chat", { chatId, error });
    banCache.set(chatId, { settings: null, expiresAt: now + BAN_CACHE_TTL_MS });
    return null;
  }
}

async function getGeneralSettings(chatId: string): Promise<GroupGeneralSettingsRecord | null> {
  const cached = generalCache.get(chatId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.settings;
  try {
    const s = await loadGeneralSettingsByChatId(chatId);
    generalCache.set(chatId, { settings: s, expiresAt: now + GENERAL_CACHE_TTL_MS });
    return s;
  } catch {
    generalCache.set(chatId, { settings: null, expiresAt: now + GENERAL_CACHE_TTL_MS });
    return null;
  }
}

async function getSilenceSettings(chatId: string): Promise<SilenceSettingsRecord | null> {
  const cached = silenceCache.get(chatId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.settings;
  try {
    const s = await loadSilenceSettingsByChatId(chatId);
    silenceCache.set(chatId, { settings: s, expiresAt: now + SILENCE_CACHE_TTL_MS });
    return s;
  } catch {
    silenceCache.set(chatId, { settings: null, expiresAt: now + SILENCE_CACHE_TTL_MS });
    return null;
  }
}

async function getLimitSettings(chatId: string): Promise<GroupCountLimitSettingsRecord | null> {
  const cached = limitsCache.get(chatId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.settings;
  try {
    const s = await loadLimitSettingsByChatId(chatId);
    limitsCache.set(chatId, { settings: s, expiresAt: now + LIMITS_CACHE_TTL_MS });
    return s;
  } catch {
    limitsCache.set(chatId, { settings: null, expiresAt: now + LIMITS_CACHE_TTL_MS });
    return null;
  }
}

function shouldSilenceChat(silence: SilenceSettingsRecord | null): boolean {
  if (!silence) return false;
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const inWindow = (w: { enabled: boolean; start: string; end: string }) => {
    if (!w?.enabled) return false;
    const s = parseTimeToMinutes(w.start);
    const e = parseTimeToMinutes(w.end);
    if (s === null || e === null) return false;
    if (s <= e) return minutes >= s && minutes <= e;
    return minutes >= s || minutes <= e;
  };
  if (silence.emergencyLock?.enabled) return true;
  return inWindow(silence.window1) || inWindow(silence.window2) || inWindow(silence.window3);
}

async function isAdminOrOwner(ctx: GroupChatContext): Promise<boolean> {
  try {
    const userId = (ctx.message as any)?.from?.id;
    if (!userId) return false;
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}

function applyLimitSettings(
  limits: GroupCountLimitSettingsRecord | null,
  ctx: GroupChatContext,
  facts: MessageFacts,
): ProcessingAction[] {
  if (!limits) return [];
  const actions: ProcessingAction[] = [];
  const userId = (ctx.message as any)?.from?.id as number | undefined;
  const chatId = ctx.chat.id.toString();
  const messageId = (ctx.message as any)?.message_id as number | undefined;
  const words = facts.text.trim().length ? facts.text.trim().split(/\s+/).length : 0;

  if (limits.minWordsPerMessage > 0 && words > 0 && words < limits.minWordsPerMessage) {
    actions.push({ type: "delete_message", messageId, reason: "min words limit" });
  }
  if (limits.maxWordsPerMessage > 0 && words > limits.maxWordsPerMessage) {
    actions.push({ type: "delete_message", messageId, reason: "max words limit" });
  }

  if (userId && limits.messagesPerWindow > 0 && limits.windowMinutes > 0) {
    const key = `${chatId}:${userId}:rate`;
    const now = Date.now();
    const windowMs = limits.windowMinutes * 60 * 1000;
    const list = (rateHistory.get(key) ?? []).filter((t) => t >= now - windowMs);
    list.push(now);
    rateHistory.set(key, list);
    if (list.length > limits.messagesPerWindow) {
      actions.push({ type: "delete_message", messageId, reason: "rate limit" });
    }
  }

  if (userId && limits.duplicateMessages > 0 && limits.duplicateWindowMinutes > 0 && facts.text.trim().length > 0) {
    const key = `${chatId}:${userId}:dups`;
    const now = Date.now();
    const windowMs = limits.duplicateWindowMinutes * 60 * 1000;
    const arr = (recentTexts.get(key) ?? []).filter((e) => e.at >= now - windowMs);
    arr.push({ text: facts.text.trim(), at: now });
    recentTexts.set(key, arr);
    const sameCount = arr.filter((e) => e.text === facts.text.trim()).length;
    if (sameCount > limits.duplicateMessages) {
      actions.push({ type: "delete_message", messageId, reason: "duplicate message" });
    }
  }

  return actions;
}

function checkRule(
  settings: GroupBanSettingsRecord,
  key: keyof GroupBanSettingsRecord["rules"],
  facts: MessageFacts,
  timestampSeconds: number,
  onActive: () => void,
): void {
  const rule = settings.rules[key];
  if (!isRuleActive(rule, timestampSeconds)) {
    return;
  }
  onActive();
}

function isRuleActive(rule: BanRuleSetting | undefined, timestampSeconds: number): boolean {
  if (!rule || !rule.enabled) {
    return false;
  }

  if (!rule.schedule || rule.schedule.mode === "all") {
    return true;
  }

  const currentMinutes = getMinutesOfDay(timestampSeconds);
  const startMinutes = parseTimeToMinutes(rule.schedule.start);
  const endMinutes = parseTimeToMinutes(rule.schedule.end);

  if (startMinutes === null || endMinutes === null) {
    return true;
  }

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

function getMinutesOfDay(timestampSeconds: number): number {
  const date = new Date(timestampSeconds * 1000);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function parseTimeToMinutes(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return Math.max(0, Math.min(23, hours)) * 60 + Math.max(0, Math.min(59, minutes));
}

function collectFacts(message: Message): MessageFacts {
  const text = (("text" in message && message.text) || ("caption" in message && message.caption) || "") ?? "";
  const entities =
    (("entities" in message && message.entities) ||
      ("caption_entities" in message && message.caption_entities) ||
      []) ?? [];

  const textLower = text.toLowerCase();

  const links: string[] = [];
  const domains: string[] = [];
  const seenLinks = new Set<string>();

  const addLink = (raw: string | undefined) => {
    if (!raw) {
      return;
    }
    const normalized = normalizeUrl(raw);
    if (!normalized) {
      return;
    }
    if (seenLinks.has(normalized)) {
      return;
    }
    seenLinks.add(normalized);
    links.push(normalized);
    const domain = extractDomain(normalized);
    if (domain) {
      domains.push(domain);
    } else {
      domains.push("");
    }
  };

  for (const entity of entities) {
    if (entity.type === "url" && typeof entity.offset === "number" && typeof entity.length === "number") {
      const snippet = text.slice(entity.offset, entity.offset + entity.length);
      addLink(snippet);
    } else if (entity.type === "text_link") {
      // typegram typings don't expose `url` on text_link in some versions; access safely
      const link = (entity as { url?: string }).url;
      addLink(link);
    }
  }

  const looseUrlPattern = /\b(?:https?:\/\/|www\.)[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
  let match: RegExpExecArray | null;
  while ((match = looseUrlPattern.exec(text)) !== null) {
    addLink(match[0]);
  }

  const hasLink =
    links.length > 0 ||
    entities.some((entity) => entity.type === "url" || entity.type === "text_link") ||
    /https?:\/\/\S+/i.test(textLower);

  const hasUsername =
    entities.some((entity) => entity.type === "mention" || entity.type === "text_mention") || /@\w{3,32}/.test(text);

  const hasHashtag = entities.some((entity) => entity.type === "hashtag");
  const hasBotCommand = entities.some((entity) => entity.type === "bot_command");
  const hasEmoji = /\p{Extended_Pictographic}/u.test(text);
  const isEmojiOnly = hasEmoji && text.replace(/\p{Extended_Pictographic}|\s/gu, "").length === 0;

  const forwardFromChat = (message as { forward_from_chat?: { type?: string } }).forward_from_chat;
  const hasForward = Boolean((message as { forward_date?: unknown }).forward_date);
  const hasForwardChannel = Boolean(hasForward && forwardFromChat && forwardFromChat.type === "channel");
  const hasSticker = "sticker" in message && Boolean(message.sticker);
  const hasPhoto = "photo" in message && Array.isArray(message.photo) && message.photo.length > 0;
  const hasVideo = "video" in message && Boolean(message.video);
  const hasVideoNote = "video_note" in message && Boolean((message as { video_note?: unknown }).video_note);
  const hasVoice = "voice" in message && Boolean(message.voice);
  const hasAudio = "audio" in message && Boolean(message.audio);
  const hasDocument = "document" in message && Boolean(message.document);
  const hasAnimation = "animation" in message && Boolean(message.animation);
  const hasCaption = Boolean(("caption" in message && message.caption) || ("caption_entities" in message && message.caption_entities));
  const hasContact = "contact" in message && Boolean(message.contact);
  const hasLocation = ("location" in message && Boolean(message.location)) || ("venue" in message && Boolean((message as { venue?: unknown }).venue));
  const hasPoll = "poll" in message && Boolean((message as { poll?: unknown }).poll);
  const hasGame = "game" in message && Boolean((message as { game?: unknown }).game);
  const hasInlineKeyboard =
    "reply_markup" in message &&
    Boolean((message as { reply_markup?: { inline_keyboard?: unknown } }).reply_markup?.inline_keyboard);
  const hasCaptionlessMedia = (hasPhoto || hasVideo || hasDocument || hasAnimation || hasVideoNote) && !hasCaption;

  const hasLatin = /\p{Script=Latin}/u.test(text);
  const hasPersian = /[\u0600-\u06FF]/u.test(text);
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(text);
  const hasChinese = /\p{Script=Han}/u.test(text);

  const fromBot = Boolean((message.from as { is_bot?: boolean } | undefined)?.is_bot);
  const viaBot = Boolean((message as { via_bot?: unknown }).via_bot);
  const replyToMessage = (message as { reply_to_message?: Message }).reply_to_message;
  const isReply = Boolean(replyToMessage);
  const isCrossReply = Boolean(isReply && replyToMessage?.from && message.from && replyToMessage.from.id !== message.from.id);

  return {
    text,
    textLower,
    entities,
    hasLink,
    links,
    domains,
    hasForward,
    hasForwardChannel,
    hasSticker,
    hasPhoto,
    hasVideo,
    hasVideoNote,
    hasVoice,
    hasAudio,
    hasDocument,
    hasAnimation,
    hasCaption,
    hasUsername,
    hasHashtag,
    hasEmoji,
    isEmojiOnly,
    hasContact,
    hasLocation,
    hasPoll,
    hasGame,
    hasInlineKeyboard,
    hasBotCommand,
    hasCaptionlessMedia,
    hasLatin,
    hasPersian,
    hasCyrillic,
    hasChinese,
    fromBot,
    viaBot,
    isReply,
    isCrossReply,
  };
}

function getBlockedLinks(settings: GroupBanSettingsRecord, facts: MessageFacts): string[] {
  if (facts.links.length === 0) {
    return [];
  }
  const whitelist = normalizeTokenList(settings.whitelist);
  const blacklist = normalizeTokenList(settings.blacklist);
  const blocked: string[] = [];

  facts.links.forEach((link, index) => {
    const domain = facts.domains[index] ?? extractDomain(link) ?? "";
    const candidates = [link.toLowerCase(), domain.toLowerCase()].filter(Boolean);

    const isWhitelisted =
      whitelist.length > 0 && candidates.some((value) => whitelist.some((allowed) => value.includes(allowed)));
    if (isWhitelisted) {
      return;
    }

    const isBlacklisted =
      blacklist.length > 0 && candidates.some((value) => blacklist.some((blockedToken) => value.includes(blockedToken)));

    if (!isWhitelisted || isBlacklisted) {
      blocked.push(link);
    }
  });

  return blocked;
}

function normalizeTokenList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function safeCompilePattern(raw: string): RegExp | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length > 2) {
    try {
      return new RegExp(trimmed.slice(1, -1), "i");
    } catch {
      return null;
    }
  }
  try {
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, "i");
  } catch {
    return null;
  }
}

function matchesTextPatterns(text: string, settings: GroupBanSettingsRecord): boolean {
  const patterns = settings.blacklist;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => {
    const regex = safeCompilePattern(pattern);
    return regex ? regex.test(text) : false;
  });
}

function normalizeUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) {
    return null;
  }
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) {
    value = `https://${value}`;
  }
  try {
    const url = new URL(value);
    return url.href;
  } catch {
    return null;
  }
}

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}


