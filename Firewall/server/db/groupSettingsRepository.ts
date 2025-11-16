import { Prisma } from "@prisma/client";
import { prisma } from "./client.js";
import { logger } from "../utils/logger.js";

export const BAN_RULE_KEYS = [
  "banLinks",
  "banBots",
  "banBotInviters",
  "banDomains",
  "banUsernames",
  "banHashtags",
  "banTextPatterns",
  "banForward",
  "banForwardChannels",
  "banPhotos",
  "banVideos",
  "banStickers",
  "banEmojis",
  "banEmojiOnly",
  "banLocation",
  "banPhones",
  "banAudio",
  "banVoice",
  "banFiles",
  "banApps",
  "banGif",
  "banPolls",
  "banInlineKeyboards",
  "banGames",
  "banSlashCommands",
  "banCaptionless",
  "banLatin",
  "banPersian",
  "banCyrillic",
  "banChinese",
  "banUserReplies",
  "banCrossReplies",
] as const;

export type BanRuleKey = (typeof BAN_RULE_KEYS)[number];
export type TimeRangeMode = "all" | "custom";

export type TimeRangeSetting = {
  mode: TimeRangeMode;
  start: string;
  end: string;
};

export type BanRuleSetting = {
  enabled: boolean;
  schedule: TimeRangeSetting;
};

export type GroupBanSettingsRecord = {
  rules: Record<BanRuleKey, BanRuleSetting>;
  blacklist: string[];
  whitelist: string[];
};

export type AutoWarningPenalty = "delete" | "mute" | "kick";

export type AutoWarningConfigRecord = {
  threshold: number;
  retentionDays: number;
  penalty: AutoWarningPenalty;
  schedule: TimeRangeSetting;
};

export type GroupGeneralSettingsRecord = {
  timezone: string;
  welcomeEnabled: boolean;
  welcomeSchedule: TimeRangeSetting;
  voteMuteEnabled: boolean;
  warningEnabled: boolean;
  warningSchedule: TimeRangeSetting;
  silentModeEnabled: boolean;
  autoDeleteEnabled: boolean;
  autoDeleteDelayMinutes: number;
  countAdminViolationsEnabled: boolean;
  countAdminsOnly: boolean;
  deleteAdminViolations: boolean;
  userVerificationEnabled: boolean;
  userVerificationSchedule: TimeRangeSetting;
  disablePublicCommands: boolean;
  disablePublicCommandsSchedule: TimeRangeSetting;
  removeJoinLeaveMessages: boolean;
  removeJoinLeaveSchedule: TimeRangeSetting;
  autoWarningEnabled: boolean;
  autoWarning: AutoWarningConfigRecord;
  defaultPenalty: AutoWarningPenalty;
};

export type SilenceWindowSettingRecord = {
  enabled: boolean;
  start: string;
  end: string;
};

export type SilenceSettingsRecord = {
  emergencyLock: SilenceWindowSettingRecord;
  window1: SilenceWindowSettingRecord;
  window2: SilenceWindowSettingRecord;
  window3: SilenceWindowSettingRecord;
};

export type MandatoryMembershipSettingsRecord = {
  forcedInviteCount: number;
  forcedInviteResetDays: number;
  mandatoryChannels: string[];
};

export type CustomTextSettingsRecord = {
  welcomeMessage: string;
  rulesMessage: string;
  silenceStartMessage: string;
  silenceEndMessage: string;
  warningMessage: string;
  forcedInviteMessage: string;
  mandatoryChannelMessage: string;
  promoButtonEnabled: boolean;
  promoButtonText: string;
  promoButtonUrl: string;
};

export type GroupCountLimitSettingsRecord = {
  minWordsPerMessage: number;
  maxWordsPerMessage: number;
  messagesPerWindow: number;
  windowMinutes: number;
  duplicateMessages: number;
  duplicateWindowMinutes: number;
};

export class GroupNotFoundError extends Error {
  constructor(groupId: string) {
    super(`Group (${groupId}) was not found`);
    this.name = "GroupNotFoundError";
  }
}

