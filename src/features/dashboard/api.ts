import type {
  BanRuleKey,
  BanRuleSetting,
  DashboardSnapshot,
  DashboardInsights,
  DashboardPromotions,
  DashboardPromoSlot,
  GroupBanSettings,
  GroupDetail,
  GroupGeneralSettings,
  GroupMetrics,
  ManagedGroup,
  TimeRangeMode,
  TimeRangeSetting,
  CountLimitSettings,
  SilenceSettings,
  MandatoryMembershipSettings,
  CustomTextSettings,
  AnalyticsMessageType,
  AnalyticsPoint,
  AnalyticsMessageSeries,
  GroupAnalyticsSnapshot,
  Trend,
  StarsOverview,
  StarsPurchaseResult,
  StarsPlan,
  GroupStarsStatus,
  StarsWalletSummary,
  StarsTransactionEntry,
  GiveawayConfig,
  GiveawayCreationPayload,
  GiveawayCreationResult,
  GiveawayDashboardData,
  GiveawayDetail,
} from "./types.ts";
import { BAN_RULE_KEYS } from "./types.ts";
import { dashboardConfig } from "@/config/dashboard.ts";
// import { getTelegramInitData } from "@/utils/telegram";

const DAY_MS = 86_400_000;
const PROMO_SLIDE_WIDTH = 960;
const PROMO_SLIDE_HEIGHT = 360;
const PROMO_ANALYTICS_LOOKBACK_DAYS = 30;
const DEFAULT_PROMO_ROTATION_SECONDS = 6;
type PromoSlidesResponse = {
  slides: DashboardPromoSlot[];
  total?: number;
  canManage?: boolean;
};

const STARS_PLANS: StarsPlan[] = [
  { id: "stars-30", days: 30, price: 60 },
  { id: "stars-60", days: 60, price: 120 },
  { id: "stars-90", days: 90, price: 180 },
];
const DEFAULT_TIMEZONE = "UTC";


function delay(ms: number): Promise<void> {
  if (ms <= 0 || import.meta.env.PROD) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sanitizeBaseUrl(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

const apiBaseUrl = (() => {
  const configured = sanitizeBaseUrl(import.meta.env.VITE_API_BASE_URL as string | undefined);
  if (configured) {
    return configured;
  }

  if (typeof window !== "undefined") {
    const globalOverride = sanitizeBaseUrl(
      (window as typeof window & { __FIREWALL_API_BASE_URL?: string }).__FIREWALL_API_BASE_URL,
    );
    if (globalOverride) {
      return globalOverride;
    }
  }

  // Use production API URL if no environment variable is set
  if (import.meta.env.PROD) {
    return "https://firewall-bot-backend.onrender.com/api";
  }

  return "/api";
})();

export async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error("API base URL is not configured");
  }

  const headers = new Headers(init?.headers as HeadersInit | undefined);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Add Telegram init data for authentication
  const { getTelegramInitData } = await import("@/utils/telegram.ts");
  const initData = getTelegramInitData();
  if (initData) {
    headers.set("X-Telegram-Init-Data", initData);
  }

  const url = `${apiBaseUrl}${path}`;
  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = "";
    try {
      message = await response.text();
    } catch {
      // ignore read errors
    }
    throw new Error(message && message.length > 0 ? message : `Request failed with status ${response.status}`);
  }
  
  if (response.status === 204) {
    return undefined as T;
  }
  
  return (await response.json()) as T;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function addDays(base: Date, days: number): string {
  return new Date(base.getTime() + days * DAY_MS).toISOString();
}

function subtractDays(base: Date, days: number): string {
  return new Date(base.getTime() - days * DAY_MS).toISOString();
}

function createTrend(current: number, previous: number): Trend {
  if (previous <= 0) {
    if (current <= 0) {
      return { direction: "flat", percent: 0 };
    }
    return { direction: "up", percent: 100 };
  }
  const diff = current - previous;
  const rawPercent = (diff / previous) * 100;
  const percent = Number(Math.abs(rawPercent).toFixed(1));
  if (diff > 0) {
    return { direction: "up", percent };
  }
  if (diff < 0) {
    return { direction: "down", percent };
  }
  return { direction: "flat", percent: 0 };
}

function generateMetrics(group: ManagedGroup): GroupMetrics {
  const seed = hashString(group.id);
  const membersTotal = group.membersCount;
  const previousMembers = Math.max(membersTotal - (seed % 9), 1);
  const messagesToday = 80 + (seed % 150);
  const messagesYesterday = Math.max(messagesToday - (seed % 40), 20);
  const newMembersToday = Math.max((seed % 12) - 4, 0);
  const newMembersYesterday = Math.max(newMembersToday - (seed % 5), 0);

  let remainingMs = 0;
  let isExpired = false;
  if (group.status.kind === "active") {
    remainingMs = Math.max(new Date(group.status.expiresAt).getTime() - Date.now(), 0);
    isExpired = remainingMs <= 0;
  } else {
    remainingMs = Math.max(new Date(group.status.graceEndsAt).getTime() - Date.now(), 0);
    isExpired = true;
  }

  return {
    membersTotal,
    membersTrend: createTrend(membersTotal, previousMembers),
    remainingMs,
    isExpired,
    messagesToday,
    messagesTrend: createTrend(messagesToday, messagesYesterday),
    newMembersToday,
    newMembersTrend: createTrend(newMembersToday, newMembersYesterday || 1),
  };
}

function buildGroupInvite(id: string): string {
  const base = id.startsWith("grp-") ? id.slice(4) : id;
  const sanitized = base.replace(/[^a-z0-9_]/gi, "");
  return `@${sanitized || base}`.toLowerCase();
}

