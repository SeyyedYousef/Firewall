import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { open, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../server/utils/logger.js";
import type { PromoSlideRecord } from "../shared/promo.js";
export type { PromoSlideRecord } from "../shared/promo.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(moduleDir, "../data");
const statePath = resolve(dataDir, "bot-state.json");
const stateLockPath = resolve(dataDir, "bot-state.lock");
const databaseAvailable = Boolean(process.env.DATABASE_URL);
const ownerTelegramId = process.env.BOT_OWNER_ID?.trim() ?? null;
const LOCK_RETRY_DELAY_MS = 40;
const LOCK_STALE_THRESHOLD_MS = 30_000;

export const DEFAULT_ONBOARDING_MESSAGES: readonly string[] = [
  "<b>Firewall Bot</b> just joined to keep your community safe with smart moderation, security locks, and automated actions.",
  "Your free trial is now active for <b>{trial_days}</b> days. Use the owner panel to explore every feature during this period.",
  "Please promote <b>Firewall Bot</b> to Administrator with permissions to manage chat, delete messages, ban users, and manage video chats so it can enforce the rules.",
];
export const EMPTY_PROMO_ANALYTICS = Object.freeze({
  impressions: 0,
  clicks: 0,
  ctr: 0,
  avgTimeSpent: 0,
  bounceRate: 0,
});

function normalizePromoSlideEntry(raw: unknown, index: number): PromoSlideRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const id =
    typeof value.id === "string" && value.id.trim().length > 0
      ? value.id.trim()
      : `promo-${String(index + 1).padStart(3, "0")}`;
  const now = new Date().toISOString();
  const imageUrl =
    typeof value.imageUrl === "string" && value.imageUrl.trim().length > 0
      ? value.imageUrl
      : typeof value.fileId === "string"
        ? value.fileId
        : "";

  const analytics =
    value.analytics && typeof value.analytics === "object"
      ? {
          impressions: Number((value.analytics as Record<string, unknown>).impressions ?? 0),
          clicks: Number((value.analytics as Record<string, unknown>).clicks ?? 0),
          ctr: Number((value.analytics as Record<string, unknown>).ctr ?? 0),
          avgTimeSpent: Number((value.analytics as Record<string, unknown>).avgTimeSpent ?? 0),
          bounceRate: Number((value.analytics as Record<string, unknown>).bounceRate ?? 0),
        }
      : { ...EMPTY_PROMO_ANALYTICS };

  return {
    id,
    title: typeof value.title === "string" ? value.title : null,
    subtitle: typeof value.subtitle === "string" ? value.subtitle : null,
    description: typeof value.description === "string" ? value.description : null,
    imageUrl,
    thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : null,
    thumbnailStorageKey: typeof value.thumbnailStorageKey === "string" ? value.thumbnailStorageKey : null,
    storageKey: typeof value.storageKey === "string" ? value.storageKey : null,
    originalFileId: typeof value.originalFileId === "string" ? value.originalFileId : null,
    contentType: typeof value.contentType === "string" ? value.contentType : null,
    fileSize:
      typeof value.fileSize === "number" && Number.isFinite(value.fileSize) ? Math.floor(value.fileSize) : null,
    width: typeof value.width === "number" && Number.isFinite(value.width) ? Math.floor(value.width) : null,
    height: typeof value.height === "number" && Number.isFinite(value.height) ? Math.floor(value.height) : null,
    checksum: typeof value.checksum === "string" ? value.checksum : null,
    accentColor: typeof value.accentColor === "string" ? value.accentColor : null,
    linkUrl:
      typeof value.linkUrl === "string"
        ? value.linkUrl
        : typeof value.link === "string"
          ? value.link
          : null,
    ctaLabel: typeof value.ctaLabel === "string" ? value.ctaLabel : null,
    ctaLink: typeof value.ctaLink === "string" ? value.ctaLink : null,
    position:
      typeof value.position === "number" && Number.isFinite(value.position) ? Math.floor(value.position) : index,
    active: value.active !== false,
    startsAt: typeof value.startsAt === "string" ? value.startsAt : null,
    endsAt: typeof value.endsAt === "string" ? value.endsAt : null,
    abTestGroupId: typeof value.abTestGroupId === "string" ? value.abTestGroupId : null,
    variant: typeof value.variant === "string" ? value.variant : null,
    analytics,
    views:
      typeof value.views === "number" && Number.isFinite(value.views) ? Math.floor(value.views) : undefined,
    clicks:
      typeof value.clicks === "number" && Number.isFinite(value.clicks) ? Math.floor(value.clicks) : undefined,
    totalViewDurationMs:
      typeof value.totalViewDurationMs === "number" && Number.isFinite(value.totalViewDurationMs)
        ? Math.max(0, Math.floor(value.totalViewDurationMs))
        : undefined,
    bounces:
      typeof value.bounces === "number" && Number.isFinite(value.bounces) ? Math.floor(value.bounces) : undefined,
    createdBy: typeof value.createdBy === "string" ? value.createdBy : null,
    createdAt:
      typeof value.createdAt === "string" && value.createdAt.trim().length > 0 ? value.createdAt : now,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0 ? value.updatedAt : now,
    metadata:
      value.metadata && typeof value.metadata === "object" ? (value.metadata as Record<string, unknown>) : {},
  };
}

type Awaitable<T> = T | Promise<T>;

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export type PanelSettings = {
  freeTrialDays: number;
  monthlyStars: number;
  welcomeMessages: string[];
  onboardingMessages: string[];
  gpidHelpText: string;
  buttonLabels: Record<string, string>;
  channelAnnouncement: string;
  commands: string;
  infoCommands: string;
};

export type GroupRecord = {
  chatId: string;
  title: string;
  creditBalance: number;
  createdAt: string;
  updatedAt: string;
  lastAdjustmentNote: string | null;
  membersCount: number;
  inviteLink: string | null;
  photoUrl: string | null;
  managed: boolean;
  adminRestricted: boolean;
  adminWarningSentAt: string | null;
  ownerId: string | null;
  adminIds: string[];
  status: string | null;
  statusUpdatedAt: string | null;
  dbId: string | null;
};

export type BroadcastRecord = {
  id: string;
  message: string;
  createdAt: string;
};

export type CreditCodeRecord = {
  id: string;
  code: string;
  days: number;
  maxUses: number;
  currentUses: number;
  createdAt: string;
  expiresAt?: string;
  isActive: boolean;
  usedBy: Array<{
    userId: string;
    usedAt: string;
    groupId?: string;
  }>;
};

export type StarsPlanRecord = {
  id: string;
  days: number;
  price: number;
  label?: string;
  description?: string;
};

export type GroupStarsRecord = {
  groupId: string;
  expiresAt: string;
  gifted: boolean;
  trialReminderSentAt?: string | null;
  trialExpiredAt?: string | null;
  disabled?: boolean;
};

export type StarsState = {
  balance: number;
  plans: StarsPlanRecord[];
  groups: Record<string, GroupStarsRecord>;
};

export type OwnerSessionState =
  | { state: "idle" }
  | { state: "awaitingAddAdmin" }
  | { state: "awaitingRemoveAdmin" }
  | { state: "awaitingManageGroup" }
  | { state: "awaitingIncreaseCredit" }
  | { state: "awaitingDecreaseCredit" }
  | { state: "awaitingBroadcastMessage" }
  | { state: "awaitingBroadcastConfirm"; pending: { message: string } }
  | { state: "awaitingSettingsFreeDays" }
  | { state: "awaitingSettingsStars" }
  | { state: "awaitingSettingsWelcomeMessages" }
  | { state: "awaitingSettingsGpidHelp" }
  | { state: "awaitingSettingsLabels" }
  | { state: "awaitingSettingsChannelText" }
  | { state: "awaitingSettingsInfoCommands" }
  | { state: "awaitingSettingsAddToGroupUrl" }
  | { state: "awaitingSettingsChannelUrl" }
  | { state: "awaitingBanAdd" }
  | { state: "awaitingBanRemove" }
  | { state: "awaitingFirewallCreate" }
  | { state: "awaitingFirewallEdit"; ruleId: string }
  | { state: "awaitingSliderAdd" }
  | { state: "awaitingSliderLink"; slideId: string }
  | { state: "awaitingDailyTaskChannel" }
  | { state: "awaitingCreateCreditCode" }
  | { state: "awaitingDeleteCreditCode" }
  | { state: "awaitingResetConfirm" };

export type PendingOnboardingMessage = {
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  threadId?: number;
};

export type BotState = {
  panelAdmins: string[];
  bannedUserIds: string[];
  groups: Record<string, GroupRecord>;
  settings: PanelSettings;
  promoSlides: PromoSlideRecord[];
  broadcasts: BroadcastRecord[];
  creditCodes: CreditCodeRecord[];
  stars: StarsState;
  ownerSession: OwnerSessionState;
  pendingOnboarding: Record<string, PendingOnboardingMessage[]>;
};

const defaultOwnerSession: OwnerSessionState = { state: "idle" };