async function ensureGroupIdFromChatId(chatId: string): Promise<string> {
  const normalized = chatId.trim();
  if (!normalized) {
    throw new GroupNotFoundError(chatId);
  }

  const existing = await prisma.group.findUnique({
    where: { telegramChatId: normalized },
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }

  try {
    const created = await prisma.group.create({
      data: {
        telegramChatId: normalized,
        title: `Group ${normalized}`,
        status: "unknown",
        creditBalance: new Prisma.Decimal(0),
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    logger.error("failed to ensure group exists for settings access", { chatId: normalized, error });
    throw new GroupNotFoundError(chatId);
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_ACTIVE_RULES = new Set<BanRuleKey>([
  "banLinks",
  "banDomains",
  "banBots",
  "banBotInviters",
  "banForward",
  "banForwardChannels",
]);

function createDefaultTimeRange(): TimeRangeSetting {
  return { mode: "all", start: "00:00", end: "23:59" };
}

function createDefaultRuleSetting(key: BanRuleKey): BanRuleSetting {
  return {
    enabled: DEFAULT_ACTIVE_RULES.has(key),
    schedule: createDefaultTimeRange(),
  };
}

function createDefaultBanSettings(): GroupBanSettingsRecord {
  const rules = {} as Record<BanRuleKey, BanRuleSetting>;
  BAN_RULE_KEYS.forEach((key) => {
    rules[key] = createDefaultRuleSetting(key);
  });

  return {
    rules,
    blacklist: ["spam", "promo", "http", "lottery", "casino"],
    whitelist: ["support", "docs", "faq", "help"],
  };
}

function sanitizeTime(value: unknown, fallback: string): string {
  if (typeof value === "string" && TIME_PATTERN.test(value)) {
    return value;
  }
  return fallback;
}

function sanitizeTimeRange(value: unknown, fallback: TimeRangeSetting): TimeRangeSetting {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }
  const candidate = value as Partial<TimeRangeSetting>;
  const mode: TimeRangeMode = candidate.mode === "custom" ? "custom" : "all";
  const start = sanitizeTime(candidate.start, fallback.start);
  const end = sanitizeTime(candidate.end, fallback.end);
  return { mode, start, end };
}

function sanitizeRuleSetting(value: unknown, fallback: BanRuleSetting): BanRuleSetting {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }
  const candidate = value as Partial<BanRuleSetting>;
  const enabled = typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled;
  const schedule = sanitizeTimeRange(candidate.schedule, fallback.schedule);
  return { enabled, schedule };
}

function sanitizeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return [...new Set(items)];
}

function normalizeBanSettings(input: unknown): GroupBanSettingsRecord {
  const base = createDefaultBanSettings();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return base;
  }

  const candidate = input as Partial<GroupBanSettingsRecord>;
  const rulesInput = candidate.rules;
  if (rulesInput && typeof rulesInput === "object" && !Array.isArray(rulesInput)) {
    BAN_RULE_KEYS.forEach((key) => {
      const fallback = base.rules[key];
      const value = (rulesInput as Record<string, unknown>)[key];
      base.rules[key] = sanitizeRuleSetting(value, fallback);
    });
  }

  base.blacklist = sanitizeStringList(candidate.blacklist, base.blacklist);
  base.whitelist = sanitizeStringList(candidate.whitelist, base.whitelist);

  return base;
}

export async function loadBanSettings(groupId: string): Promise<GroupBanSettingsRecord> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { banSettings: true },
  });

  if (!group) {
    throw new GroupNotFoundError(groupId);
  }

  return normalizeBanSettings(group.banSettings ?? undefined);
}

export async function saveBanSettings(groupId: string, settings: unknown): Promise<GroupBanSettingsRecord> {
  const normalized = normalizeBanSettings(settings);
  try {
    await prisma.group.update({
      where: { id: groupId },
      data: {
        banSettings: normalized as unknown as Prisma.JsonObject,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new GroupNotFoundError(groupId);
    }
    logger.error("saveBanSettings failed", { groupId, error });
    throw error;
  }
  return normalized;
}

function createDefaultGeneralSettings(): GroupGeneralSettingsRecord {
  return {
    timezone: "UTC",
    welcomeEnabled: true,
    welcomeSchedule: createDefaultTimeRange(),
    voteMuteEnabled: false,
    warningEnabled: true,
    warningSchedule: createDefaultTimeRange(),
    silentModeEnabled: false,
    autoDeleteEnabled: true,
    autoDeleteDelayMinutes: 60,
    countAdminViolationsEnabled: false,
    countAdminsOnly: false,
    deleteAdminViolations: false,
    userVerificationEnabled: false,
    userVerificationSchedule: createDefaultTimeRange(),
    disablePublicCommands: false,
    disablePublicCommandsSchedule: createDefaultTimeRange(),
    removeJoinLeaveMessages: true,
    removeJoinLeaveSchedule: createDefaultTimeRange(),
    autoWarningEnabled: true,
    autoWarning: {
      threshold: 3,
      retentionDays: 14,
      penalty: "mute",
      schedule: createDefaultTimeRange(),
    },
    defaultPenalty: "delete",
  };
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return fallback;
}

function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
}

const AUTO_WARNING_PENALTIES: AutoWarningPenalty[] = ["delete", "mute", "kick"];

function sanitizePenalty(value: unknown, fallback: AutoWarningPenalty): AutoWarningPenalty {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (AUTO_WARNING_PENALTIES.includes(normalized as AutoWarningPenalty)) {
      return normalized as AutoWarningPenalty;
    }
  }
  return fallback;
}