function makeActiveGroup(id: string, title: string, membersCount: number, daysLeft: number): ManagedGroup {
  const now = new Date();
  return {
    id,
    title,
    membersCount,
    photoUrl: undefined,
    canManage: true,
    inviteLink: buildGroupInvite(id),
    status: {
      kind: "active",
      expiresAt: addDays(now, daysLeft),
      daysLeft,
    },
  };
}

function makeExpiredGroup(id: string, title: string, membersCount: number, daysSinceExpiry: number): ManagedGroup {
  const now = new Date();
  const expiredAt = subtractDays(now, daysSinceExpiry);
  const graceEndsAt = addDays(new Date(expiredAt), 7);
  return {
    id,
    title,
    membersCount,
    photoUrl: undefined,
    canManage: true,
    inviteLink: buildGroupInvite(id),
    status: {
      kind: "expired",
      expiredAt,
      graceEndsAt,
    },
  };
}

function makeRemovedGroup(id: string, title: string, membersCount: number, daysSinceRemoval: number): ManagedGroup {
  const now = new Date();
  const removedAt = subtractDays(now, daysSinceRemoval);
  const graceEndsAt = addDays(new Date(removedAt), 7);
  return {
    id,
    title,
    membersCount,
    photoUrl: undefined,
    canManage: false,
    inviteLink: buildGroupInvite(id),
    status: {
      kind: "removed",
      removedAt,
      graceEndsAt,
    },
  };
}

function countExpiringSoon(groups: ManagedGroup[]): number {
  return groups.filter((group) => {
    if (group.status.kind !== "active") {
      return false;
    }
    const daysLeft = typeof group.status.daysLeft === 'number'
      ? group.status.daysLeft
      : Math.max(0, Math.ceil((new Date(group.status.expiresAt).getTime() - Date.now()) / DAY_MS));
    return daysLeft <= 5;
  }).length;
}

function createMockSnapshot(): DashboardSnapshot {
  const now = new Date();
  const groups: ManagedGroup[] = [
    makeActiveGroup("grp-core", "Core Team", 128, 20),
    makeActiveGroup("grp-security", "Security Watch", 64, 8),
    makeActiveGroup("grp-support", "Support Center", 52, 3),
    makeActiveGroup("grp-marketing", "Marketing Hub", 210, 26),
    makeActiveGroup("grp-ops", "Operations", 89, 14),
    makeExpiredGroup("grp-expired", "Expired Group", 23, 2),
    makeRemovedGroup("grp-removed", "Removed Group", 17, 4),
  ];

  const filtered = groups.filter((group) => {
    if (group.status.kind !== "removed") {
      return true;
    }
    return new Date(group.status.graceEndsAt).getTime() >= now.getTime();
  });

  const metricsList = filtered.map((group) => generateMetrics(group));
  const insights: DashboardInsights = {
    expiringSoon: countExpiringSoon(filtered),
    messagesToday: metricsList.reduce((total, metrics) => total + metrics.messagesToday, 0),
    newMembersToday: metricsList.reduce((total, metrics) => total + metrics.newMembersToday, 0),
  };
  const promoImage = new URL("../../assets/application.png", import.meta.url).href;
  const promotions: DashboardPromotions = {
    rotationSeconds: DEFAULT_PROMO_ROTATION_SECONDS,
    metadata: {
      maxSlots: 5,
      recommendedWidth: PROMO_SLIDE_WIDTH,
      recommendedHeight: PROMO_SLIDE_HEIGHT,
      analyticsLookbackDays: PROMO_ANALYTICS_LOOKBACK_DAYS,
      abTestingEnabled: true,
    },
    canManage: false, // Mock data should not allow management
    slots: [
      {
        id: "promo-sponsor-upgrade",
        title: "Secure more groups with sponsor bundles",
        subtitle: "Activate the sponsor plan and gift seven days of protection to every new community.",
        description: "Sponsor bundles unlock instant credits for your partner communities.",
        imageUrl: promoImage,
        thumbnailUrl: promoImage,
        accentColor: "#1e293b",
        linkUrl: "https://t.me/tgfirewallbot",
        ctaLabel: "Explore plans",
        ctaLink: "https://t.me/tgfirewallbot",
        active: true,
        startsAt: null,
        endsAt: null,
        abTestGroupId: null,
        variant: null,
        position: 0,
        analytics: {
          impressions: 1240,
          clicks: 210,
          ctr: 0.169,
          avgTimeSpent: 5.4,
          bounceRate: 0.32,
        },
        createdAt: new Date(now.getTime() - 7 * DAY_MS).toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: "promo-giveaway",
        title: "Join our exclusive giveaways",
        subtitle: "Win 500 Stars every week and scale your groups without limits.",
        description: "Take part in automated giveaways to boost engagement and reward your members.",
        imageUrl: promoImage,
        thumbnailUrl: promoImage,
        accentColor: "#312e81",
        linkUrl: "https://t.me/tgfirewallbot",
        ctaLabel: "Enter now",
        ctaLink: "https://t.me/tgfirewallbot",
        active: true,
        startsAt: null,
        endsAt: null,
        abTestGroupId: "giveaway-promo",
        variant: "A",
        position: 1,
        analytics: {
          impressions: 980,
          clicks: 188,
          ctr: 0.1918,
          avgTimeSpent: 6.1,
          bounceRate: 0.28,
        },
        createdAt: new Date(now.getTime() - 5 * DAY_MS).toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: "promo-support",
        title: "Connect with the security team",
        subtitle: "Request a free security audit for up to three featured groups each month.",
        description: "Our analysts deliver actionable hardening plans tailored to your communities.",
        imageUrl: promoImage,
        thumbnailUrl: promoImage,
        accentColor: "#0f172a",
        linkUrl: "https://t.me/tgfirewallbot",
        ctaLabel: "Request access",
        ctaLink: "https://t.me/tgfirewallbot",
        active: true,
        startsAt: null,
        endsAt: null,
        abTestGroupId: "security-audit",
        variant: "control",
        position: 2,
        analytics: {
          impressions: 845,
          clicks: 92,
          ctr: 0.1089,
          avgTimeSpent: 4.7,
          bounceRate: 0.36,
        },
        createdAt: new Date(now.getTime() - 3 * DAY_MS).toISOString(),
        updatedAt: now.toISOString(),
      },
    ],
  };

  return {
    ownerId: 1001,
    generatedAt: now.toISOString(),
    groups: filtered,
    insights,
    promotions,
  };
}