const defaultState: BotState = {
  panelAdmins: [],
  bannedUserIds: [],
  groups: {},
  settings: {
    freeTrialDays: 15,
    monthlyStars: 10,
    welcomeMessages: [],
    onboardingMessages: Array.from(DEFAULT_ONBOARDING_MESSAGES),
    gpidHelpText: "Share the group ID or forward a message so the bot can detect it automatically.",
    buttonLabels: {},
    channelAnnouncement: "Channel link not configured yet.",
    commands: "📚 <b>Quick Guide</b>\nTo get started, explore these key commands:\n\n• <code>Coming soon</code>\n\n💡 For the best experience, configure your settings in the Mini App right after setup.",
    infoCommands: "🚀 <b>Firewall</b> was created and is continuously developed with care by <b>@iamSeyyed</b>.\n\n🙏 Special thanks to <b>@maxim</b>, <b>@username</b>, all server admins, the development team, supporters, and every user who reports bugs or suggests new features — your feedback keeps this project alive.\n\n💬 We deeply appreciate every group that uses <b>Firewall</b>.\nYour trust is our motivation — and we'll keep making <b>Firewall</b> stronger every day. 🔥",
  },
  promoSlides: [],
  broadcasts: [],
  creditCodes: [],
  stars: {
    balance: 0,
    plans: [
      { id: "stars-30", days: 30, price: 60 },
      { id: "stars-60", days: 60, price: 120 },
      { id: "stars-90", days: 90, price: 180 },
    ],
    groups: {},
  },
  ownerSession: defaultOwnerSession,
  pendingOnboarding: {},
};

class StateValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid bot state: ${issues.join("; ")}`);
    this.name = "StateValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCondition(condition: boolean, message: string, issues: string[]): void {
  if (!condition) {
    issues.push(message);
  }
}

function normalizeOnboardingMessage(message: unknown, index: number): string {
  const fallback =
    DEFAULT_ONBOARDING_MESSAGES[index] ?? DEFAULT_ONBOARDING_MESSAGES[DEFAULT_ONBOARDING_MESSAGES.length - 1];
  if (typeof message !== "string") {
    return fallback;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return fallback;
  }

  if (looksCorrupted(trimmed)) {
    return fallback;
  }

  return trimmed;
}

function looksCorrupted(value: string): boolean {
  if (value.includes("\uFFFD")) {
    return true;
  }
  const total = value.length;
  if (total === 0) {
    return true;
  }
  const questionMarks = (value.match(/\?/g) ?? []).length;
  if (questionMarks === 0) {
    return false;
  }
  const ratio = questionMarks / total;
  return ratio >= 0.3;
}

function sanitizePositiveInteger(value: unknown, fallback: number, min = 0): number {
  if (typeof value !== "number") {
    const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.floor(parsed));
    }
    return fallback;
  }
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.floor(value));
}

function sanitizeWelcomeMessages(input: unknown, existing: readonly string[]): string[] {
  if (!Array.isArray(input)) {
    return [...existing];
  }
  const result = input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return result;
}

function sanitizeOnboardingMessages(input: unknown, fallback: readonly string[]): string[] {
  const source = Array.isArray(input) ? input : [];
  const mapped = fallback.map((_, index) => normalizeOnboardingMessage(source[index], index));
  const filtered = mapped.filter((item) => item.trim().length > 0);
  return filtered.length > 0 ? filtered : Array.from(fallback);
}

function sanitizeOptionalString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return looksCorrupted(trimmed) ? fallback : trimmed;
}

function sanitizeButtonLabels(
  input: unknown,
  existing: Record<string, string>,
  defaults: Record<string, string>,
): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...existing };
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    result[key] = looksCorrupted(trimmed) ? defaults[key] ?? trimmed : trimmed;
  }
  return { ...existing, ...result };
}

function validatePanelSettings(settings: PanelSettings, issues: string[]): void {
  assertCondition(Number.isFinite(settings.freeTrialDays) && settings.freeTrialDays >= 0, "settings.freeTrialDays must be >= 0", issues);
  assertCondition(Number.isFinite(settings.monthlyStars) && settings.monthlyStars >= 0, "settings.monthlyStars must be >= 0", issues);
  assertCondition(Array.isArray(settings.welcomeMessages), "settings.welcomeMessages must be an array", issues);
  assertCondition(Array.isArray(settings.onboardingMessages), "settings.onboardingMessages must be an array", issues);
  if (Array.isArray(settings.welcomeMessages)) {
    settings.welcomeMessages.forEach((message, index) => {
      assertCondition(typeof message === "string", `settings.welcomeMessages[${index}] must be a string`, issues);
    });
  }
  if (Array.isArray(settings.onboardingMessages)) {
    settings.onboardingMessages.forEach((message, index) => {
      assertCondition(typeof message === "string" && message.trim().length > 0, `settings.onboardingMessages[${index}] must be a non-empty string`, issues);
    });
  }
  assertCondition(typeof settings.gpidHelpText === "string", "settings.gpidHelpText must be a string", issues);
  assertCondition(typeof settings.channelAnnouncement === "string", "settings.channelAnnouncement must be a string", issues);
  assertCondition(typeof settings.infoCommands === "string", "settings.infoCommands must be a string", issues);
  assertCondition(isRecord(settings.buttonLabels), "settings.buttonLabels must be an object", issues);
  if (isRecord(settings.buttonLabels)) {
    Object.entries(settings.buttonLabels).forEach(([key, value]) => {
      assertCondition(typeof value === "string", `settings.buttonLabels['${key}'] must be a string`, issues);
    });
  }
}

function validateGroupRecord(record: GroupRecord, key: string, issues: string[]): void {
  assertCondition(record.chatId === key, `groups['${key}'].chatId must match key`, issues);
  assertCondition(typeof record.title === "string" && record.title.trim().length > 0, `groups['${key}'].title must be a non-empty string`, issues);
  assertCondition(Number.isFinite(record.creditBalance) && record.creditBalance >= 0, `groups['${key}'].creditBalance must be >= 0`, issues);
  assertCondition(typeof record.createdAt === "string" && record.createdAt.length > 0, `groups['${key}'].createdAt must be a string`, issues);
  assertCondition(typeof record.updatedAt === "string" && record.updatedAt.length > 0, `groups['${key}'].updatedAt must be a string`, issues);
  assertCondition(Number.isFinite(record.membersCount) && record.membersCount >= 0, `groups['${key}'].membersCount must be >= 0`, issues);
  if (record.inviteLink !== null) {
    assertCondition(typeof record.inviteLink === "string", `groups['${key}'].inviteLink must be string or null`, issues);
  }
  if (record.photoUrl !== null) {
    assertCondition(typeof record.photoUrl === "string", `groups['${key}'].photoUrl must be string or null`, issues);
  }
  assertCondition(typeof record.managed === "boolean", `groups['${key}'].managed must be boolean`, issues);
  assertCondition(typeof record.adminRestricted === "boolean", `groups['${key}'].adminRestricted must be boolean`, issues);
  if (record.adminWarningSentAt !== null) {
    assertCondition(typeof record.adminWarningSentAt === "string", `groups['${key}'].adminWarningSentAt must be string or null`, issues);
  }
  if (record.ownerId !== null) {
    assertCondition(typeof record.ownerId === "string", `groups['${key}'].ownerId must be string or null`, issues);
  }
  assertCondition(Array.isArray(record.adminIds), `groups['${key}'].adminIds must be an array`, issues);
  if (Array.isArray(record.adminIds)) {
    record.adminIds.forEach((adminId, index) => {
      assertCondition(typeof adminId === "string" && adminId.trim().length > 0, `groups['${key}'].adminIds[${index}] must be a non-empty string`, issues);
    });
  }
  if (record.status !== null) {
    assertCondition(typeof record.status === "string", `groups['${key}'].status must be string or null`, issues);
  }
  if (record.statusUpdatedAt !== null) {
    assertCondition(typeof record.statusUpdatedAt === "string", `groups['${key}'].statusUpdatedAt must be string or null`, issues);
  }
  if (record.dbId !== null) {
    assertCondition(typeof record.dbId === "string", `groups['${key}'].dbId must be string or null`, issues);
  }
}

function validatePromoSlideRecord(record: PromoSlideRecord, index: number, issues: string[]): void {
  assertCondition(typeof record.id === "string" && record.id.length > 0, `promoSlides[${index}].id must be a non-empty string`, issues);
  assertCondition(typeof record.imageUrl === "string", `promoSlides[${index}].imageUrl must be a string`, issues);
  if (record.analytics) {
    ["impressions", "clicks", "ctr", "avgTimeSpent", "bounceRate"].forEach((key) => {
      const analyticsValue = (record.analytics as Record<string, unknown>)[key];
      assertCondition(
        typeof analyticsValue === "number" && Number.isFinite(analyticsValue),
        `promoSlides[${index}].analytics.${key} must be a finite number`,
        issues,
      );
    });
  }
}

function validateBroadcastRecord(record: BroadcastRecord, index: number, issues: string[]): void {
  assertCondition(typeof record.id === "string" && record.id.length > 0, `broadcasts[${index}].id must be a non-empty string`, issues);
  assertCondition(typeof record.message === "string", `broadcasts[${index}].message must be a string`, issues);
  assertCondition(typeof record.createdAt === "string", `broadcasts[${index}].createdAt must be a string`, issues);
}

function validateStarsPlans(plans: StarsPlanRecord[], issues: string[]): void {
  plans.forEach((plan, index) => {
    assertCondition(typeof plan.id === "string" && plan.id.length > 0, `stars.plans[${index}].id must be a non-empty string`, issues);
    assertCondition(Number.isFinite(plan.days) && plan.days > 0, `stars.plans[${index}].days must be > 0`, issues);
    assertCondition(Number.isFinite(plan.price) && plan.price >= 0, `stars.plans[${index}].price must be >= 0`, issues);
  });
}

function validateStarsGroups(groups: Record<string, GroupStarsRecord>, issues: string[]): void {
  Object.entries(groups).forEach(([key, entry]) => {
    assertCondition(entry.groupId === key, `stars.groups['${key}'].groupId must match key`, issues);
    assertCondition(typeof entry.expiresAt === "string" && entry.expiresAt.length > 0, `stars.groups['${key}'].expiresAt must be a string`, issues);
    assertCondition(typeof entry.gifted === "boolean", `stars.groups['${key}'].gifted must be boolean`, issues);
    if (entry.trialReminderSentAt !== undefined && entry.trialReminderSentAt !== null) {
      assertCondition(typeof entry.trialReminderSentAt === "string", `stars.groups['${key}'].trialReminderSentAt must be string or null`, issues);
    }
    if (entry.trialExpiredAt !== undefined && entry.trialExpiredAt !== null) {
      assertCondition(typeof entry.trialExpiredAt === "string", `stars.groups['${key}'].trialExpiredAt must be string or null`, issues);
    }
    if (entry.disabled !== undefined) {
      assertCondition(typeof entry.disabled === "boolean", `stars.groups['${key}'].disabled must be boolean`, issues);
    }
  });
}

function validateOwnerSession(session: OwnerSessionState, issues: string[]): void {
  switch (session.state) {
    case "idle":
    case "awaitingAddAdmin":
    case "awaitingRemoveAdmin":
    case "awaitingManageGroup":
    case "awaitingIncreaseCredit":
    case "awaitingDecreaseCredit":
    case "awaitingBroadcastMessage":
    case "awaitingSliderPhoto":
    case "awaitingSliderLink":
    case "awaitingSliderRemoval":
    case "awaitingBanUserId":
    case "awaitingUnbanUserId":
    case "awaitingDailyTaskLink":
    case "awaitingSettingsFreeDays":
    case "awaitingSettingsStars":
    case "awaitingSettingsWelcomeMessages":
    case "awaitingSettingsOnboardingMessages":
    case "awaitingSettingsGpidHelp":
    case "awaitingSettingsLabels":
    case "awaitingSettingsChannelText":
    case "awaitingSettingsInfoCommands":
    case "awaitingFirewallRuleCreate":
    case "awaitingResetPassword":
      return;
    case "awaitingBroadcastConfirm":
      assertCondition(
        isRecord((session as { pending?: unknown }).pending) &&
          typeof (session as { pending?: { message?: unknown } }).pending?.message === "string" &&
          ((session as { pending?: { message?: string } }).pending?.message ?? "").length > 0,
        "ownerSession.pending.message must be a non-empty string",
        issues,
      );
      return;
    case "awaitingDailyTaskButton":
      assertCondition(
        isRecord((session as { pending?: unknown }).pending) &&
          typeof (session as { pending?: { channelLink?: unknown } }).pending?.channelLink === "string",
        "ownerSession.pending.channelLink must be a string",
        issues,
      );
      return;
    case "awaitingDailyTaskDescription": {
      const pending = (session as { pending?: { channelLink?: unknown; buttonLabel?: unknown } }).pending;
      assertCondition(
        isRecord(pending) && typeof pending?.channelLink === "string" && typeof pending?.buttonLabel === "string",
        "ownerSession.pending must include channelLink and buttonLabel",
        issues,
      );
      return;
    }
    case "awaitingDailyTaskXp": {
      const pending = (session as {
        pending?: { channelLink?: unknown; buttonLabel?: unknown; description?: unknown };
      }).pending;
      assertCondition(
        isRecord(pending) &&
          typeof pending?.channelLink === "string" &&
          typeof pending?.buttonLabel === "string" &&
          typeof pending?.description === "string",
        "ownerSession.pending must include channelLink, buttonLabel, and description",
        issues,
      );
      return;
    }
    case "awaitingFirewallRuleEdit": {
      const pending = (session as { pending?: { ruleId?: unknown; chatId?: unknown } }).pending;
      assertCondition(
        isRecord(pending) &&
          typeof pending?.ruleId === "string" &&
          (pending?.chatId === null || typeof pending?.chatId === "string"),
        "ownerSession.pending must include ruleId and optional chatId",
        issues,
      );
      return;
    }
    case "awaitingResetConfirm": {
      const pending = (session as { pending?: { groupCount?: unknown } }).pending;
      assertCondition(
        isRecord(pending) &&
          typeof pending?.groupCount === "number",
        "ownerSession.pending must include groupCount",
        issues,
      );
      return;
    }
    default:
      assertCondition(false, `ownerSession.state '${(session as { state: unknown }).state}' is not supported`, issues);
  }
}

function validateBotState(candidate: BotState): void {
  const issues: string[] = [];

  assertCondition(Array.isArray(candidate.panelAdmins), "panelAdmins must be an array", issues);
  if (Array.isArray(candidate.panelAdmins)) {
    candidate.panelAdmins.forEach((id, index) => {
      assertCondition(typeof id === "string" && id.trim().length > 0, `panelAdmins[${index}] must be a non-empty string`, issues);
    });
  }

  assertCondition(Array.isArray(candidate.bannedUserIds), "bannedUserIds must be an array", issues);
  if (Array.isArray(candidate.bannedUserIds)) {
    candidate.bannedUserIds.forEach((id, index) => {
      assertCondition(typeof id === "string" && id.trim().length > 0, `bannedUserIds[${index}] must be a non-empty string`, issues);
    });
  }

  assertCondition(isRecord(candidate.groups), "groups must be an object", issues);
  if (isRecord(candidate.groups)) {
    Object.entries(candidate.groups).forEach(([key, record]) => {
      if (record) {
        validateGroupRecord(record as GroupRecord, key, issues);
      } else {
        issues.push(`groups['${key}'] must be defined`);
      }
    });
  }

  validatePanelSettings(candidate.settings, issues);

  assertCondition(Array.isArray(candidate.promoSlides), "promoSlides must be an array", issues);
  if (Array.isArray(candidate.promoSlides)) {
    candidate.promoSlides.forEach((slide, index) => validatePromoSlideRecord(slide, index, issues));
  }

  assertCondition(Array.isArray(candidate.broadcasts), "broadcasts must be an array", issues);
  if (Array.isArray(candidate.broadcasts)) {
    candidate.broadcasts.forEach((broadcast, index) => validateBroadcastRecord(broadcast, index, issues));
  }

  assertCondition(Number.isFinite(candidate.stars.balance) && candidate.stars.balance >= 0, "stars.balance must be >= 0", issues);
  assertCondition(Array.isArray(candidate.stars.plans) && candidate.stars.plans.length > 0, "stars.plans must be a non-empty array", issues);
  if (Array.isArray(candidate.stars.plans)) {
    validateStarsPlans(candidate.stars.plans, issues);
  }
  assertCondition(isRecord(candidate.stars.groups), "stars.groups must be an object", issues);
  if (isRecord(candidate.stars.groups)) {
    validateStarsGroups(candidate.stars.groups as Record<string, GroupStarsRecord>, issues);
  }

  validateOwnerSession(candidate.ownerSession, issues);

  assertCondition(isRecord(candidate.pendingOnboarding), "pendingOnboarding must be an object", issues);
  if (isRecord(candidate.pendingOnboarding)) {
    Object.entries(candidate.pendingOnboarding).forEach(([chatId, queue]) => {
      assertCondition(Array.isArray(queue), `pendingOnboarding['${chatId}'] must be an array`, issues);
      if (!Array.isArray(queue)) {
        return;
      }
      queue.forEach((entry, index) => {
        assertCondition(
          typeof entry === "object" && entry !== null,
          `pendingOnboarding['${chatId}'][${index}] must be an object`,
          issues,
        );
        if (!entry || typeof entry !== "object") {
          return;
        }
        const record = entry as PendingOnboardingMessage;
        assertCondition(
          typeof record.text === "string" && record.text.trim().length > 0,
          `pendingOnboarding['${chatId}'][${index}].text must be a non-empty string`,
          issues,
        );
        if (record.parseMode !== undefined) {
          assertCondition(
            record.parseMode === "HTML" || record.parseMode === "MarkdownV2",
            `pendingOnboarding['${chatId}'][${index}].parseMode must be HTML or MarkdownV2`,
            issues,
          );
        }
        if (record.threadId !== undefined) {
          assertCondition(
            typeof record.threadId === "number" && Number.isFinite(record.threadId),
            `pendingOnboarding['${chatId}'][${index}].threadId must be a finite number`,
            issues,
          );
        }
      });
    });
  }

  if (issues.length > 0) {
    throw new StateValidationError(issues);
  }
}

export const __stateTest = {
  validateBotState,
};

function normalizeOwnerSession(input: unknown): OwnerSessionState {
  if (!input || typeof input !== "object") {
    return { state: "idle" };
  }
  const raw = input as Record<string, unknown>;
  const stateValue = typeof raw.state === "string" ? raw.state : null;
  if (!stateValue) {
    return { state: "idle" };
  }

  const simpleStates = new Set<OwnerSessionState["state"]>([
    "idle",
    "awaitingAddAdmin",
    "awaitingRemoveAdmin",
    "awaitingManageGroup",
    "awaitingIncreaseCredit",
    "awaitingDecreaseCredit",
    "awaitingBroadcastMessage",
    "awaitingSliderPhoto",
    "awaitingSliderRemoval",
    "awaitingBanUserId",
    "awaitingUnbanUserId",
    "awaitingDailyTaskLink",
    "awaitingSettingsFreeDays",
    "awaitingSettingsStars",
    "awaitingSettingsWelcomeMessages",
    "awaitingSettingsOnboardingMessages",
    "awaitingSettingsGpidHelp",
    "awaitingSettingsLabels",
    "awaitingSettingsChannelText",
    "awaitingSettingsInfoCommands",
    "awaitingFirewallRuleCreate",
    "awaitingResetPassword",
  ]);

  if (simpleStates.has(stateValue as OwnerSessionState["state"])) {
    return ({ state: stateValue as OwnerSessionState["state"] } as OwnerSessionState);
  }

  const pending = raw.pending;

  switch (stateValue) {
    case "awaitingBroadcastConfirm":
      if (pending && typeof pending === "object" && typeof (pending as Record<string, unknown>).message === "string") {
        return { state: "awaitingBroadcastConfirm", pending: { message: (pending as { message: string }).message } };
      }
      return { state: "idle" };
    case "awaitingSliderLink":
      if (
        pending &&
        typeof pending === "object" &&
        typeof (pending as Record<string, unknown>).fileId === "string" &&
        typeof (pending as Record<string, unknown>).width === "number" &&
        typeof (pending as Record<string, unknown>).height === "number"
      ) {
        const typed = pending as { fileId: string; width: number; height: number };
        return {
          state: "awaitingSliderLink",
          pending: { fileId: typed.fileId, width: typed.width, height: typed.height },
        };
      }
      return { state: "idle" };
    case "awaitingDailyTaskButton":
      if (pending && typeof pending === "object" && typeof (pending as Record<string, unknown>).channelLink === "string") {
        return {
          state: "awaitingDailyTaskButton",
          pending: { channelLink: (pending as { channelLink: string }).channelLink },
        };
      }
      return { state: "idle" };
    case "awaitingDailyTaskDescription":
      if (
        pending &&
        typeof pending === "object" &&
        typeof (pending as Record<string, unknown>).channelLink === "string" &&
        typeof (pending as Record<string, unknown>).buttonLabel === "string"
      ) {
        const typed = pending as { channelLink: string; buttonLabel: string };
        return {
          state: "awaitingDailyTaskDescription",
          pending: { channelLink: typed.channelLink, buttonLabel: typed.buttonLabel },
        };
      }
      return { state: "idle" };
    case "awaitingDailyTaskXp":
      if (
        pending &&
        typeof pending === "object" &&
        typeof (pending as Record<string, unknown>).channelLink === "string" &&
        typeof (pending as Record<string, unknown>).buttonLabel === "string" &&
        typeof (pending as Record<string, unknown>).description === "string"
      ) {
        const typed = pending as { channelLink: string; buttonLabel: string; description: string };
        return {
          state: "awaitingDailyTaskXp",
          pending: {
            channelLink: typed.channelLink,
            buttonLabel: typed.buttonLabel,
            description: typed.description,
          },
        };
      }
      return { state: "idle" };
    case "awaitingFirewallRuleEdit":
      if (
        pending &&
        typeof pending === "object" &&
        typeof (pending as Record<string, unknown>).ruleId === "string" &&
        ("chatId" in pending ? typeof (pending as Record<string, unknown>).chatId === "string" || (pending as Record<string, unknown>).chatId === null : true)
      ) {
        const typed = pending as { ruleId: string; chatId: string | null | undefined };
        return {
          state: "awaitingFirewallRuleEdit",
          pending: { ruleId: typed.ruleId, chatId: typed.chatId ?? null },
        };
      }
      return { state: "idle" };
    case "awaitingResetConfirm":
      if (pending && typeof pending === "object" && typeof (pending as Record<string, unknown>).groupCount === "number") {
        return {
          state: "awaitingResetConfirm",
          pending: { groupCount: (pending as { groupCount: number }).groupCount },
        };
      }
      return { state: "idle" };
    default:
      return { state: "idle" };
  }
}

function ensureDataDir(): void {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function readStateFromDisk(): BotState {
  ensureDataDir();
  if (!existsSync(statePath)) {
    return structuredClone(defaultState);
  }
  try {
    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BotState>;
    const groupsInput =
      typeof parsed.groups === "object" && parsed.groups !== null ? (parsed.groups as Record<string, Partial<GroupRecord>>) : {};
    const groups: Record<string, GroupRecord> = Object.fromEntries(
      Object.entries(groupsInput).map(([id, value]) => {
        const title = typeof value.title === "string" && value.title.trim().length > 0 ? value.title : `Group ${id}`;
        const creditBalance =
          typeof value.creditBalance === "number" && Number.isFinite(value.creditBalance) ? Math.max(0, value.creditBalance) : 0;
        const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString();
        const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;
        return [
          id,
          {
            chatId: id,
            title,
            creditBalance,
            createdAt,
            updatedAt,
            lastAdjustmentNote: typeof value.lastAdjustmentNote === "string" ? value.lastAdjustmentNote : null,
            membersCount:
              typeof value.membersCount === "number" && Number.isFinite(value.membersCount) ? Math.max(0, value.membersCount) : 0,
            inviteLink: typeof value.inviteLink === "string" ? value.inviteLink : null,
            photoUrl: typeof value.photoUrl === "string" ? value.photoUrl : null,
            managed: value?.managed !== false,
            adminRestricted: value?.adminRestricted === true,
            adminWarningSentAt:
              typeof value?.adminWarningSentAt === "string" ? value.adminWarningSentAt : null,
            ownerId: typeof value?.ownerId === "string" ? value.ownerId : null,
            adminIds: Array.isArray(value?.adminIds)
              ? (value.adminIds as unknown[]).map((entry) => (typeof entry === "string" ? entry : null)).filter((entry): entry is string => Boolean(entry && entry.trim().length > 0))
              : [],
            status: typeof value?.status === "string" ? value.status : null,
            statusUpdatedAt: typeof value?.statusUpdatedAt === "string" ? value.statusUpdatedAt : null,
            dbId: typeof value?.dbId === "string" ? value.dbId : null,
          },
        ];
      })
    );

  const starsInput = (parsed.stars ?? {}) as any;
    const plans = Array.isArray(starsInput?.plans)
      ? (starsInput.plans as StarsPlanRecord[]).map((plan) => ({
          id: String(plan.id),
          days: Number.isFinite(plan.days) ? plan.days : 0,
          price: Number.isFinite(plan.price) ? plan.price : 0,
          ...(plan.label ? { label: String(plan.label) } : {}),
          ...(plan.description ? { description: String(plan.description) } : {}),
        }))
      : structuredClone(defaultState.stars.plans);
    const starsGroupsInput =
      typeof starsInput?.groups === "object" && starsInput?.groups !== null
        ? (starsInput.groups as Record<string, Partial<GroupStarsRecord>>)
        : {};
  const starsGroups: Record<string, GroupStarsRecord> = Object.fromEntries(
      Object.entries(starsGroupsInput).map(([id, entry]) => [
        id,
        {
          groupId: id,
          expiresAt: typeof entry?.expiresAt === "string" ? entry.expiresAt : new Date().toISOString(),
          gifted: entry?.gifted === true,
          trialReminderSentAt:
            typeof entry?.trialReminderSentAt === "string" ? entry.trialReminderSentAt : null,
          trialExpiredAt: typeof entry?.trialExpiredAt === "string" ? entry.trialExpiredAt : null,
          disabled: entry?.disabled === true,
        },
      ])
    );
    const rawOnboarding = Array.isArray(parsed.settings?.onboardingMessages)
      ? parsed.settings?.onboardingMessages
      : undefined;
    const onboardingMessages = DEFAULT_ONBOARDING_MESSAGES.map((_, index) =>
      normalizeOnboardingMessage(rawOnboarding?.[index], index),
    );

    const candidate: BotState = {
      panelAdmins: Array.isArray(parsed.panelAdmins) ? parsed.panelAdmins.map(String) : [],
      bannedUserIds: Array.isArray(parsed.bannedUserIds) ? parsed.bannedUserIds.map(String) : [],
      groups,
      settings: {
        ...defaultState.settings,
        ...(typeof parsed.settings === "object" && parsed.settings !== null ? parsed.settings : {}),
        welcomeMessages: Array.isArray(parsed.settings?.welcomeMessages)
          ? parsed.settings?.welcomeMessages.map(String)
          : defaultState.settings.welcomeMessages,
        onboardingMessages,
        buttonLabels:
          typeof parsed.settings?.buttonLabels === "object" && parsed.settings?.buttonLabels !== null
            ? Object.fromEntries(
                Object.entries(parsed.settings.buttonLabels).map(([key, value]) => [key, String(value)])
              )
            : structuredClone(defaultState.settings.buttonLabels),
      },
      promoSlides: Array.isArray(parsed.promoSlides)
        ? parsed.promoSlides
            .map((entry, index) => normalizePromoSlideEntry(entry, index))
            .filter((entry): entry is PromoSlideRecord => entry !== null)
        : [],
    broadcasts: Array.isArray(parsed.broadcasts) ? parsed.broadcasts : [],
    stars: {
      balance:
        typeof starsInput?.balance === "number" && Number.isFinite(starsInput.balance)
          ? Math.max(0, starsInput.balance)
          : defaultState.stars.balance,
      plans,
      groups: starsGroups,
    },
    ownerSession: normalizeOwnerSession(parsed.ownerSession),
    pendingOnboarding:
      typeof parsed.pendingOnboarding === "object" && parsed.pendingOnboarding !== null
        ? Object.fromEntries(
            Object.entries(parsed.pendingOnboarding as Record<string, unknown>).map(([chatId, value]) => {
              const queue = Array.isArray(value)
                ? (value as unknown[]).map((entry) => {
                    if (!entry || typeof entry !== "object") {
                      return null;
                    }
                    const record = entry as Record<string, unknown>;
                    const text = typeof record.text === "string" ? record.text : null;
                    if (!text || text.trim().length === 0) {
                      return null;
                    }
                    const parseMode =
                      record.parseMode === "HTML" || record.parseMode === "MarkdownV2"
                        ? (record.parseMode as "HTML" | "MarkdownV2")
                        : undefined;
                    const threadId =
                      typeof record.threadId === "number" && Number.isFinite(record.threadId)
                        ? record.threadId
                        : undefined;
                    return { text, parseMode, threadId };
                  })
                : [];
              const filtered = queue.filter((item) => item !== null) as PendingOnboardingMessage[];
              return [chatId, filtered];
            }),
          )
        : {},
  };
    validateBotState(candidate);
    return candidate;
  } catch (error) {
    logger.error("state failed to parse bot-state.json, falling back to defaults", { error });
    return structuredClone(defaultState);
  }
}

let state: BotState = readStateFromDisk();
let writeQueue: Promise<void> = Promise.resolve();

async function withFileLock<T>(task: () => Awaitable<T>): Promise<T> {
  let handle: import("node:fs/promises").FileHandle | null = null;
  const lockPayload = `${process.pid}:${Date.now()}`;

  for (;;) {
    try {
      handle = await open(stateLockPath, "wx");
      await handle.writeFile(lockPayload, "utf8");
      break;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw err;
      }
      try {
        const stats = await stat(stateLockPath);
        if (Date.now() - stats.mtimeMs > LOCK_STALE_THRESHOLD_MS) {
          await unlink(stateLockPath).catch(() => undefined);
          continue;
        }
      } catch {
        continue;
      }
      await delay(LOCK_RETRY_DELAY_MS);
    }
  }

  try {
    return await task();
  } finally {
    try {
      await handle?.close();
    } catch {
      // ignore close errors
    }
    await unlink(stateLockPath).catch(() => undefined);
  }
}

function logDbWarning(context: string, error: unknown): void {
  if (!databaseAvailable) {
    return;
  }
  logger.warn("database fallback", {
    context,
    error: error instanceof Error ? error.message : error,
  });
}

async function syncGroupRecord(record: GroupRecord): Promise<void> {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { upsertGroupFromState } = await import("../server/db/mutateRepository.js");
    await upsertGroupFromState({
      chatId: record.chatId,
      title: record.title,
      creditBalance: record.creditBalance,
      inviteLink: record.inviteLink,
      managed: record.managed,
    });
  } catch (error) {
    logDbWarning("group sync failed", error);
  }
}

async function promotePanelAdminRecord(telegramId: string): Promise<void> {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { promotePanelAdmin } = await import("../server/db/mutateRepository.js");
    await promotePanelAdmin(telegramId);
  } catch (error) {
    logDbWarning("panel admin promotion failed", error);
  }
}

async function demotePanelAdminRecord(telegramId: string): Promise<void> {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { demotePanelAdmin } = await import("../server/db/mutateRepository.js");
    await demotePanelAdmin(telegramId);
  } catch (error) {
    logDbWarning("panel admin demotion failed", error);
  }
}

async function hydratePanelAdminsFromDb(): Promise<void> {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { fetchPanelAdminsFromDb } = await import("../server/db/stateRepository.js");
    const admins = await fetchPanelAdminsFromDb();
    if (!admins.length) {
      return;
    }

    withState((draft) => {
      const merged = new Set<string>(admins.map((id) => id.trim()).filter(Boolean));
      if (ownerTelegramId) {
        merged.add(ownerTelegramId);
      }
      draft.panelAdmins = Array.from(merged).sort((a, b) => a.localeCompare(b));
      return draft;
    });
  } catch (error) {
    logDbWarning("panel admin hydration failed", error);
  }
}

async function hydratePromoSlidesFromDb(): Promise<void> {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { fetchPromoSlidesFromDb } = await import("../server/db/stateRepository.js");
    const slides = await fetchPromoSlidesFromDb();
    if (!slides.length) {
      return;
    }
    withState((draft) => {
      draft.promoSlides = slides.map((slide) => ({
        ...slide,
        analytics: slide.analytics ?? { ...EMPTY_PROMO_ANALYTICS },
      }));
      return draft;
    });
  } catch (error) {
    logDbWarning("promo slide hydration failed", error);
  }
}

async function hydratePanelBansFromDb(): Promise<void> {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { fetchPanelBansFromDb } = await import("../server/db/stateRepository.js");
    const bans = await fetchPanelBansFromDb();
    if (!bans.length) {
      return;
    }
    withState((draft) => {
      draft.bannedUserIds = Array.from(new Set(bans.map((id) => id.trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      );
      return draft;
    });
  } catch (error) {
    logDbWarning("panel ban hydration failed", error);
  }
}

type StarsTransactionSnapshot = {
  transactionId?: string;
  groupId: string;
  planId: string;
  planDays: number;
  amountDelta: number;
  expiresAt: string;
  gifted: boolean;
};

async function recordStarsPurchaseTransaction(snapshot: StarsTransactionSnapshot): Promise<void> {
  if (!databaseAvailable || !ownerTelegramId) {
    return;
  }
  try {
    const { completeStarTransaction, createPendingStarTransaction } = await import("../server/db/mutateRepository.js");

    let transactionId = snapshot.transactionId;
    if (!transactionId) {
      const pending = await createPendingStarTransaction({
        ownerTelegramId,
        groupChatId: snapshot.groupId,
        planId: snapshot.planId,
        gifted: snapshot.gifted,
        metadata: {
          source: "bot-state",
          planDays: snapshot.planDays,
        },
      });
      transactionId = pending.transactionId;
    }

    await completeStarTransaction({
      transactionId,
      amountDelta: snapshot.amountDelta,
      planId: snapshot.planId,
      expiresAt: snapshot.expiresAt,
      gifted: snapshot.gifted,
      planDays: snapshot.planDays,
    });
  } catch (error) {
    logDbWarning("stars purchase sync failed", error);
  }
}

if (databaseAvailable) {
  void hydratePanelAdminsFromDb();
  void hydratePromoSlidesFromDb();
  void hydratePanelBansFromDb();
}

function persistState(next: BotState): void {
  let snapshot: BotState;
  try {
    snapshot = structuredClone(next);
    validateBotState(snapshot);
  } catch (error) {
    logger.error("state rejected invalid bot state mutation", {
      error: error instanceof StateValidationError ? error.issues : error,
    });
    throw error;
  }

  ensureDataDir();
  state = snapshot;
  const payload = JSON.stringify(snapshot, null, 2);
  writeQueue = writeQueue
    .then(() =>
      withFileLock(async () => {
        const tempPath = `${statePath}.${process.pid}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
        await writeFile(tempPath, payload, "utf8");
        await rename(tempPath, statePath);
      }),
    )
    .catch((error) => {
      logger.error("state failed to persist bot state", { error });
    });
}