function normalizeGeneralSettings(input: unknown): GroupGeneralSettingsRecord {
  const base = createDefaultGeneralSettings();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return base;
  }

  const candidate = input as Partial<GroupGeneralSettingsRecord>;
  const result: GroupGeneralSettingsRecord = { ...base };

  result.timezone = sanitizeString((candidate as { timezone?: unknown }).timezone, base.timezone);

  const booleanKeys: Array<keyof GroupGeneralSettingsRecord> = [
    "welcomeEnabled",
    "voteMuteEnabled",
    "warningEnabled",
    "silentModeEnabled",
    "autoDeleteEnabled",
    "countAdminViolationsEnabled",
    "countAdminsOnly",
    "deleteAdminViolations",
    "userVerificationEnabled",
    "disablePublicCommands",
    "removeJoinLeaveMessages",
    "autoWarningEnabled",
  ];

  booleanKeys.forEach((key) => {
    const value = (candidate as Record<string, unknown>)[key as string];
  (result as any)[key] = sanitizeBoolean(value, base[key as keyof typeof base] as unknown as boolean);
  });

  const scheduleKeys: Array<keyof GroupGeneralSettingsRecord> = [
    "welcomeSchedule",
    "warningSchedule",
    "userVerificationSchedule",
    "disablePublicCommandsSchedule",
    "removeJoinLeaveSchedule",
  ];

  scheduleKeys.forEach((key) => {
    const value = (candidate as Record<string, unknown>)[key as string];
    (result as any)[key] = sanitizeTimeRange(value, base[key as keyof typeof base] as unknown as TimeRangeSetting);
  });

  result.autoDeleteDelayMinutes = sanitizeNumber(candidate.autoDeleteDelayMinutes, base.autoDeleteDelayMinutes, {
    min: 0,
    max: 10080,
    round: "floor",
  });

  const autoWarningCandidate = (candidate as { autoWarning?: unknown }).autoWarning;
  if (autoWarningCandidate && typeof autoWarningCandidate === "object" && !Array.isArray(autoWarningCandidate)) {
    const warn = autoWarningCandidate as Partial<AutoWarningConfigRecord>;
    const threshold = sanitizeNumber(warn.threshold, base.autoWarning.threshold, { min: 1, max: 100, round: "floor" });
    const retentionDays = sanitizeNumber(warn.retentionDays, base.autoWarning.retentionDays, {
      min: 1,
      max: 365,
      round: "floor",
    });
    const penalty = sanitizePenalty(warn.penalty, base.autoWarning.penalty);
    const schedule = sanitizeTimeRange(warn.schedule, base.autoWarning.schedule);

    result.autoWarning = {
      threshold,
      retentionDays,
      penalty,
      schedule,
    };
  }

  result.defaultPenalty = sanitizePenalty(candidate.defaultPenalty, base.defaultPenalty);

  return result;
}

export async function loadGroupGeneralSettings(groupId: string): Promise<GroupGeneralSettingsRecord> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { generalSettings: true },
  });

  if (!group) {
    throw new GroupNotFoundError(groupId);
  }

  return normalizeGeneralSettings(group.generalSettings ?? undefined);
}