function computeDashboardInsightsFromGroups(groups: ManagedGroup[]): DashboardInsights {
  const expiringSoon = groups.filter(
    (group) => group.status.kind === "active" && group.status.daysLeft <= 5,
  ).length;
  return {
    expiringSoon,
    messagesToday: 0,
    newMembersToday: 0,
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function normalizeDashboardInsightsFromApi(groups: ManagedGroup[], raw: unknown): DashboardInsights {
  const fallback = computeDashboardInsightsFromGroups(groups);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const record = raw as Record<string, unknown>;
  const expiringSoon = toFiniteNumber(record.expiringSoon) ?? fallback.expiringSoon;
  const messagesToday = toFiniteNumber(record.messagesToday) ?? fallback.messagesToday;
  const newMembersToday = toFiniteNumber(record.newMembersToday) ?? fallback.newMembersToday;
  return {
    expiringSoon,
    messagesToday,
    newMembersToday,
  };
}

function buildPromotionsFromResponse(response: PromoSlidesResponse | null | undefined): DashboardPromotions {
  if (!response || !Array.isArray(response.slides)) {
    const mock = createMockSnapshot().promotions;
    return mock;
  }
  return {
    slots: response.slides,
    rotationSeconds: DEFAULT_PROMO_ROTATION_SECONDS,
    metadata: {
      maxSlots: 10,
      recommendedWidth: PROMO_SLIDE_WIDTH,
      recommendedHeight: PROMO_SLIDE_HEIGHT,
      analyticsLookbackDays: PROMO_ANALYTICS_LOOKBACK_DAYS,
      abTestingEnabled: true,
    },
    total: response.total,
    canManage: response.canManage ?? false,
  };
}

async function fetchActivePromotionsFromApi(): Promise<DashboardPromotions> {
  if (!apiBaseUrl) {
    return createMockSnapshot().promotions;
  }
  const response = await fetchActivePromoSlides();
  return buildPromotionsFromResponse(response);
}

function createTimeRange(mode: TimeRangeMode, start = "00:00", end = "23:59"): TimeRangeSetting {
  return { mode, start, end };
}

function createGeneralSettings(id: string): GroupGeneralSettings {
  void id;
  return {
    timezone: DEFAULT_TIMEZONE,
    welcomeEnabled: true,
    welcomeSchedule: createTimeRange("all"),
    voteMuteEnabled: false,
    warningEnabled: true,
    warningSchedule: createTimeRange("all"),
    silentModeEnabled: false,
    autoDeleteEnabled: true,
    autoDeleteDelayMinutes: 60,
    countAdminViolationsEnabled: false,
    countAdminsOnly: false,
    deleteAdminViolations: false,
    userVerificationEnabled: false,
    userVerificationSchedule: createTimeRange("all"),
    disablePublicCommands: false,
    disablePublicCommandsSchedule: createTimeRange("all"),
    removeJoinLeaveMessages: true,
    removeJoinLeaveSchedule: createTimeRange("all"),
    autoWarningEnabled: true,
    autoWarning: {
      threshold: 3,
      retentionDays: 14,
      penalty: "mute",
      schedule: createTimeRange("all"),
    },
    defaultPenalty: "delete",
  };
}

function createBanSettings(id: string): GroupBanSettings {
  void id;
  const rules: Record<BanRuleKey, BanRuleSetting> = {} as Record<BanRuleKey, BanRuleSetting>;

  const DEFAULT_ACTIVE_RULES = new Set<BanRuleKey>([
    "banLinks",
    "banDomains",
    "banBots",
    "banBotInviters",
    "banForward",
    "banForwardChannels",
  ]);

  BAN_RULE_KEYS.forEach((key) => {
    if (DEFAULT_ACTIVE_RULES.has(key)) {
      rules[key] = {
        enabled: true,
        schedule: createTimeRange("all"),
      };
      return;
    }

    rules[key] = {
      enabled: false,
      schedule: createTimeRange("all"),
    };
  });

  const blacklist = ["spam", "promo", "http", "lottery", "casino"];
  const whitelist = ["support", "docs", "faq", "help"];

  return {
    rules,
    blacklist,
    whitelist,
  };
}

function createCountLimitSettings(id: string): CountLimitSettings {
  void id;
  return {
    minWordsPerMessage: 0,
    maxWordsPerMessage: 250,
    messagesPerWindow: 5,
    windowMinutes: 1,
    duplicateMessages: 3,
    duplicateWindowMinutes: 10,
  };
}

function createMandatoryMembershipSettings(id: string): MandatoryMembershipSettings {
  void id;
  return {
    forcedInviteCount: 0,
    forcedInviteResetDays: 0,
    mandatoryChannels: [],
  };
}

function createSilenceSettings(id: string): SilenceSettings {
  void id;
  return {
    emergencyLock: {
      enabled: false,
      start: "00:00",
      end: "00:00",
    },
    window1: {
      enabled: false,
      start: "00:00",
      end: "00:00",
    },
    window2: {
      enabled: false,
      start: "00:00",
      end: "00:00",
    },
    window3: {
      enabled: false,
      start: "00:00",
      end: "00:00",
    },
  };
}


const ANALYTICS_MESSAGE_TYPES: AnalyticsMessageType[] = [
  "text",
  "photo",
  "video",
  "voice",
  "gif",
  "sticker",
  "file",
  "link",
  "forward",
];

function createSeededRandom(seed: number): () => number {
  let value = seed % 2147483647;
  if (value <= 0) {
    value += 2147483646;
  }
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function createAnalyticsSnapshot(id: string): GroupAnalyticsSnapshot {
  const seed = hashString(id);
  const timezone = DEFAULT_TIMEZONE;
  const now = new Date();
  const totalHours = 24 * 180;
  const random = createSeededRandom(seed);
  const members: AnalyticsPoint[] = [];
  const messageSeries: AnalyticsMessageSeries[] = ANALYTICS_MESSAGE_TYPES.map((type) => ({ type, points: [] }));

  const typeBase: Record<AnalyticsMessageType, number> = {
    text: 120,
    photo: 45,
    video: 32,
    voice: 18,
    gif: 15,
    sticker: 25,
    file: 12,
    link: 28,
    forward: 20,
  };

  for (let i = totalHours - 1; i >= 0; i -= 1) {
    const timestamp = new Date(now.getTime() - i * 3_600_000);
    const hour = timestamp.getHours();
    const day = timestamp.getDay();
    const dailyCycle = hour >= 8 && hour <= 20 ? 1.2 : 0.6;
    const eveningBoost = hour >= 18 && hour <= 23 ? 1.5 : 1;
    const weekendBoost = day === 4 || day === 5 ? 1.3 : day === 6 ? 1.4 : 1;
    const seasonal = 0.85 + Math.sin((totalHours - i) / 72) * 0.15;

    const membersValue = Math.max(0, Math.round((0.6 * dailyCycle + 0.4 * weekendBoost) * seasonal + random() * 3));
    members.push({ timestamp: timestamp.toISOString(), value: membersValue });

    messageSeries.forEach((series) => {
      const base = typeBase[series.type];
      const activity = base * dailyCycle * eveningBoost * weekendBoost * seasonal;
      const noise = (random() - 0.5) * base * 0.25;
      const value = Math.max(0, Math.round(activity * 0.02 + noise));
      series.points.push({ timestamp: timestamp.toISOString(), value });
    });
  }

  const hoursInSummary = 24 * 30;
  const recentMembers = members.slice(-hoursInSummary);
  const newMembersTotal = recentMembers.reduce((total, point) => total + point.value, 0);

  const recentMessagesTotals: Record<AnalyticsMessageType, number> = {} as Record<AnalyticsMessageType, number>;
  let messagesTotal = 0;
  messageSeries.forEach((series) => {
    const total = series.points.slice(-hoursInSummary).reduce((sum, point) => sum + point.value, 0);
    recentMessagesTotals[series.type] = total;
    messagesTotal += total;
  });

  const averageMessagesPerDay = hoursInSummary > 0 ? Math.round(messagesTotal / 30) : 0;
  const topMessageType = messagesTotal > 0
    ? (Object.entries(recentMessagesTotals).sort((a, b) => b[1] - a[1])[0]?.[0] as AnalyticsMessageType)
    : null;

  const lastPeriodMembers = recentMembers.slice(-24 * 7).reduce((total, point) => total + point.value, 0);
  const prevPeriodMembers = recentMembers.slice(-(24 * 14), -24 * 7).reduce((total, point) => total + point.value, 0);
  const membersTrend = createTrend(lastPeriodMembers, prevPeriodMembers || 1);

  const lastPeriodMessages = messageSeries.reduce((total, series) => total + series.points.slice(-24 * 7).reduce((sum, point) => sum + point.value, 0), 0);
  const prevPeriodMessages = messageSeries.reduce((total, series) => total + series.points.slice(-(24 * 14), -24 * 7).reduce((sum, point) => sum + point.value, 0), 0);
  const messagesTrend = createTrend(lastPeriodMessages, prevPeriodMessages || 1);

  return {
    generatedAt: now.toISOString(),
    timezone,
    members,
    messages: messageSeries,
    summary: {
      newMembersTotal,
      messagesTotal,
      averageMessagesPerDay,
      topMessageType,
      membersTrend,
      messagesTrend,
    },
  };
}


const DEFAULT_CUSTOM_TEXTS: CustomTextSettings = {
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

function createCustomTextSettings(id: string): CustomTextSettings {
  void id;
  return { ...DEFAULT_CUSTOM_TEXTS };
}

export async function fetchDashboardSnapshot(): Promise<DashboardSnapshot> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    return createMockSnapshot();
  }

  try {
    const [groupsResult, promotionsResult] = await Promise.allSettled([
      requestApi<{ groups: ManagedGroup[]; insights?: DashboardInsights }>("/groups", { method: "GET" }),
      fetchActivePromotionsFromApi(),
    ]);

    if (groupsResult.status !== "fulfilled") {
      console.warn("[dashboard] groups request failed", groupsResult.reason);
      if (!dashboardConfig.allowMockFallback) {
        throw (groupsResult.reason instanceof Error
          ? groupsResult.reason
          : new Error("Failed to fetch managed groups"));
      }
      const fallback = createMockSnapshot();
      const promotionsFallback =
        promotionsResult.status === "fulfilled"
          ? promotionsResult.value
          : (() => {
              console.warn("[dashboard] promotions request failed during fallback", promotionsResult.reason);
              return fallback.promotions;
            })();
      return {
        ...fallback,
        promotions: promotionsFallback,
      };
    }

    const groupsResponse = groupsResult.value;
    const groups = Array.isArray(groupsResponse.groups) ? groupsResponse.groups : [];
    const insights = normalizeDashboardInsightsFromApi(groups, groupsResponse.insights);
    const promotions =
      promotionsResult.status === "fulfilled"
        ? promotionsResult.value
        : (() => {
            console.warn("[dashboard] promotions request failed", promotionsResult.reason);
            return buildPromotionsFromResponse(null);
          })();
    return {
      ownerId: 0,
      generatedAt: new Date().toISOString(),
      groups,
      insights,
      promotions,
    };
  } catch (error) {
    console.warn("[dashboard] failed to fetch snapshot", error);
    throw (error instanceof Error ? error : new Error("Failed to fetch dashboard snapshot"));
  }
}

export type CreatePromoSlidePayload = {
  imageData: string;
  fileName?: string;
  linkUrl: string;
  title?: string;
  subtitle?: string;
  description?: string;
  accentColor?: string;
  ctaLabel?: string;
  ctaLink?: string;
  abTestGroupId?: string;
  variant?: string;
  active?: boolean;
  position?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type UpdatePromoSlidePayload = Partial<{
  title: string | null;
  subtitle: string | null;
  description: string | null;
  accentColor: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  linkUrl: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  position: number;
  abTestGroupId: string | null;
  variant: string | null;
  metadata: Record<string, unknown>;
}>;

export type PromoSlideEventType = "view" | "click";

export type PromoSlideEventPayload = {
  durationMs?: number;
  bounced?: boolean;
  variant?: string | null;
};

export async function fetchActivePromoSlides(): Promise<PromoSlidesResponse> {
  if (!apiBaseUrl) {
    const promotions = createMockSnapshot().promotions;
    return {
      slides: promotions.slots,
      total: promotions.slots.length,
      canManage: false, // Mock data should not allow management
    };
  }
  return requestApi<PromoSlidesResponse>("/promo-slides/active", { method: "GET" });
}

export async function fetchAllPromoSlides(): Promise<PromoSlidesResponse> {
  if (!apiBaseUrl) {
    const promotions = createMockSnapshot().promotions;
    return {
      slides: promotions.slots,
      total: promotions.slots.length,
      canManage: false, // Mock data should not allow management
    };
  }
  return requestApi<PromoSlidesResponse>("/promo-slides", { method: "GET" });
}

export async function createPromoSlideEntry(payload: CreatePromoSlidePayload): Promise<DashboardPromoSlot> {
  if (!apiBaseUrl) {
    throw new Error("Promo slide creation is only available with the production backend.");
  }
  return requestApi<DashboardPromoSlot>("/promo-slides", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updatePromoSlideEntry(
  id: string,
  payload: UpdatePromoSlidePayload,
): Promise<DashboardPromoSlot> {
  if (!apiBaseUrl) {
    throw new Error("Promo slide updates are only available with the production backend.");
  }
  return requestApi<DashboardPromoSlot>(`/promo-slides/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deletePromoSlideEntry(id: string): Promise<void> {
  if (!apiBaseUrl) {
    throw new Error("Promo slide deletion is only available with the production backend.");
  }
  await requestApi<void>(`/promo-slides/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function reorderPromoSlideEntries(order: string[]): Promise<DashboardPromoSlot[]> {
  if (!apiBaseUrl) {
    throw new Error("Reordering promo slides requires the production backend.");
  }
  const response = await requestApi<PromoSlidesResponse>("/promo-slides/order", {
    method: "PATCH",
    body: JSON.stringify({ order }),
  });
  return response.slides;
}

export async function trackPromoSlideEvent(
  id: string,
  type: PromoSlideEventType,
  payload: PromoSlideEventPayload = {},
): Promise<void> {
  if (!apiBaseUrl) {
    return;
  }
  await requestApi(`/promo-slides/${encodeURIComponent(id)}/events`, {
    method: "POST",
    body: JSON.stringify({
      type,
      durationMs: payload.durationMs,
      bounced: payload.bounced,
      variant: payload.variant ?? null,
    }),
  });
}

export async function fetchGroupDetails(id: string): Promise<GroupDetail> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    const snapshot = createMockSnapshot();
    const group = snapshot.groups.find((item) => item.id === id);
    if (!group) {
      throw new Error("Group not found.");
    }
    const now = Date.now();
    return {
      group,
      metrics: generateMetrics(group),
      warnings: [
        {
          id: "warn-1",
          member: "User123",
          rule: "Spam detected",
          message: "Posted suspicious link",
          timestamp: new Date(now - 3_600_000).toISOString(),
          severity: "warning",
        },
        {
          id: "warn-2",
          member: "User456",
          rule: "Flood control",
          message: "Too many messages",
          timestamp: new Date(now - 7_200_000).toISOString(),
          severity: "critical",
        },
      ],
      botActions: [
        {
          id: "action-1",
          action: "Deleted spam message",
          target: "User789",
          timestamp: new Date(now - 1_800_000).toISOString(),
          performedBy: "TG Firewall Bot",
          status: "success",
        },
        {
          id: "action-2",
          action: "Muted user for spam",
          target: "User456",
          timestamp: new Date(now - 5_400_000).toISOString(),
          performedBy: "TG Firewall Bot",
          status: "success",
        },
      ],
    };
  }

  return requestApi<GroupDetail>(`/groups/${encodeURIComponent(id)}`, { method: "GET" });
}

export async function fetchGroupGeneralSettings(id: string): Promise<GroupGeneralSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    return createGeneralSettings(id);
  }
  return requestApi<GroupGeneralSettings>(`/groups/${encodeURIComponent(id)}/settings/general`, { method: "GET" });
}

export async function updateGroupGeneralSettings(
  id: string,
  settings: GroupGeneralSettings,
): Promise<GroupGeneralSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    console.info(`[settings] general settings saved for ${id}`, settings);
    return settings;
  }
  return requestApi<GroupGeneralSettings>(`/groups/${encodeURIComponent(id)}/settings/general`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function fetchGroupBanSettings(id: string): Promise<GroupBanSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    return createBanSettings(id);
  }
  return requestApi<GroupBanSettings>(`/groups/${encodeURIComponent(id)}/settings/bans`, { method: "GET" });
}

export async function updateGroupBanSettings(
  id: string,
  settings: GroupBanSettings,
): Promise<GroupBanSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    console.info(`[settings] ban rules saved for ${id}`, settings);
    return settings;
  }
  return requestApi<GroupBanSettings>(`/groups/${encodeURIComponent(id)}/settings/bans`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function fetchGroupCountLimitSettings(id: string): Promise<CountLimitSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    return createCountLimitSettings(id);
  }
  return requestApi<CountLimitSettings>(`/groups/${encodeURIComponent(id)}/settings/limits`, { method: "GET" });
}