function withState(mutator: (draft: BotState) => BotState): BotState {
  const workingCopy = structuredClone(state);
  let draft: BotState;
  try {
    draft = mutator(workingCopy);
  } catch (error) {
    logger.error("state mutation failed", { error });
    throw error;
  }
  persistState(draft);
  return draft;
}

export function getState(): BotState {
  return structuredClone(state);
}

export function isPanelAdmin(userId: string): boolean {
  return state.panelAdmins.includes(userId);
}

export function addPanelAdmin(userId: string): BotState {
  const trimmed = userId.trim();
  if (!trimmed) {
    return state;
  }
  return withState((draft) => {
    if (!draft.panelAdmins.includes(trimmed)) {
      draft.panelAdmins.push(trimmed);
      draft.panelAdmins.sort((a, b) => a.localeCompare(b));
      void promotePanelAdminRecord(trimmed);
    }
    return draft;
  });
}

export function removePanelAdmin(userId: string): BotState {
  const trimmed = userId.trim();
  if (!trimmed) {
    return state;
  }
  return withState((draft) => {
    draft.panelAdmins = draft.panelAdmins.filter((id) => id !== trimmed);
    void demotePanelAdminRecord(trimmed);
    return draft;
  });
}

export function listPanelAdmins(): string[] {
  return [...state.panelAdmins];
}