export async function saveGroupGeneralSettings(
  groupId: string,
  settings: unknown,
): Promise<GroupGeneralSettingsRecord> {
  const normalized = normalizeGeneralSettings(settings);
  try {
    await prisma.group.update({
      where: { id: groupId },
      data: {
        generalSettings: normalized as unknown as Prisma.JsonObject,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new GroupNotFoundError(groupId);
    }
    logger.error("saveGroupGeneralSettings failed", { groupId, error });
    throw error;
  }
  return normalized;
}

function createDefaultSilenceSettings(): SilenceSettingsRecord {
  const window = (): SilenceWindowSettingRecord => ({
    enabled: false,
    start: "00:00",
    end: "00:00",
  });
  return {
    emergencyLock: { enabled: false, start: "00:00", end: "00:00" },
    window1: window(),
    window2: window(),
    window3: window(),
  };
}

function sanitizeSilenceWindow(value: unknown, fallback: SilenceWindowSettingRecord): SilenceWindowSettingRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }
  const candidate = value as Partial<SilenceWindowSettingRecord>;
  const enabled = sanitizeBoolean(candidate.enabled, fallback.enabled);
  const start = sanitizeTime(candidate.start, fallback.start);
  const end = sanitizeTime(candidate.end, fallback.end);
  return { enabled, start, end };
}

function normalizeSilenceSettings(input: unknown): SilenceSettingsRecord {
  const base = createDefaultSilenceSettings();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return base;
  }
  const candidate = input as Partial<SilenceSettingsRecord>;

  return {
    emergencyLock: sanitizeSilenceWindow(candidate.emergencyLock, base.emergencyLock),
    window1: sanitizeSilenceWindow(candidate.window1, base.window1),
    window2: sanitizeSilenceWindow(candidate.window2, base.window2),
    window3: sanitizeSilenceWindow(candidate.window3, base.window3),
  };
}

export async function loadSilenceSettings(groupId: string): Promise<SilenceSettingsRecord> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { silenceSettings: true },
  });

  if (!group) {
    throw new GroupNotFoundError(groupId);
  }

  return normalizeSilenceSettings(group.silenceSettings ?? undefined);
}

export async function saveSilenceSettings(
  groupId: string,
  settings: unknown,
): Promise<SilenceSettingsRecord> {
  const normalized = normalizeSilenceSettings(settings);
  try {
    await prisma.group.update({
      where: { id: groupId },
      data: {
        silenceSettings: normalized as unknown as Prisma.JsonObject,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new GroupNotFoundError(groupId);
    }
    logger.error("saveSilenceSettings failed", { groupId, error });
    throw error;
  }
  return normalized;
}

function createDefaultMandatorySettings(): MandatoryMembershipSettingsRecord {
  return {
    forcedInviteCount: 0,
    forcedInviteResetDays: 0,
    mandatoryChannels: [],
  };
}

function sanitizeChannelList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const sanitized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return [...new Set(sanitized)];
}

function normalizeMandatorySettings(input: unknown): MandatoryMembershipSettingsRecord {
  const base = createDefaultMandatorySettings();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return base;
  }
  const candidate = input as Partial<MandatoryMembershipSettingsRecord>;
  const forcedInviteCount = sanitizeNumber(candidate.forcedInviteCount, base.forcedInviteCount, {
    min: 0,
    max: 100,
    round: "floor",
  });
  const forcedInviteResetDays = sanitizeNumber(candidate.forcedInviteResetDays, base.forcedInviteResetDays, {
    min: 0,
    max: 365,
    round: "floor",
  });
  const mandatoryChannels = sanitizeChannelList(candidate.mandatoryChannels, base.mandatoryChannels);

  return {
    forcedInviteCount,
    forcedInviteResetDays,
    mandatoryChannels,
  };
}

export async function loadMandatoryMembershipSettings(
  groupId: string,
): Promise<MandatoryMembershipSettingsRecord> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { mandatorySettings: true },
  });

  if (!group) {
    throw new GroupNotFoundError(groupId);
  }

  return normalizeMandatorySettings(group.mandatorySettings ?? undefined);
}