export async function updateGroupCountLimitSettings(
  id: string,
  settings: CountLimitSettings,
): Promise<CountLimitSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    console.info(`[settings] count limits saved for ${id}`, settings);
    return settings;
  }
  return requestApi<CountLimitSettings>(`/groups/${encodeURIComponent(id)}/settings/limits`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function fetchGroupMandatoryMembershipSettings(id: string): Promise<MandatoryMembershipSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    return createMandatoryMembershipSettings(id);
  }
  return requestApi<MandatoryMembershipSettings>(`/groups/${encodeURIComponent(id)}/settings/mandatory`, {
    method: "GET",
  });
}

export async function updateGroupMandatoryMembershipSettings(
  id: string,
  settings: MandatoryMembershipSettings,
): Promise<MandatoryMembershipSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    console.info(`[settings] mandatory membership saved for ${id}`, settings);
    return settings;
  }
  return requestApi<MandatoryMembershipSettings>(`/groups/${encodeURIComponent(id)}/settings/mandatory`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function fetchGroupCustomTextSettings(id: string): Promise<CustomTextSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    return createCustomTextSettings(id);
  }
  return requestApi<CustomTextSettings>(`/groups/${encodeURIComponent(id)}/settings/custom-texts`, {
    method: "GET",
  });
}