export function addBannedUser(userId: string): BotState {
  const trimmed = userId.trim();
  if (!trimmed) {
    return state;
  }
  return withState((draft) => {
    if (!draft.bannedUserIds.includes(trimmed)) {
      draft.bannedUserIds.push(trimmed);
      draft.bannedUserIds.sort((a, b) => a.localeCompare(b));
      if (databaseAvailable) {
        void (async () => {
          try {
            const { addPanelBan } = await import("../server/db/mutateRepository.js");
            await addPanelBan(trimmed);
          } catch (error) {
            logDbWarning("panel ban persist failed", error);
          }
        })();
      }
    }
    return draft;
  });
}

export function removeBannedUser(userId: string): BotState {
  const trimmed = userId.trim();
  if (!trimmed) {
    return state;
  }
  return withState((draft) => {
    draft.bannedUserIds = draft.bannedUserIds.filter((id) => id !== trimmed);
    if (databaseAvailable) {
      void (async () => {
        try {
          const { removePanelBan } = await import("../server/db/mutateRepository.js");
          await removePanelBan(trimmed);
        } catch (error) {
          logDbWarning("panel ban removal failed", error);
        }
      })();
    }
    return draft;
  });
}

export function listBannedUsers(): string[] {
  return [...state.bannedUserIds];
}