export async function saveMandatoryMembershipSettings(
  groupId: string,
  settings: unknown,
): Promise<MandatoryMembershipSettingsRecord> {
  const normalized = normalizeMandatorySettings(settings);
  try {
    await prisma.group.update({
      where: { id: groupId },
      data: {
        mandatorySettings: normalized as unknown as Prisma.JsonObject,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new GroupNotFoundError(groupId);
    }
    logger.error("saveMandatoryMembershipSettings failed", { groupId, error });
    throw error;
  }
  return normalized;
}

const DEFAULT_CUSTOM_TEXTS: CustomTextSettingsRecord = {
  welcomeMessage: "Hello {user}!\nWelcome to {group}.\nPlease read the next message to learn the rules.",
  rulesMessage: "{user}, these guidelines keep {group} safe. Read them carefully before you start chatting.",
  silenceStartMessage:
    "Quiet hours are now active.\nMessages are paused from {starttime} until {endtime}.\nThanks for keeping the chat tidy.",
  silenceEndMessage: "Quiet hours have finished.\nThe next quiet period starts at {starttime}.",
  warningMessage:
    "Reason: {reason}\nPenalty: {penalty}\n\nWarning {user_warnings} of {warnings_count}\nEach warning expires after {warningstime} days.",
  forcedInviteMessage:
    "{user}\nYou need to invite {number} new member(s) before you can send messages.\nYou have invited {added} so far.",
  mandatoryChannelMessage:
    "Please join the required channel(s) below before sending messages:\n{channel_names}",
  promoButtonEnabled: false,
  promoButtonText: "Read more",
  promoButtonUrl: "https://t.me/tgfirewall",
};

function sanitizeUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed;
}

function normalizeCustomTextSettings(input: unknown): CustomTextSettingsRecord {
  const base = DEFAULT_CUSTOM_TEXTS;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...base };
  }
  const candidate = input as Partial<CustomTextSettingsRecord>;
  return {
    welcomeMessage: sanitizeText(candidate.welcomeMessage, base.welcomeMessage),
    rulesMessage: sanitizeText(candidate.rulesMessage, base.rulesMessage),
    silenceStartMessage: sanitizeText(candidate.silenceStartMessage, base.silenceStartMessage),
    silenceEndMessage: sanitizeText(candidate.silenceEndMessage, base.silenceEndMessage),
    warningMessage: sanitizeText(candidate.warningMessage, base.warningMessage),
    forcedInviteMessage: sanitizeText(candidate.forcedInviteMessage, base.forcedInviteMessage),
    mandatoryChannelMessage: sanitizeText(candidate.mandatoryChannelMessage, base.mandatoryChannelMessage),
    promoButtonEnabled: sanitizeBoolean(candidate.promoButtonEnabled, base.promoButtonEnabled),
    promoButtonText: sanitizeText(candidate.promoButtonText, base.promoButtonText),
    promoButtonUrl: sanitizeUrl(candidate.promoButtonUrl, base.promoButtonUrl),
  };
}

export async function loadCustomTextSettings(groupId: string): Promise<CustomTextSettingsRecord> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { customTextSettings: true },
  });

  if (!group) {
    throw new GroupNotFoundError(groupId);
  }

  return normalizeCustomTextSettings(group.customTextSettings ?? undefined);
}

export async function saveCustomTextSettings(
  groupId: string,
  settings: unknown,
): Promise<CustomTextSettingsRecord> {
  const normalized = normalizeCustomTextSettings(settings);
  try {
    await prisma.group.update({
      where: { id: groupId },
      data: {
        customTextSettings: normalized as unknown as Prisma.JsonObject,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new GroupNotFoundError(groupId);
    }
    logger.error("saveCustomTextSettings failed", { groupId, error });
    throw error;
  }
  return normalized;
}

export async function loadBanSettingsByChatId(chatId: string): Promise<GroupBanSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return loadBanSettings(groupId);
}

export async function loadGeneralSettingsByChatId(chatId: string): Promise<GroupGeneralSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return loadGroupGeneralSettings(groupId);
}

export async function saveGeneralSettingsByChatId(
  chatId: string,
  settings: unknown,
): Promise<GroupGeneralSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return saveGroupGeneralSettings(groupId, settings);
}

export async function loadSilenceSettingsByChatId(chatId: string): Promise<SilenceSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return loadSilenceSettings(groupId);
}

export async function loadLimitSettingsByChatId(chatId: string): Promise<GroupCountLimitSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return loadGroupCountLimitSettings(groupId);
}

export async function saveBanSettingsByChatId(
  chatId: string,
  settings: unknown,
): Promise<GroupBanSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return saveBanSettings(groupId, settings);
}

export async function saveSilenceSettingsByChatId(
  chatId: string,
  settings: unknown,
): Promise<SilenceSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return saveSilenceSettings(groupId, settings);
}

