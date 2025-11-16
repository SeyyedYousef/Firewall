export type GroupStatusActive = {
  kind: "active";
  expiresAt: string;
  daysLeft: number;
};

export type GroupStatusExpired = {
  kind: "expired";
  expiredAt: string;
  graceEndsAt: string;
};

export type GroupStatusRemoved = {
  kind: "removed";
  removedAt: string;
  graceEndsAt: string;
};

export type GroupStatus = GroupStatusActive | GroupStatusExpired | GroupStatusRemoved;

export interface ManagedGroup {
  id: string;
  title: string;
  photoUrl?: string | null;
  membersCount: number;
  status: GroupStatus;
  canManage: boolean;
  inviteLink?: string | null;
}

export interface DashboardInsights {
  expiringSoon: number;
  messagesToday: number;
  newMembersToday: number;
}

export interface PromoSlideAnalytics {
  impressions: number;
  clicks: number;
  ctr: number;
  avgTimeSpent: number;
  bounceRate: number;
}

export interface DashboardPromoSlot {
  id: string;
  title: string | null;
  subtitle?: string | null;
  description?: string | null;
  imageUrl: string;
  thumbnailUrl?: string | null;
  accentColor?: string | null;
  linkUrl?: string | null;
  ctaLabel?: string | null;
  ctaLink?: string | null;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  abTestGroupId?: string | null;
  variant?: string | null;
  position: number;
  analytics: PromoSlideAnalytics;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardPromoMetadata {
  maxSlots: number;
  recommendedWidth: number;
  recommendedHeight: number;
  analyticsLookbackDays?: number;
  abTestingEnabled?: boolean;
}

export interface DashboardPromotions {
  slots: DashboardPromoSlot[];
  rotationSeconds: number;
  metadata: DashboardPromoMetadata;
  canManage: boolean;
  total?: number;
}

export interface DashboardSnapshot {
  ownerId: number;
  groups: ManagedGroup[];
  generatedAt: string;
  insights: DashboardInsights;
  promotions: DashboardPromotions;
}

export type Trend = {
  direction: "up" | "down" | "flat";
  percent: number;
};

export interface GroupMetrics {
  membersTotal: number;
  membersTrend: Trend;
  remainingMs: number;
  isExpired: boolean;
  messagesToday: number;
  messagesTrend: Trend;
  newMembersToday: number;
  newMembersTrend: Trend;
}

export interface GroupWarning {
  id: string;
  member: string;
  rule: string;
  message: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface GroupBotAction {
  id: string;
  action: string;
  target?: string | null;
  timestamp: string;
  performedBy: string;
  status: 'success' | 'failed';
}

export interface GroupDetail {
  group: ManagedGroup;
  metrics: GroupMetrics;
  warnings: GroupWarning[];
  botActions: GroupBotAction[];
}

export type TimeRangeMode = "all" | "custom";

export interface TimeRangeSetting {
  mode: TimeRangeMode;
  start: string;
  end: string;
}

export type AutoWarningPenalty = "delete" | "mute" | "kick";

export interface AutoWarningConfig {
  threshold: number;
  retentionDays: number;
  penalty: AutoWarningPenalty;
  schedule: TimeRangeSetting;
}

export interface GroupGeneralSettings {
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
  autoWarning: AutoWarningConfig;
  defaultPenalty: AutoWarningPenalty;
}

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
  "banCrossReplies"
] as const;

export type BanRuleKey = typeof BAN_RULE_KEYS[number];

export interface BanRuleSetting {
  enabled: boolean;
  schedule: TimeRangeSetting;
}



export interface CustomTextSettings {
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
}
export interface MandatoryMembershipSettings {
  forcedInviteCount: number;
  forcedInviteResetDays: number;
  mandatoryChannels: string[];
}

export interface CountLimitSettings {
  minWordsPerMessage: number;
  maxWordsPerMessage: number;
  messagesPerWindow: number;
  windowMinutes: number;
  duplicateMessages: number;
  duplicateWindowMinutes: number;
}

export interface SilenceWindowSetting {
  enabled: boolean;
  start: string;
  end: string;
}

export interface SilenceSettings {
  emergencyLock: SilenceWindowSetting;
  window1: SilenceWindowSetting;
  window2: SilenceWindowSetting;
  window3: SilenceWindowSetting;
}

export interface GroupBanSettings {
  rules: Record<BanRuleKey, BanRuleSetting>;
  blacklist: string[];
  whitelist: string[];
}

export type AnalyticsMessageType =
  | "text"
  | "photo"
  | "video"
  | "voice"
  | "gif"
  | "sticker"
  | "file"
  | "link"
  | "forward";

export type AnalyticsGranularity = "hour" | "day" | "week" | "month";

export interface AnalyticsPoint {
  timestamp: string;
  value: number;
}

export interface AnalyticsMessageSeries {
  type: AnalyticsMessageType;
  points: AnalyticsPoint[];
}

export interface GroupAnalyticsSummary {
  newMembersTotal: number;
  messagesTotal: number;
  averageMessagesPerDay: number;
  topMessageType: AnalyticsMessageType | null;
  membersTrend: Trend;
  messagesTrend: Trend;
}

export interface GroupAnalyticsSnapshot {
  generatedAt: string;
  timezone: string;
  members: AnalyticsPoint[];
  messages: AnalyticsMessageSeries[];
  summary: GroupAnalyticsSummary;
}
export interface StarsPlan {
  id: string;
  days: number;
  price: number;
  label?: string;
  description?: string;
}

export type StarsStatus = "active" | "expiring" | "expired";

export interface GroupStarsStatus {
  group: ManagedGroup;
  expiresAt: string;
  daysLeft: number;
  status: StarsStatus;
}

export interface StarsOverview {
  balance: number;
  groups: GroupStarsStatus[];
  plans: StarsPlan[];
}

export interface StarsPurchaseResult {
  transactionId: string;
  status: "pending" | "completed" | "refunded";
  groupId: string | null;
  planId: string;
  daysAdded: number;
  expiresAt: string | null;
  balanceDelta: number;
  gifted: boolean;
  paymentUrl?: string | null;
  message?: string | null;
}

export type StarsTransactionStatus = "pending" | "completed" | "refunded";

export type StarsTransactionDirection = "debit" | "credit";

export interface StarsTransactionEntry {
  id: string;
  status: StarsTransactionStatus;
  direction: StarsTransactionDirection;
  amount: number;
  planId: string | null;
  planLabel: string | null;
  planDays: number | null;
  planPrice: number | null;
  groupId: string | null;
  groupTitle: string | null;
  gifted: boolean;
  createdAt: string;
  completedAt: string | null;
  externalId: string | null;
  invoiceLink: string | null;
}

export interface StarsWalletSummary {
  balance: number;
  currency: string;
  totalSpent: number;
  totalRefunded: number;
  pendingCount: number;
  transactions: StarsTransactionEntry[];
}

export type GiveawayStatus = "scheduled" | "active" | "completed" | "cancelled";

export interface GiveawayParticipantValidation {
  oneJoinPerUser: boolean;
  minAccountAge: number;
  blockBots: boolean;
}

export interface GiveawayRefundConditions {
  minParticipants: number;
  autoRefundIfLowTurnout: boolean;
  cancelGracePeriod: number;
}

export interface GiveawayAnalytics {
  participationRate: number;
  conversionToMember: number;
  engagementScore: number;
  costPerAcquisition: number;
}

export interface GiveawayPlanOption {
  id: string;
  starsPlanId: string;
  title: string;
  days: number;
  basePrice: number;
  pricePerWinner: number;
  description?: string;
}

export interface GiveawayPrizeBreakdown {
  planId: string;
  days: number;
  winners: number;
  pricePerWinner: number;
  totalCost: number;
}

export interface GiveawayRequirement {
  premiumOnly: boolean;
  targetChannel: string;
  extraChannel?: string | null;
}

export interface GiveawayWinnerCode {
  code: string;
  message: string;
}

export interface GiveawaySummary {
  id: string;
  title: string;
  status: GiveawayStatus;
  prize: GiveawayPrizeBreakdown;
  participants: number;
  winnersCount: number;
  startsAt: string;
  endsAt: string;
  targetGroup: ManagedGroup;
  requirements: GiveawayRequirement;
  winnerCodes?: GiveawayWinnerCode[];
  validation: GiveawayParticipantValidation;
  refundPolicy: GiveawayRefundConditions;
  analytics: GiveawayAnalytics;
  cancellationReason?: string | null;
}


export interface GiveawayDashboardData {
  balance: number;
  currency: string;
  active: GiveawaySummary[];
  past: GiveawaySummary[];
}

export interface GiveawayConfig {
  plans: GiveawayPlanOption[];
  durationOptions: number[];
  allowCustomDuration: boolean;
  validation: GiveawayParticipantValidation;
  refundPolicy: GiveawayRefundConditions;
}

export interface GiveawayCreationPayload {
  groupId: string;
  planId: string;
  winners: number;
  durationHours: number;
  premiumOnly: boolean;
  chatBoosterOnly?: boolean;
  inviteUniqueFriend?: boolean;
  includedChannels?: string[];
  externalLinks?: string[];
  notifyStart: boolean;
  notifyEnd: boolean;
  extraChannel?: string | null;
  title?: string;
}

export interface GiveawayCreationResult {
  id: string;
  totalCost: number;
  status: GiveawayStatus;
  createdAt: string;
  balance: number;
}

export interface GiveawayDetail extends GiveawaySummary {
  joined: boolean;
  remainingSeconds: number;
  totalCost: number;
  premiumOnly: boolean;
}