interface UpsertGroupInput {
  chatId: string;
  title?: string;
  creditDelta?: number;
  note?: string;
  membersCount?: number;
  inviteLink?: string | null;
  photoUrl?: string | null;
  managed?: boolean;
  adminRestricted?: boolean;
  adminWarningSentAt?: string | null;
  ownerId?: string | null;
  adminIds?: string[];
  status?: string | null;
  statusUpdatedAt?: string | null;
  dbId?: string | null;
}

function upsertGroupInDraft(draft: BotState, record: UpsertGroupInput): GroupRecord {
  const id = record.chatId.trim();
  if (!id) {
    throw new Error("chatId is required");
  }

  const now = new Date().toISOString();
  const existing = draft.groups[id];
  if (existing) {
    const nextCredit =
      typeof record.creditDelta === "number"
        ? Math.max(0, existing.creditBalance + record.creditDelta)
        : existing.creditBalance;

    const normalizedAdminIds =
      record.adminIds === undefined
        ? existing.adminIds
        : Array.from(
            new Set(
              (record.adminIds ?? [])
                .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
                .filter((entry) => entry.length > 0),
            ),
          );

    const updated: GroupRecord = {
      ...existing,
      title: record.title?.trim() || existing.title,
      creditBalance: nextCredit,
      updatedAt: now,
      lastAdjustmentNote: record.note ?? existing.lastAdjustmentNote,
      membersCount:
        typeof record.membersCount === "number" && Number.isFinite(record.membersCount)
          ? Math.max(0, record.membersCount)
          : existing.membersCount,
      inviteLink:
        record.inviteLink === undefined
          ? existing.inviteLink
          : record.inviteLink && record.inviteLink.trim().length > 0
            ? record.inviteLink.trim()
            : null,
      photoUrl:
        record.photoUrl === undefined
          ? existing.photoUrl
          : record.photoUrl && record.photoUrl.trim().length > 0
            ? record.photoUrl.trim()
            : null,
      managed: record.managed === undefined ? existing.managed : record.managed,
      adminRestricted: record.adminRestricted === undefined ? existing.adminRestricted : record.adminRestricted,
      adminWarningSentAt:
        record.adminWarningSentAt === undefined ? existing.adminWarningSentAt : record.adminWarningSentAt ?? null,
      ownerId: record.ownerId === undefined ? existing.ownerId : record.ownerId ?? null,
      adminIds: normalizedAdminIds ?? [],
      status: record.status === undefined ? existing.status : record.status ?? null,
      statusUpdatedAt:
        record.statusUpdatedAt === undefined ? existing.statusUpdatedAt : record.statusUpdatedAt ?? null,
      dbId: record.dbId === undefined ? existing.dbId : record.dbId ?? null,
    };
    draft.groups[id] = updated;
    return updated;
  }

  const title = record.title?.trim() || `Group ${id}`;
  const creditBalance = Math.max(0, record.creditDelta ?? 0);
  const created: GroupRecord = {
    chatId: id,
    title,
    creditBalance,
    createdAt: now,
    updatedAt: now,
    lastAdjustmentNote: record.note ?? null,
    membersCount:
      typeof record.membersCount === "number" && Number.isFinite(record.membersCount)
        ? Math.max(0, record.membersCount)
        : 0,
    inviteLink:
      record.inviteLink && record.inviteLink.trim().length > 0 ? record.inviteLink.trim() : null,
    photoUrl:
      record.photoUrl && record.photoUrl.trim().length > 0 ? record.photoUrl.trim() : null,
    managed: record.managed !== false,
    adminRestricted: record.adminRestricted ?? false,
    adminWarningSentAt: record.adminWarningSentAt ?? null,
    ownerId: record.ownerId ?? null,
    adminIds: Array.from(
      new Set(
        (record.adminIds ?? [])
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0),
      ),
    ),
    status: record.status ?? null,
    statusUpdatedAt: record.statusUpdatedAt ?? null,
    dbId: record.dbId ?? null,
  };
  draft.groups[id] = created;
  return created;
}

export function upsertGroup(record: UpsertGroupInput): GroupRecord {
  const id = record.chatId.trim();
  if (!id) {
    throw new Error("chatId is required");
  }
  let result: GroupRecord | null = null;
  state = withState((draft) => {
    result = upsertGroupInDraft(draft, record);
    return draft;
  });
  if (!result) {
    throw new Error("Unable to upsert group");
  }
  void syncGroupRecord(result);
  return result;
}

export function listGroups(): GroupRecord[] {
  return Object.values(state.groups).sort((a, b) => a.chatId.localeCompare(b.chatId));
}

export function listGroupsWithoutOwner(): GroupRecord[] {
  return Object.values(state.groups).filter(group => !group.ownerId || group.ownerId.trim() === '');
}

export function fixGroupOwnership(fixes: Array<{ chatId: string; ownerId: string }>): number {
  let fixed = 0;
  state = withState((draft) => {
    for (const fix of fixes) {
      const group = draft.groups[fix.chatId];
      if (group && (!group.ownerId || group.ownerId.trim() === '')) {
        group.ownerId = fix.ownerId;
        group.updatedAt = new Date().toISOString();
        fixed++;
      }
    }
    return draft;
  });
  return fixed;
}

export function markAdminPermission(
  chatId: string,
  hasPermission: boolean,
  options: { warningDate?: Date | null } = {},
): GroupRecord | null {
  const id = chatId.trim();
  if (!id) {
    return null;
  }

  let updated: GroupRecord | null = null;
  state = withState((draft) => {
    const group = draft.groups[id];
    if (!group) {
      return draft;
    }

    const nowIso = new Date().toISOString();
    const next: GroupRecord = {
      ...group,
      adminRestricted: !hasPermission,
      updatedAt: nowIso,
    };

    if (options.warningDate !== undefined) {
      next.adminWarningSentAt = options.warningDate ? options.warningDate.toISOString() : null;
    } else if (hasPermission) {
      next.adminWarningSentAt = null;
    } else if (!group.adminWarningSentAt) {
      next.adminWarningSentAt = nowIso;
    }

    draft.groups[id] = next;
    updated = next;
    return draft;
  });

  if (updated) {
    void syncGroupRecord(updated);
  }

  return updated;
}

export function queuePendingOnboardingMessages(chatId: string, messages: PendingOnboardingMessage[]): BotState {
  const trimmed = chatId.trim();
  if (!trimmed || !Array.isArray(messages) || messages.length === 0) {
    return state;
  }

  return withState((draft) => {
    const bucket = draft.pendingOnboarding[trimmed] ?? [];
    const deduped = [...bucket];

    for (const entry of messages) {
      if (!entry || typeof entry.text !== "string") {
        continue;
      }
      const text = entry.text.trim();
      if (!text) {
        continue;
      }
      const normalized: PendingOnboardingMessage = {
        text,
        parseMode: entry.parseMode === "MarkdownV2" ? "MarkdownV2" : entry.parseMode === "HTML" ? "HTML" : undefined,
        threadId:
          typeof entry.threadId === "number" && Number.isFinite(entry.threadId) ? entry.threadId : undefined,
      };
      const alreadyQueued = deduped.some(
        (existing) =>
          existing.text === normalized.text &&
          existing.parseMode === normalized.parseMode &&
          existing.threadId === normalized.threadId,
      );
      if (!alreadyQueued) {
        deduped.push(normalized);
      }
    }

    if (deduped.length === 0) {
      delete draft.pendingOnboarding[trimmed];
    } else {
      draft.pendingOnboarding[trimmed] = deduped;
    }
    return draft;
  });
}