export async function updateGroupCustomTextSettings(
  id: string,
  settings: CustomTextSettings,
): Promise<CustomTextSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    console.info(`[settings] custom texts saved for ${id}`, settings);
    return settings;
  }
  return requestApi<CustomTextSettings>(`/groups/${encodeURIComponent(id)}/settings/custom-texts`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function fetchGroupSilenceSettings(id: string): Promise<SilenceSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    return createSilenceSettings(id);
  }
  return requestApi<SilenceSettings>(`/groups/${encodeURIComponent(id)}/settings/silence`, { method: "GET" });
}

export async function updateGroupSilenceSettings(
  id: string,
  settings: SilenceSettings,
): Promise<SilenceSettings> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    console.info(`[settings] silence settings saved for ${id}`, settings);
    return settings;
  }
  return requestApi<SilenceSettings>(`/groups/${encodeURIComponent(id)}/settings/silence`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function fetchGroupAnalytics(id: string): Promise<GroupAnalyticsSnapshot> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    return createAnalyticsSnapshot(id);
  }

  return requestApi<GroupAnalyticsSnapshot>(`/groups/${encodeURIComponent(id)}/analytics`, {
    method: "GET",
  });
}

export async function updateGroupLockStatus(id: string, locked: boolean): Promise<void> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    console.info(`[Mock] Group ${id} lock status:`, locked);
    return;
  }

  await requestApi<void>(`/groups/${encodeURIComponent(id)}/lock`, {
    method: "POST",
    body: JSON.stringify({ locked }),
  });
}

