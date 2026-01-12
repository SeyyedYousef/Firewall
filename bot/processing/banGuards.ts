import type { Message, MessageEntity } from "typegram";
import {
  loadBanSettingsByChatId,
  loadGeneralSettingsByChatId,
  loadSilenceSettingsByChatId,
  loadLimitSettingsByChatId,
  loadCustomTextSettingsByChatId,
  type GroupBanSettingsRecord,
  type BanRuleSetting,
  type GroupGeneralSettingsRecord,
  type SilenceSettingsRecord,
  type GroupCountLimitSettingsRecord,
} from "../../server/db/groupSettingsRepository.js";
import type { GroupChatContext, ProcessingAction } from "./types.js";
import { ensureActions } from "./utils.js";
import { logger } from "../../server/utils/logger.js";
import { getState, hasCustomSchedule, hasVoteMute, hasExtraSilenceWindows, hasAutoWarning, hasAutoDelete } from "../state.js";
import { renderTemplate } from "../templating.js";

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

// Per-chat cache for current silence status to detect start/end transitions
const silenceStatus = new Map<string, boolean>();

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
  isAutomaticForward: boolean;
  isLinkedChannelPost: boolean;
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

  // Inline resolveBanSettings logic
  if (ctx.processing.banSettings !== undefined) {
    return;
  }

  try {
    const cached = banCache.get(chatId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      ctx.processing.banSettings = cached.settings;
      return;
    }

    const settings = await loadBanSettingsByChatId(chatId);
    banCache.set(chatId, { settings, expiresAt: now + BAN_CACHE_TTL_MS });
    ctx.processing.banSettings = settings;
  } catch (error) {
    logger.debug("ban settings unavailable for chat", { chatId, error });
    banCache.set(chatId, { settings: null, expiresAt: Date.now() + BAN_CACHE_TTL_MS });
    ctx.processing.banSettings = null;
  }
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

  // Track silence state transitions for this chat
  const wasSilent = silenceStatus.get(chatId) ?? false;
  const isSilent = shouldSilenceChat(silence, general?.timezone, chatId);
  silenceStatus.set(chatId, isSilent);

  const transitionActions = await buildSilenceTransitionActions(ctx, silence, general, wasSilent, isSilent);

  // Silence windows enforcement (admins exempt)
  if (isSilent) {
    const isAdmin = await isAdminOrOwner(ctx);
    if (!isAdmin) {
      const actions: ProcessingAction[] = [
        ...transitionActions,
        { type: "delete_message", messageId: ctx.message!.message_id, reason: "silence window" },
      ];
      return ensureActions(actions);
    }
  }

  const message = ctx.message as Message;
  const facts = collectFacts(message);
  const timestampSeconds = message.date ?? Math.floor(Date.now() / 1000);

  if (facts.isLinkedChannelPost) {
    logger.debug("skipping moderation for linked channel auto-forward", { chatId });
    return [];
  }

  const triggered: string[] = [];
  const blockedLinks = getBlockedLinks(settings, facts);

  checkRule(settings, "banLinks", facts, timestampSeconds, () => {
    if (blockedLinks.length > 0) {
      triggered.push("banLinks");
    }
  }, chatId);

  checkRule(settings, "banDomains", facts, timestampSeconds, () => {
    if (blockedLinks.length > 0) {
      triggered.push("banDomains");
    }
  }, chatId);

  checkRule(settings, "banBots", facts, timestampSeconds, () => {
    if (facts.fromBot) {
      triggered.push("banBots");
    }
  }, chatId);

  checkRule(settings, "banBotInviters", facts, timestampSeconds, () => {
    if (facts.viaBot && !facts.fromBot) {
      triggered.push("banBotInviters");
    }
  }, chatId);

  checkRule(settings, "banTextPatterns", facts, timestampSeconds, () => {
    if (matchesTextPatterns(facts.text, settings)) {
      triggered.push("banTextPatterns");
    }
  }, chatId);
  // Enforce Required keywords (whitelist) on text content:
  // If whitelist is non-empty and the text does NOT contain any of them, treat as violation.
  if (settings.whitelist && settings.whitelist.length > 0) {
    const textLower = facts.textLower;
    const required = normalizeTokenList(settings.whitelist);
    const hasRequired = required.some((token) => textLower.includes(token));
    if (!hasRequired) {
      triggered.push("requiredKeywordsMissing");
    }
  }

  checkRule(settings, "banForward", facts, timestampSeconds, () => {
    if (facts.hasForward) {
      triggered.push("banForward");
    }
  }, chatId);

  checkRule(settings, "banForwardChannels", facts, timestampSeconds, () => {
    if (facts.hasForwardChannel) {
      triggered.push("banForwardChannels");
    }
  }, chatId);

  checkRule(settings, "banStickers", facts, timestampSeconds, () => {
    if (facts.hasSticker) {
      triggered.push("banStickers");
    }
  }, chatId);

  checkRule(settings, "banPhotos", facts, timestampSeconds, () => {
    if (facts.hasPhoto) {
      triggered.push("banPhotos");
    }
  }, chatId);

  checkRule(settings, "banVideos", facts, timestampSeconds, () => {
    if (facts.hasVideo || facts.hasVideoNote) {
      triggered.push("banVideos");
    }
  }, chatId);

  checkRule(settings, "banVoice", facts, timestampSeconds, () => {
    if (facts.hasVoice) {
      triggered.push("banVoice");
    }
  }, chatId);

  checkRule(settings, "banAudio", facts, timestampSeconds, () => {
    if (facts.hasAudio) {
      triggered.push("banAudio");
    }
  }, chatId);

  checkRule(settings, "banFiles", facts, timestampSeconds, () => {
    if (facts.hasDocument || facts.hasAnimation) {
      triggered.push("banFiles");
    }
  }, chatId);

  checkRule(settings, "banApps", facts, timestampSeconds, () => {
    if (facts.viaBot) {
      triggered.push("banApps");
    }
  }, chatId);

  checkRule(settings, "banGif", facts, timestampSeconds, () => {
    if (facts.hasAnimation) {
      triggered.push("banGif");
    }
  }, chatId);

  checkRule(settings, "banPolls", facts, timestampSeconds, () => {
    if (facts.hasPoll) {
      triggered.push("banPolls");
    }
  }, chatId);

  checkRule(settings, "banInlineKeyboards", facts, timestampSeconds, () => {
    if (facts.hasInlineKeyboard) {
      triggered.push("banInlineKeyboards");
    }
  }, chatId);

  checkRule(settings, "banGames", facts, timestampSeconds, () => {
    if (facts.hasGame) {
      triggered.push("banGames");
    }
  }, chatId);

  checkRule(settings, "banSlashCommands", facts, timestampSeconds, () => {
    if (facts.hasBotCommand) {
      triggered.push("banSlashCommands");
    }
  }, chatId);

  checkRule(settings, "banCaptionless", facts, timestampSeconds, () => {
    if (facts.hasCaptionlessMedia) {
      triggered.push("banCaptionless");
    }
  }, chatId);

  checkRule(settings, "banUsernames", facts, timestampSeconds, () => {
    if (facts.hasUsername) {
      triggered.push("banUsernames");
    }
  }, chatId);

  checkRule(settings, "banHashtags", facts, timestampSeconds, () => {
    if (facts.hasHashtag) {
      triggered.push("banHashtags");
    }
  }, chatId);

  checkRule(settings, "banEmojis", facts, timestampSeconds, () => {
    if (facts.hasEmoji) {
      triggered.push("banEmojis");
    }
  }, chatId);

  checkRule(settings, "banEmojiOnly", facts, timestampSeconds, () => {
    if (facts.isEmojiOnly) {
      triggered.push("banEmojiOnly");
    }
  }, chatId);

  checkRule(settings, "banLocation", facts, timestampSeconds, () => {
    if (facts.hasLocation) {
      triggered.push("banLocation");
    }
  }, chatId);

  checkRule(settings, "banPhones", facts, timestampSeconds, () => {
    if (facts.hasContact) {
      triggered.push("banPhones");
    }
  }, chatId);

  checkRule(settings, "banLatin", facts, timestampSeconds, () => {
    if (facts.hasLatin) {
      triggered.push("banLatin");
    }
  }, chatId);

  checkRule(settings, "banPersian", facts, timestampSeconds, () => {
    if (facts.hasPersian) {
      triggered.push("banPersian");
    }
  }, chatId);

  checkRule(settings, "banCyrillic", facts, timestampSeconds, () => {
    if (facts.hasCyrillic) {
      triggered.push("banCyrillic");
    }
  }, chatId);

  checkRule(settings, "banChinese", facts, timestampSeconds, () => {
    if (facts.hasChinese) {
      triggered.push("banChinese");
    }
  }, chatId);

  checkRule(settings, "banUserReplies", facts, timestampSeconds, () => {
    if (facts.isReply) {
      triggered.push("banUserReplies");
    }
  }, chatId);

  checkRule(settings, "banCrossReplies", facts, timestampSeconds, () => {
    if (facts.isCrossReply) {
      triggered.push("banCrossReplies");
    }
  }, chatId);

  // ========== FLOOD PROTECTION ==========
  // Check if user is flooding (many messages in short time)
  // Admins are exempt from flood protection
  const rawSettings = settings as unknown as Record<string, unknown>;
  const rulesRaw = rawSettings.rules as Record<string, unknown> | undefined;
  if (rulesRaw?.blockFlood === true) {
    const userId = message.from?.id;
    if (userId) {
      const isAdmin = await isAdminOrOwner(ctx);
      if (!isAdmin) {
        const floodKey = `${chatId}:${userId}:flood`;
        const now = Date.now();
        const floodWindowMs = 10 * 1000; // 10 seconds
        const floodThreshold = 5; // 5 messages in 10 seconds

        const floodList = (rateHistory.get(floodKey) ?? []).filter((t) => t >= now - floodWindowMs);
        floodList.push(now);
        rateHistory.set(floodKey, floodList);

        if (floodList.length > floodThreshold) {
          triggered.push("flood");
          logger.info("Flood detected", { chatId, userId, messageCount: floodList.length });
        }
      }
    }
  }

  // ========== MANDATORY JOIN ENFORCEMENT ==========
  // Check if mandatory join is enabled and user hasn't joined required channels
  if (rawSettings.mandatoryJoinEnabled === true) {
    const mandatoryChannels = Array.isArray(rawSettings.mandatoryChannels)
      ? rawSettings.mandatoryChannels as string[]
      : [];

    if (mandatoryChannels.length > 0) {
      const userId = message.from?.id;
      if (userId) {
        const isAdmin = await isAdminOrOwner(ctx);
        if (!isAdmin) {
          for (const channel of mandatoryChannels) {
            try {
              // Check if user is member of the channel
              const channelId = channel.startsWith("@") ? channel : `@${channel}`;
              const member = await ctx.telegram.getChatMember(channelId, userId);
              if (member.status === "left" || member.status === "kicked") {
                triggered.push("mandatoryJoin");
                logger.info("Mandatory join violated", { chatId, userId, channel });
                break;
              }
            } catch (error) {
              // If we can't check, skip (bot may not be admin in channel)
              logger.debug("Failed to check mandatory join channel membership", { channel, error });
            }
          }
        }
      }
    }
  }

  // ========== TEMP MEDIA SCHEDULING ==========
  // Schedule media for auto-deletion if temp media is enabled
  if (rawSettings.tempMediaEnabled === true) {
    const tempMediaSettings = rawSettings.tempMedia as Record<string, unknown> | undefined;
    const deleteMinutes = (tempMediaSettings?.deleteMinutes as number) ?? 20;

    // Check if this message contains media that should be auto-deleted
    let shouldScheduleDelete = false;
    if (tempMediaSettings) {
      if ((tempMediaSettings.gif !== false) && facts.hasAnimation) shouldScheduleDelete = true;
      if ((tempMediaSettings.sticker !== false) && facts.hasSticker) shouldScheduleDelete = true;
      if ((tempMediaSettings.video !== false) && (facts.hasVideo || facts.hasVideoNote)) shouldScheduleDelete = true;
      if ((tempMediaSettings.photo !== false) && facts.hasPhoto) shouldScheduleDelete = true;
      if ((tempMediaSettings.file === true) && facts.hasDocument) shouldScheduleDelete = true;
      if ((tempMediaSettings.audio === true) && (facts.hasAudio || facts.hasVoice)) shouldScheduleDelete = true;
    }

    // Check user exemption
    if (shouldScheduleDelete) {
      const userType = (tempMediaSettings?.userType as string) ?? "nonadmin";
      if (userType === "nonadmin") {
        const isAdmin = await isAdminOrOwner(ctx);
        if (isAdmin) {
          shouldScheduleDelete = false;
        }
      }
    }

    if (shouldScheduleDelete) {
      const messageId = message.message_id;
      const deleteDelayMs = deleteMinutes * 60 * 1000;

      // Schedule deletion using setTimeout
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
          logger.info("Temp media auto-deleted", { chatId, messageId, deleteMinutes });
        } catch (error) {
          logger.debug("Failed to auto-delete temp media", { chatId, messageId, error });
        }
      }, deleteDelayMs);

      logger.debug("Scheduled temp media for deletion", { chatId, messageId, deleteMinutes });
    }
  }

  if (!triggered.length) {
    // Apply limit settings if ban rules not triggered
    const limitActions = applyLimitSettings(limits, ctx, facts);
    if (limitActions.length) {
      return ensureActions([...transitionActions, ...limitActions]);
    }
    return ensureActions(transitionActions);
  }

  const reason = `Ban settings triggered (${triggered.join(", ")})`;
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
    ...transitionActions,
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

    // Track violation for cross-group tabchi detection
    try {
      const { analyzeAndFlagIfTabchi } = await import("../../server/services/tabchiService.js");
      const username = (message.from as any)?.username;
      const firstName = (message.from as any)?.first_name;

      // This will check cross-group patterns and flag as tabchi if threshold reached
      const flagged = await analyzeAndFlagIfTabchi(userId.toString(), username, firstName);
      if (flagged) {
        logger.info("user flagged as tabchi based on cross-group violations", {
          chatId,
          userId,
          triggeredRules: triggered,
        });
      }
    } catch (error) {
      logger.debug("failed to analyze for tabchi", { chatId, userId, error });
    }
    // ========== ANTI TABCHI REDESIGN LOGIC ==========
    if (rawSettings.antiTabchi) {
      const at = rawSettings.antiTabchi as Record<string, unknown>;
      const tabchiLock = at.tabchiLock !== false;
      const adLock = at.adLock !== false;
      const bioLock = at.bioLock !== false;
      const actionMode = (at.actionMode as string) ?? "mute";

      // Only check if at least one lock is active and we have a user
      if ((tabchiLock || adLock || bioLock) && userId) {
        const isAdmin = await isAdminOrOwner(ctx);
        if (!isAdmin) {
          let isTabchi = false;
          let tabchiReason = "";

          // Check Bio/Name for ads if Bio Lock is on
          if (bioLock) {
            // We might need to fetch full user info to see bio, 
            // but efficiently we check Name first or if we have cached info.
            // For now, let's check basic patterns in First/Last/Username if available
            const pattern = /(https?:\/\/|t\.me\/|@|joinchat|link)/i;
            const user = message.from as any;
            if (user.first_name && pattern.test(user.first_name)) { isTabchi = true; tabchiReason = "Ad in Name"; }
            if (user.last_name && pattern.test(user.last_name)) { isTabchi = true; tabchiReason = "Ad in Name"; }
            // Note: Real bio check typically requires getChat wrapper or MTProto, omitting for pure BotAPI speed unless deep check needed
          }

          // Check Ad Lock (similar to banAdvertiser but separate toggle)
          if (adLock && !isTabchi) {
            // Reuse advertiser detection logic if possible, or simple heuristic
            if (triggered.includes("banAdvertiser") || triggered.includes("banLinks")) {
              isTabchi = true;
              tabchiReason = "Advertising behavior";
            }
          }

          // Check Tabchi Lock (Cross-group behavior)
          if (tabchiLock && !isTabchi) {
            // Reuse existing tabchi detection if implemented or placeholder
            if (triggered.includes("banTabchi")) {
              isTabchi = true;
              tabchiReason = "Tabchi behavior detected";
            }
          }

          if (isTabchi) {
            logger.info("Anti-Tabchi Triggered", { chatId, userId, reason: tabchiReason });

            // Execute Penalty
            const actionTime = (at.actionTime as string) ?? "entry";
            const performAction = true; // Simulating 'entry' vs 'message' immediate check

            if (performAction) {
              if (actionMode === "ban") {
                actions.push({ type: "ban_member", userId, reason: `Anti-Tabchi: ${tabchiReason}` });
              } else {
                actions.push({ type: "restrict_member", userId, durationSeconds: 0, reason: `Anti-Tabchi: ${tabchiReason}` }); // Mute
              }

              // Detection Message
              const seconds = (at.detectionMessageSeconds as number) ?? 150;
              const text = `🚫 <b>Anti-Tabchi Detection</b>\n\nUser <a href="tg://user?id=${userId}">${message.from?.first_name}</a> detected as Tabchi.\nReason: ${tabchiReason}\nAction: ${actionMode}`;

              actions.push({
                type: "send_message",
                text,
                parseMode: "HTML",
                threadId: (message as any).message_thread_id,
              });

              // We could schedule deletion of this report message too if the system supported self-delete actions easily here
              // For now, simpler implementation
            }
          }
        }
      }
    }

    // ========== LOCK LIMIT LOGIC ==========
    if (rawSettings.lockLimit) {
      const ll = rawSettings.lockLimit as Record<string, unknown>;
      // Check enabled
      if (ll.enabled === true) {
        const isAdmin = await isAdminOrOwner(ctx);
        if (!isAdmin && userId) {
          const maxCount = (ll.maxCount as number) ?? 5;
          const limitSeconds = (ll.limitSeconds as number) ?? 60;
          const reportDeleteSeconds = (ll.reportDeleteSeconds as number) ?? 60;

          const key = `locklimit:${chatId}:${userId}`;
          const now = Date.now();
          const windowMs = limitSeconds * 1000;

          // Update history
          const history = (rateHistory.get(key) ?? []).filter(t => t > now - windowMs);
          history.push(now);
          rateHistory.set(key, history);

          if (history.length > maxCount) {
            logger.info("Lock Limit Triggered", { chatId, userId, count: history.length });
            const userName = (message.from as any)?.first_name ?? "User";
            const text = `🚫 <b>Lock Limit Reached</b>\n\nUser <a href="tg://user?id=${userId}">${userName}</a> has been limited for sending too many messages.`;

            // 1. Delete the triggering message
            actions.push({ type: "delete_message", messageId, reason: "Lock Limit" });

            // 2. Restrict the user (Mute)
            actions.push({ type: "restrict_member", userId, durationSeconds: 0, reason: "Lock Limit Exceeded" });

            // 3. Send Report (Direct send to handle auto-delete timing)
            if (reportDeleteSeconds > 0) {
              // Side-effect send to allow scheduling delete
              ctx.telegram.sendMessage(chatId, text, {
                parse_mode: "HTML",
                message_thread_id: (message as any).message_thread_id
              }).then(msg => {
                setTimeout(() => {
                  ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => { });
                }, reportDeleteSeconds * 1000);
              }).catch(err => logger.error("Failed to send lock limit report", { err }));
            } else {
              actions.push({ type: "send_message", text, parseMode: "HTML", threadId: (message as any).message_thread_id });
            }
          }
        }
      }
    }

    return ensureActions(actions);
  }

  // If userId is undefined, still return actions collected so far
  return ensureActions(actions);

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

  function getCurrentMinutesInTimezone(timezone?: string): number {
    const now = new Date();
    const tz = typeof timezone === "string" && timezone.trim().length > 0 ? timezone.trim() : "UTC";
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        hour: "numeric",
        minute: "numeric",
      });
      const parts = formatter.formatToParts(now);
      const hourPart = parts.find((part) => part.type === "hour");
      const minutePart = parts.find((part) => part.type === "minute");
      const hours = Number(hourPart?.value ?? "0");
      const minutes = Number(minutePart?.value ?? "0");
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        const h = now.getUTCHours();
        const m = now.getUTCMinutes();
        return h * 60 + m;
      }
      return hours * 60 + minutes;
    } catch {
      const h = now.getUTCHours();
      const m = now.getUTCMinutes();
      return h * 60 + m;
    }
  }

  type ActiveSilenceWindow =
    | { kind: "emergency" }
    | { kind: "window"; windowKey: "window1" | "window2" | "window3"; start: string; end: string };

  function getActiveSilenceWindow(
    silence: SilenceSettingsRecord | null,
    timezone?: string,
    chatId?: string,
  ): ActiveSilenceWindow | null {
    if (!silence) return null;

    if (silence.emergencyLock?.enabled) {
      return { kind: "emergency" };
    }

    const minutes = getCurrentMinutesInTimezone(timezone);
    const inWindow = (w: { enabled: boolean; start: string; end: string }) => {
      if (!w?.enabled) return false;
      const s = parseTimeToMinutes(w.start);
      const e = parseTimeToMinutes(w.end);
      if (s === null || e === null) return false;
      if (s === e) return false;
      if (s < e) return minutes >= s && minutes <= e;
      return minutes >= s || minutes <= e;
    };

    if (inWindow(silence.window1)) {
      return { kind: "window", windowKey: "window1", start: silence.window1.start, end: silence.window1.end };
    }

    // PREMIUM FEATURE: Extra silence windows (window2, window3) only for Premium
    // Free users only get window1
    if (chatId && hasExtraSilenceWindows(chatId)) {
      if (inWindow(silence.window2)) {
        return { kind: "window", windowKey: "window2", start: silence.window2.start, end: silence.window2.end };
      }
      if (inWindow(silence.window3)) {
        return { kind: "window", windowKey: "window3", start: silence.window3.start, end: silence.window3.end };
      }
    }

    return null;
  }

  function shouldSilenceChat(silence: SilenceSettingsRecord | null, timezone?: string, chatId?: string): boolean {
    return getActiveSilenceWindow(silence, timezone, chatId) !== null;
  }

  function getNextSilenceStart(silence: SilenceSettingsRecord | null): string | null {
    if (!silence) return null;
    const candidates = [silence.window1, silence.window2, silence.window3].filter((w) => w?.enabled);
    if (candidates.length === 0) {
      return null;
    }

    let bestMinutes: number | null = null;
    let bestStart: string | null = null;

    for (const w of candidates) {
      const minutes = parseTimeToMinutes(w.start);
      if (minutes === null) {
        continue;
      }
      if (bestMinutes === null || minutes < bestMinutes) {
        bestMinutes = minutes;
        bestStart = w.start;
      }
    }

    return bestStart;
  }

  async function buildSilenceTransitionActions(
    ctx: GroupChatContext,
    silence: SilenceSettingsRecord | null,
    general: GroupGeneralSettingsRecord | null,
    wasSilent: boolean,
    isSilent: boolean,
  ): Promise<ProcessingAction[]> {
    const actions: ProcessingAction[] = [];

    if (!silence || wasSilent === isSilent) {
      return actions;
    }

    const chatId = ctx.chat.id.toString();
    let customTexts: Awaited<ReturnType<typeof loadCustomTextSettingsByChatId>> | null = null;
    try {
      customTexts = await loadCustomTextSettingsByChatId(chatId);
    } catch (error) {
      logger.debug("failed to load custom text settings for silence messages", { chatId, error });
      return actions;
    }

    const threadId = (ctx.message as any)?.message_thread_id as number | undefined;

    if (isSilent && !wasSilent) {
      // Quiet hours just started
      const active = getActiveSilenceWindow(silence, general?.timezone, chatId);
      let starttime = "";
      let endtime = "";
      if (active && active.kind === "window") {
        starttime = active.start ?? "";
        endtime = active.end ?? "";
      }

      const template = (customTexts.silenceStartMessage ?? "").trim();
      if (template) {
        const text = renderTemplate(template, { starttime, endtime });
        if (text.trim().length > 0) {
          actions.push({
            type: "send_message",
            text,
            parseMode: "HTML",
            threadId,
            attachPromoButton: true,
          });
        }
      }
    } else if (!isSilent && wasSilent) {
      // Quiet hours just ended
      const nextStart = getNextSilenceStart(silence) ?? "";
      const template = (customTexts.silenceEndMessage ?? "").trim();
      if (template) {
        const text = renderTemplate(template, { starttime: nextStart });
        if (text.trim().length > 0) {
          actions.push({
            type: "send_message",
            text,
            parseMode: "HTML",
            threadId,
            attachPromoButton: true,
          });
        }
      }
    }

    return actions;
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

    if (messageId !== undefined) {
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
    }

    return actions;
  }

  function checkRule(
    settings: GroupBanSettingsRecord,
    key: keyof GroupBanSettingsRecord["rules"],
    facts: MessageFacts,
    timestampSeconds: number,
    onActive: () => void,
    chatId?: string,
  ): void {
    const rule = settings.rules[key];
    if (!isRuleActive(rule, timestampSeconds, chatId)) {
      return;
    }
    onActive();
  }

  function isRuleActive(rule: BanRuleSetting | undefined, timestampSeconds: number, chatId?: string): boolean {
    if (!rule || !rule.enabled) {
      return false;
    }

    // PREMIUM FEATURE: Custom schedule is only for Premium
    // Free users get "all time" mode regardless of schedule setting
    const canUseSchedule = chatId ? hasCustomSchedule(chatId) : false;

    if (!rule.schedule || rule.schedule.mode === "all" || !canUseSchedule) {
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
      entities.some((entity) => entity.type === "mention" || entity.type === "text_mention") ||
      /@[a-zA-Z][a-zA-Z0-9_]{4,31}\b/.test(text);

    const hasHashtag = entities.some((entity) => entity.type === "hashtag");
    const hasBotCommand = entities.some((entity) => entity.type === "bot_command");
    const hasEmoji = /\p{Extended_Pictographic}/u.test(text);
    const isEmojiOnly = hasEmoji && text.replace(/\p{Extended_Pictographic}|\s/gu, "").length === 0;

    const forwardFromChat = (message as { forward_from_chat?: { type?: string } }).forward_from_chat;
    const hasForward = Boolean((message as { forward_date?: unknown }).forward_date);
    const hasForwardChannel = Boolean(hasForward && forwardFromChat && forwardFromChat.type === "channel");
    const isAutomaticForward = Boolean((message as { is_automatic_forward?: boolean }).is_automatic_forward);
    const isLinkedChannelPost = Boolean(isAutomaticForward && hasForwardChannel);
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
      isAutomaticForward,
      isLinkedChannelPost,
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
}