export function drainPendingOnboardingMessages(chatId: string): PendingOnboardingMessage[] {
  const trimmed = chatId.trim();
  if (!trimmed) {
    return [];
  }

  let drained: PendingOnboardingMessage[] = [];
  withState((draft) => {
    const bucket = draft.pendingOnboarding[trimmed];
    if (Array.isArray(bucket) && bucket.length > 0) {
      drained = bucket.map((entry) => ({
        text: entry.text,
        parseMode: entry.parseMode,
        threadId: entry.threadId,
      }));
      delete draft.pendingOnboarding[trimmed];
    }
    return draft;
  });

  return drained;
}

export function setPanelSettings(partial: Partial<PanelSettings>): PanelSettings {
  state = withState((draft) => {
    const current = draft.settings;
    const next: PanelSettings = {
      ...current,
    };

    if (partial.freeTrialDays !== undefined) {
      next.freeTrialDays = sanitizePositiveInteger(partial.freeTrialDays, current.freeTrialDays);
    }
    if (partial.monthlyStars !== undefined) {
      next.monthlyStars = sanitizePositiveInteger(partial.monthlyStars, current.monthlyStars);
    }
    if (partial.welcomeMessages !== undefined) {
      next.welcomeMessages = sanitizeWelcomeMessages(partial.welcomeMessages, current.welcomeMessages);
    }
    if (partial.onboardingMessages !== undefined) {
      next.onboardingMessages = sanitizeOnboardingMessages(partial.onboardingMessages, DEFAULT_ONBOARDING_MESSAGES);
    }
    if (partial.gpidHelpText !== undefined) {
      next.gpidHelpText = sanitizeOptionalString(partial.gpidHelpText, current.gpidHelpText);
    }
    if (partial.channelAnnouncement !== undefined) {
      next.channelAnnouncement = sanitizeOptionalString(partial.channelAnnouncement, current.channelAnnouncement);
    }
    if (partial.infoCommands !== undefined) {
      next.infoCommands = sanitizeOptionalString(partial.infoCommands, current.infoCommands);
    }
    if (partial.buttonLabels !== undefined) {
      next.buttonLabels = sanitizeButtonLabels(partial.buttonLabels, current.buttonLabels, defaultState.settings.buttonLabels);
    }

    draft.settings = next;
    return draft;
  });
  return state.settings;
}

export function getPanelSettings(): PanelSettings {
  return structuredClone(state.settings);
}

export function setWelcomeMessages(messages: string[]): PanelSettings {
  state = withState((draft) => {
    draft.settings.welcomeMessages = sanitizeWelcomeMessages(messages, draft.settings.welcomeMessages);
    return draft;
  });
  return state.settings;
}

export function setButtonLabels(labels: Record<string, string>): PanelSettings {
  state = withState((draft) => {
    draft.settings.buttonLabels = sanitizeButtonLabels(labels, draft.settings.buttonLabels, defaultState.settings.buttonLabels);
    return draft;
  });
  return state.settings;
}

export function getPromoSlides(): PromoSlideRecord[] {
  return [...state.promoSlides];
}

export function readOwnerSessionState(): OwnerSessionState {
  return structuredClone(state.ownerSession);
}

export function writeOwnerSessionState(next: OwnerSessionState): OwnerSessionState {
  const normalized = normalizeOwnerSession(next);
  withState((draft) => {
    draft.ownerSession = structuredClone(normalized);
    return draft;
  });
  return structuredClone(state.ownerSession);
}

export function resetOwnerSessionState(): OwnerSessionState {
  return writeOwnerSessionState({ state: "idle" });
}