function buildStarsStatus(group: ManagedGroup): GroupStarsStatus {
  const now = Date.now();
  let expiresAt = new Date(now).toISOString();
  let daysLeft = 0;

  if (group.status.kind === "active") {
    expiresAt = group.status.expiresAt;
    if (typeof group.status.daysLeft === "number") {
      daysLeft = Math.max(0, group.status.daysLeft);
    } else {
      const diff = Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS);
      daysLeft = Number.isFinite(diff) ? Math.max(0, diff) : 0;
    }
  } else if (group.status.kind === "expired") {
    expiresAt = group.status.expiredAt;
  } else {
    expiresAt = group.status.graceEndsAt;
  }

  let status: "active" | "expiring" | "expired";
  if (daysLeft <= 0) {
    status = "expired";
  } else if (daysLeft <= 5) {
    status = "expiring";
  } else {
    status = "active";
  }

  return {
    group,
    expiresAt,
    daysLeft,
    status,
  };
}

function createStarsOverview(): StarsOverview {
  const snapshot = createMockSnapshot();
  const groups = snapshot.groups
    .filter((group) => group.canManage && group.status.kind !== "removed")
    .map((group) => buildStarsStatus(group))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    balance: 2400,
    groups,
    plans: STARS_PLANS.map((plan) => ({ ...plan })),
  };
}