export async function loadMandatoryMembershipSettingsByChatId(
  chatId: string,
): Promise<MandatoryMembershipSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return loadMandatoryMembershipSettings(groupId);
}

export async function saveMandatoryMembershipSettingsByChatId(
  chatId: string,
  settings: unknown,
): Promise<MandatoryMembershipSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return saveMandatoryMembershipSettings(groupId, settings);
}

export async function loadCustomTextSettingsByChatId(chatId: string): Promise<CustomTextSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return loadCustomTextSettings(groupId);
}

export async function saveCustomTextSettingsByChatId(
  chatId: string,
  settings: unknown,
): Promise<CustomTextSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return saveCustomTextSettings(groupId, settings);
}

export async function saveGroupCountLimitSettingsByChatId(
  chatId: string,
  settings: unknown,
): Promise<GroupCountLimitSettingsRecord> {
  const groupId = await ensureGroupIdFromChatId(chatId);
  return saveGroupCountLimitSettings(groupId, settings);
}

function createDefaultLimitSettings(): GroupCountLimitSettingsRecord {
  return {
    minWordsPerMessage: 0,
    maxWordsPerMessage: 250,
    messagesPerWindow: 5,
    windowMinutes: 1,
    duplicateMessages: 3,
    duplicateWindowMinutes: 10,
  };
}

type SanitizeNumberOptions = {
  min?: number;
  max?: number;
  round?: "floor" | "ceil";
};

function sanitizeNumber(value: unknown, fallback: number, options: SanitizeNumberOptions = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  let next = value;
  if (options.round === "floor") {
    next = Math.floor(next);
  } else if (options.round === "ceil") {
    next = Math.ceil(next);
  }
  if (typeof options.min === "number" && next < options.min) {
    next = options.min;
  }
  if (typeof options.max === "number" && next > options.max) {
    next = options.max;
  }
  return next;
}

function normalizeLimitSettings(input: unknown): GroupCountLimitSettingsRecord {
  const base = createDefaultLimitSettings();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return base;
  }
  const candidate = input as Partial<GroupCountLimitSettingsRecord>;

  const minWords = sanitizeNumber(candidate.minWordsPerMessage, base.minWordsPerMessage, {
    min: 0,
    max: 1000,
    round: "floor",
  });
  let maxWords = sanitizeNumber(candidate.maxWordsPerMessage, base.maxWordsPerMessage, {
    min: minWords > 0 ? minWords : 1,
    max: 5000,
    round: "floor",
  });
  if (maxWords < minWords && minWords > 0) {
    maxWords = minWords;
  }

  const messagesPerWindow = sanitizeNumber(candidate.messagesPerWindow, base.messagesPerWindow, {
    min: 1,
    max: 1000,
    round: "floor",
  });
  const windowMinutes = sanitizeNumber(candidate.windowMinutes, base.windowMinutes, {
    min: 1,
    max: 1440,
    round: "floor",
  });
  const duplicateMessages = sanitizeNumber(candidate.duplicateMessages, base.duplicateMessages, {
    min: 1,
    max: 100,
    round: "floor",
  });
  const duplicateWindowMinutes = sanitizeNumber(candidate.duplicateWindowMinutes, base.duplicateWindowMinutes, {
    min: 1,
    max: 1440,
    round: "floor",
  });

  return {
    minWordsPerMessage: minWords,
    maxWordsPerMessage: maxWords,
    messagesPerWindow,
    windowMinutes,
    duplicateMessages,
    duplicateWindowMinutes,
  };
}

export async function loadGroupCountLimitSettings(groupId: string): Promise<GroupCountLimitSettingsRecord> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { limitSettings: true },
  });

  if (!group) {
    throw new GroupNotFoundError(groupId);
  }

  return normalizeLimitSettings(group.limitSettings ?? undefined);
}

export async function saveGroupCountLimitSettings(
  groupId: string,
  settings: unknown,
): Promise<GroupCountLimitSettingsRecord> {
  const normalized = normalizeLimitSettings(settings);
  try {
    await prisma.group.update({
      where: { id: groupId },
      data: {
        limitSettings: normalized as unknown as Prisma.JsonObject,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new GroupNotFoundError(groupId);
    }
    logger.error("saveGroupCountLimitSettings failed", { groupId, error });
    throw error;
  }
  return normalized;
}