export function addPromoSlide(entry: PromoSlideRecord, options: { persist?: boolean } = {}): PromoSlideRecord[] {
  const persist = options.persist ?? true;
  let normalizedEntry: PromoSlideRecord | null = null;
  state = withState((draft) => {
    const normalized: PromoSlideRecord = {
      ...entry,
      analytics: entry.analytics ?? { ...EMPTY_PROMO_ANALYTICS },
      position:
        typeof entry.position === "number" && Number.isFinite(entry.position)
          ? entry.position
          : draft.promoSlides.length,
    };
    normalizedEntry = normalized;
    const filtered = draft.promoSlides.filter((slide) => slide.id !== normalized.id);
    filtered.push(normalized);
    filtered.sort((a, b) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
    draft.promoSlides = filtered;
    return draft;
  });
  const snapshotSource = normalizedEntry ?? entry;
  if (persist && databaseAvailable) {
    void (async () => {
      try {
        const { upsertPromoSlide } = await import("../server/db/mutateRepository.js");
        await upsertPromoSlide({
          id: snapshotSource.id,
          title: snapshotSource.title ?? null,
          subtitle: snapshotSource.subtitle ?? null,
          description: snapshotSource.description ?? null,
          imageUrl: snapshotSource.imageUrl,
          thumbnailUrl: snapshotSource.thumbnailUrl ?? null,
          storageKey: snapshotSource.storageKey ?? null,
          originalFileId: snapshotSource.originalFileId ?? null,
          contentType: snapshotSource.contentType ?? null,
          fileSize: snapshotSource.fileSize ?? null,
          width: snapshotSource.width ?? null,
          height: snapshotSource.height ?? null,
          checksum: snapshotSource.checksum ?? null,
          accentColor: snapshotSource.accentColor ?? undefined,
          linkUrl: snapshotSource.linkUrl ?? null,
          ctaLabel: snapshotSource.ctaLabel ?? null,
          ctaLink: snapshotSource.ctaLink ?? null,
          position: snapshotSource.position,
          startsAt: snapshotSource.startsAt ? new Date(snapshotSource.startsAt) : null,
          endsAt: snapshotSource.endsAt ? new Date(snapshotSource.endsAt) : null,
          active: snapshotSource.active,
          abTestGroupId: snapshotSource.abTestGroupId ?? null,
          variant: snapshotSource.variant ?? null,
          createdBy: snapshotSource.createdBy ?? null,
          metadata: snapshotSource.metadata ?? {},
        });
      } catch (error) {
        logDbWarning("promo slide upsert failed", error);
      }
    })();
  }
  return state.promoSlides;
}

export function removePromoSlide(id: string, options: { persist?: boolean } = {}): PromoSlideRecord[] {
  const persist = options.persist ?? true;
  state = withState((draft) => {
    draft.promoSlides = draft.promoSlides.filter((slide) => slide.id !== id);
    return draft;
  });
  if (persist && databaseAvailable) {
    void (async () => {
      try {
        const { deletePromoSlide } = await import("../server/db/mutateRepository.js");
        await deletePromoSlide(id);
      } catch (error) {
        logDbWarning("promo slide deletion failed", error);
      }
    })();
  }
  return state.promoSlides;
}

export function setPromoSlides(entries: PromoSlideRecord[], options: { persist?: boolean } = {}): PromoSlideRecord[] {
  state = withState((draft) => {
    const sorted = [...entries].map((entry, index) => ({
      ...entry,
      analytics: entry.analytics ?? { ...EMPTY_PROMO_ANALYTICS },
      position:
        typeof entry.position === "number" && Number.isFinite(entry.position) ? entry.position : index,
    }));
    sorted.sort((a, b) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
    draft.promoSlides = sorted;
    return draft;
  });

  if (options.persist && databaseAvailable) {
    void (async () => {
      try {
        const { upsertPromoSlide } = await import("../server/db/mutateRepository.js");
        for (const entry of entries) {
          await upsertPromoSlide({
            id: entry.id,
            title: entry.title ?? null,
            subtitle: entry.subtitle ?? null,
            description: entry.description ?? null,
            imageUrl: entry.imageUrl,
            thumbnailUrl: entry.thumbnailUrl ?? null,
            thumbnailStorageKey: entry.thumbnailStorageKey ?? null,
            storageKey: entry.storageKey ?? null,
            originalFileId: entry.originalFileId ?? null,
            contentType: entry.contentType ?? null,
            fileSize: entry.fileSize ?? null,
            width: entry.width ?? null,
            height: entry.height ?? null,
            checksum: entry.checksum ?? null,
            accentColor: entry.accentColor ?? undefined,
            linkUrl: entry.linkUrl ?? null,
            ctaLabel: entry.ctaLabel ?? null,
            ctaLink: entry.ctaLink ?? null,
            position: entry.position,
            startsAt: entry.startsAt ? new Date(entry.startsAt) : null,
            endsAt: entry.endsAt ? new Date(entry.endsAt) : null,
            active: entry.active,
            abTestGroupId: entry.abTestGroupId ?? null,
            variant: entry.variant ?? null,
            createdBy: entry.createdBy ?? null,
            metadata: entry.metadata ?? {},
          });
        }
      } catch (error) {
        logDbWarning("promo slide bulk persist failed", error);
      }
    })();
  }

  return state.promoSlides;
}

export function recordBroadcast(message: string): BroadcastRecord {
  let broadcast: BroadcastRecord = {
    id: `broadcast-${Date.now()}`,
    message,
    createdAt: new Date().toISOString(),
  };
  state = withState((draft) => {
    draft.broadcasts.unshift(broadcast);
    draft.broadcasts = draft.broadcasts.slice(0, 50);
    return draft;
  });
  return broadcast;
}

export function listBroadcasts(): BroadcastRecord[] {
  return [...state.broadcasts];
}

const DAY_MS = 86_400_000;

function resolveStarsPlan(draft: BotState, planId: string): StarsPlanRecord {
  const plan = draft.stars.plans.find((item) => item.id === planId);
  if (!plan) {
    throw new Error(`Stars plan ${planId} not found`);
  }
  return plan;
}

export function getStarsState(): StarsState {
  return structuredClone(state.stars);
}

export type StarsPurchaseInput = {
  groupId: string;
  planId: string;
  gifted: boolean;
  transactionId?: string;
  metadata?: {
    title?: string;
    membersCount?: number;
    inviteLink?: string | null;
    photoUrl?: string | null;
    managed?: boolean;
  };
};

export type StarsPurchaseInternalResult = {
  group: GroupRecord;
  plan: StarsPlanRecord;
  expiresAt: string;
  daysAdded: number;
  newBalance: number;
  gifted: boolean;
};

export function applyStarsPurchase(input: StarsPurchaseInput): StarsPurchaseInternalResult {
  let outcome: StarsPurchaseInternalResult | null = null;
  state = withState((draft) => {
    const plan = resolveStarsPlan(draft, input.planId);
    if (draft.stars.balance < plan.price) {
      throw new Error("Insufficient Stars balance");
    }

    const metadata = input.metadata ?? {};
    const managedFlag =
      metadata.managed !== undefined ? metadata.managed : !input.gifted;

    const group = upsertGroupInDraft(draft, {
      chatId: input.groupId,
      title: metadata.title,
      membersCount: metadata.membersCount,
      inviteLink: metadata.inviteLink,
      photoUrl: metadata.photoUrl,
      managed: managedFlag,
    });

    const nowMs = Date.now();
    const existing = draft.stars.groups[input.groupId];
    const baseMs = existing ? Math.max(new Date(existing.expiresAt).getTime(), nowMs) : nowMs;
    const expiresAt = new Date(baseMs + plan.days * DAY_MS).toISOString();

    draft.stars.groups[input.groupId] = {
      groupId: input.groupId,
      expiresAt,
      gifted: input.gifted,
      trialReminderSentAt: null,
      trialExpiredAt: null,
      disabled: false,
    };
    draft.stars.balance = Math.max(0, draft.stars.balance - plan.price);

    outcome = {
      group,
      plan,
      expiresAt,
      daysAdded: plan.days,
      newBalance: draft.stars.balance,
      gifted: input.gifted,
    };
    return draft;
  });

  if (!outcome) {
    throw new Error("Failed to apply Stars purchase");
  }
  const applied = outcome as StarsPurchaseInternalResult;
  void recordStarsPurchaseTransaction({
    transactionId: input.transactionId,
    groupId: applied.group.chatId,
    planId: applied.plan.id,
    planDays: applied.plan.days,
    amountDelta: -applied.plan.price,
    expiresAt: applied.expiresAt,
    gifted: input.gifted,
  });
  return applied;
}

export function grantTrialForGroup(params: {
  groupId: string;
  days: number;
  title?: string;
  membersCount?: number;
  inviteLink?: string | null;
  photoUrl?: string | null;
  managed?: boolean;
}): { group: GroupRecord; expiresAt: string; appliedDays: number } {
  const id = params.groupId.trim();
  if (!id) {
    throw new Error("groupId is required for trial assignment");
  }
  const days = Math.max(0, Math.floor(params.days));
  let outcome: { group: GroupRecord; expiresAt: string; appliedDays: number } | null = null;

  state = withState((draft) => {
    const group = upsertGroupInDraft(draft, {
      chatId: id,
      title: params.title,
      membersCount: params.membersCount,
      inviteLink: params.inviteLink,
      photoUrl: params.photoUrl,
      managed: params.managed ?? true,
    });

    if (days === 0) {
      const existing = draft.stars.groups[id];
      outcome = {
        group,
        expiresAt: existing ? existing.expiresAt : new Date().toISOString(),
        appliedDays: 0,
      };
      return draft;
    }

    const existing = draft.stars.groups[id];
    if (existing) {
      draft.stars.groups[id] = {
        ...existing,
        disabled: false,
        trialExpiredAt: null,
      };
      outcome = { group, expiresAt: existing.expiresAt, appliedDays: 0 };
      return draft;
    }

    const expiresAt = new Date(Date.now() + days * DAY_MS).toISOString();
    draft.stars.groups[id] = {
      groupId: id,
      expiresAt,
      gifted: true,
      trialReminderSentAt: null,
      trialExpiredAt: null,
      disabled: false,
    };
    outcome = { group, expiresAt, appliedDays: days };
    return draft;
  });

  if (!outcome) {
    throw new Error("Failed to assign trial period");
  }

  const assigned = outcome as { group: GroupRecord; expiresAt: string; appliedDays: number };
  void syncGroupRecord(assigned.group);
  return assigned;
}

export function markTrialReminderSent(groupId: string, date: Date): void {
  const sentAt = date.toISOString();
  withState((draft) => {
    const entry = draft.stars.groups[groupId];
    if (!entry) {
      return draft;
    }
    draft.stars.groups[groupId] = {
      ...entry,
      trialReminderSentAt: sentAt,
    };
    return draft;
  });
}

export function markTrialExpired(groupId: string, date: Date): GroupRecord | null {
  let managed: GroupRecord | null = null;
  const expiredAt = date.toISOString();
  withState((draft) => {
    const entry = draft.stars.groups[groupId];
    if (!entry) {
      return draft;
    }
    draft.stars.groups[groupId] = {
      ...entry,
      disabled: true,
      trialExpiredAt: expiredAt,
    };
    managed = upsertGroupInDraft(draft, {
      chatId: groupId,
      managed: false,
    });
    return draft;
  });
  return managed;
}

export function setStarsBalance(balance: number): StarsState {
  if (!Number.isFinite(balance) || balance < 0) {
    throw new Error("Stars balance must be a non-negative number");
  }
  state = withState((draft) => {
    draft.stars.balance = Math.floor(balance);
    return draft;
  });
  return state.stars;
}

export function adjustStarsBalance(delta: number): StarsState {
  if (!Number.isFinite(delta)) {
    throw new Error("Stars balance delta must be a finite number");
  }
  state = withState((draft) => {
    const next = Math.floor(draft.stars.balance + delta);
    draft.stars.balance = Math.max(0, next);
    return draft;
  });
  return state.stars;
}

// Credit Code Management Functions
export function generateCreditCode(days: number, maxUses: number, expiresInDays?: number): CreditCodeRecord {
  const code = `FW${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
  const now = new Date();
  const creditCode: CreditCodeRecord = {
    id: `code-${Date.now()}`,
    code,
    days,
    maxUses,
    currentUses: 0,
    createdAt: now.toISOString(),
    expiresAt: expiresInDays ? new Date(now.getTime() + expiresInDays * DAY_MS).toISOString() : undefined,
    isActive: true,
    usedBy: [],
  };

  state = withState((draft) => {
    draft.creditCodes.unshift(creditCode);
    return draft;
  });

  return creditCode;
}

export function listCreditCodes(): CreditCodeRecord[] {
  return [...state.creditCodes];
}

export function findCreditCode(code: string): CreditCodeRecord | null {
  return state.creditCodes.find(c => c.code === code) || null;
}

export function useCreditCode(code: string, userId: string, groupId?: string): { success: boolean; message: string; days?: number } {
  const creditCode = findCreditCode(code);
  
  if (!creditCode) {
    return { success: false, message: "کد اعتباری یافت نشد." };
  }

  if (!creditCode.isActive) {
    return { success: false, message: "کد اعتباری غیرفعال است." };
  }

  if (creditCode.expiresAt && new Date() > new Date(creditCode.expiresAt)) {
    return { success: false, message: "کد اعتباری منقضی شده است." };
  }

  if (creditCode.currentUses >= creditCode.maxUses) {
    return { success: false, message: "کد اعتباری به حد مجاز استفاده رسیده است." };
  }

  // Check if user already used this code
  if (creditCode.usedBy.some(usage => usage.userId === userId)) {
    return { success: false, message: "شما قبلاً از این کد استفاده کرده‌اید." };
  }

  // Use the code
  state = withState((draft) => {
    const code = draft.creditCodes.find(c => c.code === creditCode.code);
    if (code) {
      code.currentUses++;
      code.usedBy.push({
        userId,
        usedAt: new Date().toISOString(),
        groupId,
      });
    }
    return draft;
  });

  return { 
    success: true, 
    message: `کد اعتباری با موفقیت استفاده شد. ${creditCode.days} روز اعتبار دریافت کردید.`,
    days: creditCode.days
  };
}

export function deleteCreditCode(codeId: string): boolean {
  const index = state.creditCodes.findIndex(c => c.id === codeId);
  if (index === -1) {
    return false;
  }

  state = withState((draft) => {
    draft.creditCodes.splice(index, 1);
    return draft;
  });

  return true;
}

export function toggleCreditCodeStatus(codeId: string): boolean {
  const code = state.creditCodes.find(c => c.id === codeId);
  if (!code) {
    return false;
  }

  state = withState((draft) => {
    const targetCode = draft.creditCodes.find(c => c.id === codeId);
    if (targetCode) {
      targetCode.isActive = !targetCode.isActive;
    }
    return draft;
  });

  return true;
}