function resolveStarsPlan(planId: string): StarsPlan {
  const plan = STARS_PLANS.find((item) => item.id === planId);
  if (!plan) {
    throw new Error("Stars plan not found.");
  }
  return plan;
}

function createStarsPurchaseResult(
  groupId: string,
  planId: string,
  gifted: boolean,
  status: "pending" | "completed" | "refunded" = "completed",
): StarsPurchaseResult {
  const normalizedPlanId = planId.trim();
  const plan = resolveStarsPlan(normalizedPlanId);
  const completed = status === "completed";
  const refunded = status === "refunded";
  const expiresAt = completed ? new Date(Date.now() + plan.days * DAY_MS).toISOString() : null;
  const balanceDelta = completed ? -plan.price : refunded ? plan.price : 0;
  return {
    transactionId: `mock-${Date.now()}`,
    status,
    groupId,
    planId: normalizedPlanId,
    daysAdded: completed ? plan.days : 0,
    expiresAt,
    balanceDelta,
    gifted,
    paymentUrl: completed || refunded ? null : "https://t.me/mock-payment",
    message: completed ? null : refunded ? "Transaction refunded." : "Awaiting payment confirmation.",
  };
}
async function mockFetchStarsOverview(): Promise<StarsOverview> {
  await delay(dashboardConfig.mockDelayMs);
  return createStarsOverview();
}

async function mockPurchaseStarsForGroup(groupId: string, planId: string): Promise<StarsPurchaseResult> {
  await delay(dashboardConfig.mockDelayMs);
  return createStarsPurchaseResult(groupId, planId, false);
}

async function mockGiftStarsToGroup(groupId: string, planId: string): Promise<StarsPurchaseResult> {
  await delay(dashboardConfig.mockDelayMs);
  return createStarsPurchaseResult(groupId, planId, true);
}

async function mockFetchStarsWalletSummary(): Promise<StarsWalletSummary> {
  await delay(dashboardConfig.mockDelayMs);
  const now = Date.now();
  const transactions: StarsTransactionEntry[] = [
    {
      id: `txn-${now - 1}`,
      status: "completed",
      direction: "debit",
      amount: -60,
      planId: "stars-30",
      planLabel: "30 days - 60 Stars",
      planDays: 30,
      planPrice: 60,
      groupId: "grp-alpha",
      groupTitle: "Alpha Guardians",
      gifted: false,
      createdAt: new Date(now - DAY_MS * 2).toISOString(),
      completedAt: new Date(now - DAY_MS * 2 + 300_000).toISOString(),
      externalId: null,
      invoiceLink: null,
    },
    {
      id: `txn-${now - 2}`,
      status: "refunded",
      direction: "credit",
      amount: 60,
      planId: "stars-30",
      planLabel: "30 days - 60 Stars",
      planDays: 30,
      planPrice: 60,
      groupId: "grp-beta",
      groupTitle: "Beta Keepers",
      gifted: true,
      createdAt: new Date(now - DAY_MS * 3).toISOString(),
      completedAt: new Date(now - DAY_MS * 3 + 600_000).toISOString(),
      externalId: null,
      invoiceLink: null,
    },
    {
      id: `txn-${now}`,
      status: "pending",
      direction: "debit",
      amount: -120,
      planId: "stars-60",
      planLabel: "60 days - 120 Stars",
      planDays: 60,
      planPrice: 120,
      groupId: "grp-gamma",
      groupTitle: "Gamma Patrol",
      gifted: false,
      createdAt: new Date(now - 600_000).toISOString(),
      completedAt: null,
      externalId: null,
      invoiceLink: "https://t.me/mock-payment",
    },
  ];

  return {
    balance: 2400,
    currency: "stars",
    totalSpent: 60,
    totalRefunded: 60,
    pendingCount: 1,
    transactions,
  };
}

async function mockRefundStarsTransaction(transactionId: string): Promise<StarsPurchaseResult> {
  await delay(dashboardConfig.mockDelayMs);
  return {
    transactionId,
    status: "refunded",
    groupId: "grp-alpha",
    planId: "stars-30",
    daysAdded: 0,
    expiresAt: null,
    balanceDelta: 60,
    gifted: false,
    paymentUrl: null,
    message: "Transaction refunded.",
  };
}

async function mockSearchGroupsForStars(query: string): Promise<ManagedGroup[]> {
  await delay(dashboardConfig.mockDelayMs);
  const normalized = normalizeSearchText(query);
  const identifier = normalizeSearchIdentifier(query);
  const snapshot = createMockSnapshot();

  if (!normalized && !identifier) {
    return snapshot.groups.slice(0, 6);
  }

  return snapshot.groups
    .filter((group) => {
      const titleTerm = normalizeSearchText(group.title);
      const idTerm = normalizeSearchText(group.id);
      const inviteTerm = normalizeSearchText(group.inviteLink ?? "");
      const inviteIdentifier = normalizeSearchIdentifier(group.inviteLink ?? "");

      const matchesTitle = normalized ? titleTerm.includes(normalized) : false;
      const matchesId = identifier ? idTerm.includes(identifier) : false;
      const matchesIdFallback = normalized ? idTerm.includes(normalized) : false;
      const matchesInvite = normalized ? inviteTerm.includes(normalized) : false;
      const matchesInviteIdentifier = identifier ? inviteIdentifier.includes(identifier) : false;

      return matchesTitle || matchesId || matchesIdFallback || matchesInvite || matchesInviteIdentifier;
    })
    .slice(0, 6);
}

export async function fetchStarsOverview(): Promise<StarsOverview> {
  if (!apiBaseUrl) {
    return mockFetchStarsOverview();
  }
  return requestApi<StarsOverview>("/stars/overview", { method: "GET" });
}

export async function purchaseStarsForGroup(
  groupId: string,
  planId: string,
  metadata?: Partial<ManagedGroup>,
): Promise<StarsPurchaseResult> {
  if (!apiBaseUrl) {
    return mockPurchaseStarsForGroup(groupId, planId);
  }
  return requestApi<StarsPurchaseResult>("/stars/purchase", {
    method: "POST",
    body: JSON.stringify({
      groupId: groupId.trim(),
      planId: planId.trim(),
      metadata: {
        title: metadata?.title,
        membersCount: metadata?.membersCount,
        inviteLink: metadata?.inviteLink,
        photoUrl: metadata?.photoUrl,
        managed: true,
      },
    }),
  });
}

export async function giftStarsToGroup(
  group: ManagedGroup,
  planId: string,
): Promise<StarsPurchaseResult> {
  if (!apiBaseUrl) {
    return mockGiftStarsToGroup(group.id, planId);
  }
  return requestApi<StarsPurchaseResult>("/stars/gift", {
    method: "POST",
    body: JSON.stringify({
      planId: planId.trim(),
      group: {
        id: group.id,
        title: group.title,
        membersCount: group.membersCount,
        photoUrl: group.photoUrl,
        inviteLink: group.inviteLink,
        canManage: group.canManage,
      },
    }),
  });
}

export async function searchGroupsForStars(query: string): Promise<ManagedGroup[]> {
  if (!apiBaseUrl) {
    return mockSearchGroupsForStars(query);
  }
  const qs = new URLSearchParams();
  if (query.trim().length > 0) {
    qs.set("q", query.trim());
  }
  const path = qs.toString().length > 0 ? `/stars/search?${qs.toString()}` : "/stars/search";
  return requestApi<ManagedGroup[]>(path, { method: "GET" });
}

export async function fetchStarsWalletSummary(limit = 50): Promise<StarsWalletSummary> {
  if (!apiBaseUrl) {
    return mockFetchStarsWalletSummary();
  }
  const normalizedLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 50;
  const qs = new URLSearchParams();
  qs.set("limit", normalizedLimit.toString());
  const path = `/stars/wallet?${qs.toString()}`;
  return requestApi<StarsWalletSummary>(path, { method: "GET" });
}

export async function refundStarsTransaction(transactionId: string, reason?: string): Promise<StarsPurchaseResult> {
  if (!apiBaseUrl) {
    return mockRefundStarsTransaction(transactionId);
  }
  return requestApi<StarsPurchaseResult>(`/stars/transactions/${transactionId}/refund`, {
    method: "POST",
    body: JSON.stringify({
      reason: reason && reason.trim().length > 0 ? reason.trim() : undefined,
    }),
  });
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSearchIdentifier(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?t\.me\//, "")
    .replace(/^@+/, "");
}

export async function fetchGiveawayConfig(): Promise<GiveawayConfig> {
  if (!apiBaseUrl) {
    throw new Error("Giveaway API is not configured.");
  }
  return requestApi<GiveawayConfig>("/giveaways/config", { method: "GET" });
}

export async function fetchGiveawayDashboard(): Promise<GiveawayDashboardData> {
  if (!apiBaseUrl) {
    throw new Error("Giveaway API is not configured.");
  }
  return requestApi<GiveawayDashboardData>("/giveaways/dashboard", { method: "GET" });
}

export async function createGiveaway(payload: GiveawayCreationPayload): Promise<GiveawayCreationResult> {
  if (!apiBaseUrl) {
    throw new Error("Giveaway API is not configured.");
  }
  return requestApi<GiveawayCreationResult>("/giveaways", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchGiveawayDetail(id: string): Promise<GiveawayDetail> {
  if (!apiBaseUrl) {
    throw new Error("Giveaway API is not configured.");
  }
  return requestApi<GiveawayDetail>(`/giveaways/${encodeURIComponent(id)}`, { method: "GET" });
}

export async function joinGiveaway(id: string): Promise<GiveawayDetail> {
  if (!apiBaseUrl) {
    throw new Error("Giveaway API is not configured.");
  }
  return requestApi<GiveawayDetail>(`/giveaways/${encodeURIComponent(id)}/join`, {
    method: "POST",
  });
}

// Broadcast API functions
export async function fetchBroadcasts(): Promise<{ broadcasts: any[]; total: number }> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    return {
      broadcasts: [
        {
          id: 'mock-1',
          message: 'Welcome to Firewall! This is a sample broadcast message.',
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: 'mock-2', 
          message: 'System maintenance scheduled for tomorrow at 2 AM UTC.',
          createdAt: new Date(Date.now() - 172800000).toISOString(),
        }
      ],
      total: 2,
    };
  }
  return requestApi<{ broadcasts: any[]; total: number }>("/broadcasts", { method: "GET" });
}

export async function createBroadcast(message: string, confirm: boolean): Promise<any> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    console.info('[broadcast] mock broadcast created', { message, confirm });
    return {
      success: true,
      broadcast: {
        id: `mock-${Date.now()}`,
        message,
        createdAt: new Date().toISOString(),
      }
    };
  }
  return requestApi<any>("/broadcasts", {
    method: "POST",
    body: JSON.stringify({ message, confirm }),
  });
}

export async function fetchBroadcastStats(): Promise<any> {
  if (!apiBaseUrl) {
    await delay(dashboardConfig.mockDelayMs);
    return {
      total: 12,
      last30Days: 3,
      avgPerMonth: 4,
      lastBroadcast: new Date(Date.now() - 86400000).toISOString(),
    };
  }
  return requestApi<any>("/broadcasts/stats", { method: "GET" });
}
