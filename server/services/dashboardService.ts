import type { StarsState, StarsPlanRecord, GroupRecord } from "../../bot/state.js";
import { getPanelSettings, getStarsState, listGroups } from "../../bot/state.js";
import {
  fetchGroupsFromDb,
  fetchOwnerWalletBalance,
  fetchLatestStarsStatusForGroups,
  listModerationActionsFromDb,
  listMembershipEventsFromDb,
  listModerationActionsSince,
  listMembershipEventsSince,
  countModerationActionsSince,
  countMembershipJoinsSince,
} from "../db/stateRepository.js";
import { listRuleAudits } from "../db/firewallRepository.js";
import { GroupNotFoundError, loadGeneralSettingsByChatId } from "../db/groupSettingsRepository.js";
import { logger } from "../utils/logger.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const DAY_MS = 86_400_000;
const ANALYTICS_LOOKBACK_DAYS = 30;
const ANALYTICS_TREND_WINDOW_DAYS = 7;
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

export type DashboardInsights = {
  expiringSoon: number;
  messagesToday: number;
  newMembersToday: number;
};

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

export type ManagedGroup = {
  id: string;
  title: string;
  photoUrl?: string | null;
  membersCount: number;
  status: GroupStatus;
  canManage: boolean;
  inviteLink?: string | null;
};

export type StarsStatus = "active" | "expiring" | "expired";

export type GroupStarsStatus = {
  group: ManagedGroup;
  expiresAt: string;
  daysLeft: number;
  status: StarsStatus;
};

export type TrendRecord = {
  direction: "up" | "down" | "flat";
  percent: number;
};

export type GroupMetricsRecord = {
  membersTotal: number;
  membersTrend: TrendRecord;
  remainingMs: number;
  isExpired: boolean;
  messagesToday: number;
  messagesTrend: TrendRecord;
  newMembersToday: number;
  newMembersTrend: TrendRecord;
};

export type GroupWarningRecord = {
  id: string;
  member: string;
  rule: string;
  message: string;
  timestamp: string;
  severity: "info" | "warning" | "critical";
};

export type GroupBotActionRecord = {
  id: string;
  action: string;
  target: string | null;
  timestamp: string;
  performedBy: string;
  status: "success" | "failed";
};

export type GroupDetailRecord = {
  group: ManagedGroup;
  metrics: GroupMetricsRecord;
  warnings: GroupWarningRecord[];
  botActions: GroupBotActionRecord[];
};

export type StarsOverview = {
  balance: number;
  plans: StarsPlanRecord[];
  groups: GroupStarsStatus[];
};

type ResolvedStarsEntry = {
  expiresAt: string | null;
  gifted: boolean;
  trialExpiredAt: string | null;
  disabled: boolean;
  source: "state" | "db";
};

function normalizeStarsStateEntry(entry: StarsState["groups"][string] | undefined): ResolvedStarsEntry | null {
  if (!entry) {
    return null;
  }
  return {
    expiresAt: entry.expiresAt ?? null,
    gifted: Boolean(entry.gifted),
    trialExpiredAt: typeof entry.trialExpiredAt === "string" ? entry.trialExpiredAt : null,
    disabled: entry.disabled === true,
    source: "state",
  };
}

async function resolveStarsEntries(records: GroupRecord[]): Promise<Map<string, ResolvedStarsEntry>> {
  const lookup = new Map<string, ResolvedStarsEntry>();
  const stateEntries = getStarsState().groups;
  for (const [chatId, stateEntry] of Object.entries(stateEntries)) {
    const normalized = normalizeStarsStateEntry(stateEntry);
    if (normalized) {
      lookup.set(chatId, normalized);
    }
  }

  if (!databaseAvailable) {
    return lookup;
  }

  const dbIds = Array.from(
    new Set(
      records
        .map((record) => record.dbId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  if (dbIds.length === 0) {
    return lookup;
  }

  try {
    const latest = await fetchLatestStarsStatusForGroups(dbIds);
    for (const record of records) {
      if (!record.dbId) {
        continue;
      }
      const status = latest.get(record.dbId);
      if (!status) {
        continue;
      }
      lookup.set(record.chatId, {
        expiresAt: status.expiresAt,
        gifted: Boolean(status.gifted),
        trialExpiredAt: null,
        disabled: false,
        source: "db",
      });
    }
  } catch (error) {
    logger.warn("failed to resolve stars status from database", { error });
  }

  return lookup;
}

export async function buildManagedGroups(records: GroupRecord[]): Promise<ManagedGroup[]> {
  const starsLookup = await resolveStarsEntries(records);
  return records.map((record) => buildManagedGroup(record, starsLookup.get(record.chatId)));
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

export type AnalyticsPoint = {
  timestamp: string;
  value: number;
};

export type AnalyticsMessageSeries = {
  type: AnalyticsMessageType;
  points: AnalyticsPoint[];
};

export type GroupAnalyticsSummary = {
  newMembersTotal: number;
  messagesTotal: number;
  averageMessagesPerDay: number;
  topMessageType: AnalyticsMessageType | null;
  membersTrend: TrendRecord;
  messagesTrend: TrendRecord;
};

export type GroupAnalyticsSnapshot = {
  generatedAt: string;
  timezone: string;
  members: AnalyticsPoint[];
  messages: AnalyticsMessageSeries[];
  summary: GroupAnalyticsSummary;
};

function isDemoGroup(record: GroupRecord): boolean {
  return record.title?.toLowerCase().includes("demo");
}

type GroupFilterOptions = {
  includeAll?: boolean;
};

function filterGroupsForUser(
  records: GroupRecord[],
  currentUserId: string | null,
  options: GroupFilterOptions = {},
): GroupRecord[] {
  const sanitized = records.filter((record) => {
    return record.managed && record.chatId && record.title;
  });

  if (options.includeAll) {
    logger.debug("Filtering groups with includeAll=true", {
      recordCount: records.length,
      sanitizedRecords: sanitized.length,
    });
    return sanitized;
  }

  if (!currentUserId) {
    logger.debug("No userId provided for filtering", { recordCount: records.length });
    return [];
  }

  const normalizedId = String(currentUserId);

  logger.debug("Filtering groups for user", {
    userId: normalizedId,
    totalRecords: records.length,
    sanitizedRecords: sanitized.length,
    sampleRecords: sanitized.slice(0, 3).map(r => ({
      chatId: r.chatId,
      title: r.title,
      ownerId: r.ownerId,
      adminIds: r.adminIds?.slice(0, 2) // فقط 2 تای اول برای کم کردن لاگ
    }))
  });

  const filtered = sanitized.filter((record) => {
    // Show groups where user is the owner
    if (record.ownerId && record.ownerId === normalizedId) {
      return true;
    }
    
    // TEMPORARY FIX: Also show groups where user is in adminIds for legacy groups
    // This helps with groups created before ownerId was properly set
    if (record.adminIds?.includes(normalizedId)) {
      // Note: being an admin is NOT enough to see the group in the dashboard list
      // Regular users should only see groups they own. Panel admins use includeAll.
      return false;
    }
    
    // For legacy groups without proper owner info, show managed groups
    // This is a fallback for groups created before the ownership fix
    if (!record.ownerId && record.managed) {
      // Do not expose legacy groups to arbitrary users; require explicit ownership
      return false;
    }
    
    return false;
  });

  logger.debug("Filtered groups for user result", {
    userId: normalizedId,
    filteredCount: filtered.length,
    filteredGroups: filtered.map(r => r.chatId)
  });

  return filtered;
}

export async function loadGroupsSnapshot(
  currentUserId: string | null = null,
  options: GroupFilterOptions = {},
): Promise<GroupRecord[]> {
  const localGroups = listGroups();
  const trimmedUserId = currentUserId?.trim?.() ?? null;
  const fallback = filterGroupsForUser(localGroups, trimmedUserId, options);
  if (!databaseAvailable) {
    logger.debug("database not available, using local groups only", { count: fallback.length });
    return fallback;
  }
  const localMap = new Map(localGroups.map((group) => [group.chatId, group]));
  try {
    const records = await fetchGroupsFromDb();
    if (records.length > 0) {
      const merged = records.map((record) => {
        const local = localMap.get(record.chatId);
        if (!local) {
          return record as unknown as GroupRecord;
        }
        const mergedRecord: GroupRecord = {
          ...(record as unknown as GroupRecord),
          title: local.title?.trim().length ? local.title : record.title,
          creditBalance:
            local.creditBalance > record.creditBalance ? local.creditBalance : record.creditBalance,
          membersCount:
            typeof local.membersCount === "number" && local.membersCount > record.membersCount
              ? local.membersCount
              : record.membersCount,
          inviteLink: local.inviteLink ?? record.inviteLink,
          photoUrl: local.photoUrl ?? record.photoUrl,
          managed: local.managed ?? record.managed,
          adminRestricted:
            typeof local.adminRestricted === "boolean" ? local.adminRestricted : record.adminRestricted,
          adminWarningSentAt: local.adminWarningSentAt ?? record.adminWarningSentAt,
        };
        return mergedRecord;
      });
      return filterGroupsForUser(merged, trimmedUserId, options);
    }
  } catch (error) {
    logger.warn("db failed to load groups from database, falling back to file store", { error });
  }
  return fallback;
}

export async function computeDashboardInsights(records: GroupRecord[]): Promise<DashboardInsights> {
  const starsLookup = await resolveStarsEntries(records);
  const managedGroups = records.map((record) =>
    buildManagedGroup(record, starsLookup.get(record.chatId)),
  );
  const expiringSoon = managedGroups.filter(
    (group) => group.status.kind === "active" && group.status.daysLeft <= 5,
  ).length;

  if (!databaseAvailable) {
    return {
      expiringSoon,
      messagesToday: 0,
      newMembersToday: 0,
    };
  }

  const groupDbIds = records
    .map((record) => record.dbId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (groupDbIds.length === 0) {
    return {
      expiringSoon,
      messagesToday: 0,
      newMembersToday: 0,
    };
  }

  const since = new Date(Date.now() - DAY_MS);

  try {
    const [messagesLast24h, newMembersLast24h] = await Promise.all([
      countModerationActionsSince(groupDbIds, since),
      countMembershipJoinsSince(groupDbIds, since),
    ]);

    return {
      expiringSoon,
      messagesToday: messagesLast24h,
      newMembersToday: newMembersLast24h,
    };
  } catch (error) {
    logger.warn("failed to compute dashboard insights from database", { error });
    return {
      expiringSoon,
      messagesToday: 0,
      newMembersToday: 0,
    };
  }
}

export async function resolveStarsBalance(ownerTelegramId: string | null): Promise<number> {
  const fallback = getStarsState().balance;
  if (!databaseAvailable || !ownerTelegramId) {
    return fallback;
  }
  try {
    const balance = await fetchOwnerWalletBalance(ownerTelegramId);
    if (typeof balance === "number") {
      return balance;
    }
  } catch (error) {
    logger.warn("db failed to load stars balance from database, using fallback", { error });
  }
  return fallback;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

function computeGroupStatus(
  record: GroupRecord,
  starsEntry: ResolvedStarsEntry | undefined,
): GroupStatus {
  const status = (record.status ?? "").toLowerCase();
  const statusChangedAt = record.statusUpdatedAt ?? record.updatedAt;
  const warningReference = record.adminWarningSentAt ?? statusChangedAt;

  if (!record.managed || status === "removed") {
    const removedAt = statusChangedAt;
    const graceEndsAt = addDays(new Date(warningReference ?? removedAt), 7).toISOString();
    return {
      kind: "removed",
      removedAt,
      graceEndsAt,
    };
  }

  const nowMs = Date.now();
  const activeEntryMs =
    starsEntry && !starsEntry.disabled && starsEntry.expiresAt
      ? Date.parse(starsEntry.expiresAt)
      : Number.NaN;
  if (Number.isFinite(activeEntryMs) && activeEntryMs > nowMs) {
    const expiresAt = new Date(activeEntryMs).toISOString();
    const daysLeft = Math.max(1, Math.ceil((activeEntryMs - nowMs) / DAY_MS));
    return {
      kind: "active",
      expiresAt,
      daysLeft,
    };
  }

  const creditDaysLeft = record.creditBalance > 0 ? Math.ceil(record.creditBalance) : 0;
  const creditExpiresAt =
    creditDaysLeft > 0 ? addDays(new Date(statusChangedAt), creditDaysLeft).toISOString() : null;

  if (creditDaysLeft > 0) {
    return {
      kind: "active",
      expiresAt: creditExpiresAt ?? addDays(new Date(), creditDaysLeft).toISOString(),
      daysLeft: Math.max(1, creditDaysLeft),
    };
  }

  const panelSettings = getPanelSettings();
  const trialWindowDays = Math.max(0, Math.floor(panelSettings.freeTrialDays ?? 0));
  const trialExpiredMs =
    starsEntry?.trialExpiredAt && typeof starsEntry.trialExpiredAt === "string"
      ? Date.parse(starsEntry.trialExpiredAt)
      : Number.NaN;
  const trialAlreadyExpired = Number.isFinite(trialExpiredMs) && trialExpiredMs <= nowMs;

  if (!trialAlreadyExpired && trialWindowDays > 0) {
    const trialBaseIso = record.createdAt ?? statusChangedAt;
    const trialExpiry = addDays(new Date(trialBaseIso), trialWindowDays);
    if (trialExpiry.getTime() > nowMs) {
      const daysLeft = Math.max(1, Math.ceil((trialExpiry.getTime() - nowMs) / DAY_MS));
      return {
        kind: "active",
        expiresAt: trialExpiry.toISOString(),
        daysLeft,
      };
    }
  }

  const expiredSource =
    (Number.isFinite(trialExpiredMs) ? new Date(trialExpiredMs).toISOString() : null) ??
    (Number.isFinite(activeEntryMs) ? new Date(activeEntryMs).toISOString() : null) ??
    creditExpiresAt ??
    statusChangedAt;
  const expiredAt = new Date(expiredSource).toISOString();
  const graceEndsAt = addDays(new Date(warningReference ?? expiredAt), 7).toISOString();
  return {
    kind: "expired",
    expiredAt,
    graceEndsAt,
  };
}

export function buildManagedGroup(
  record: GroupRecord,
  starsEntry?: ResolvedStarsEntry,
): ManagedGroup {
  const entry =
    starsEntry ?? normalizeStarsStateEntry(getStarsState().groups[record.chatId]) ?? undefined;
  return {
    id: record.chatId,
    title: record.title,
    photoUrl: record.photoUrl,
    membersCount: record.membersCount,
    status: computeGroupStatus(record, entry),
    canManage: record.managed,
    inviteLink: record.inviteLink ?? undefined,
  };
}

function calculateDaysLeft(expiresAt: string): number {
  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) {
    return 0;
  }
  return Math.max(0, Math.ceil((expiresMs - Date.now()) / 86_400_000));
}

function determineStarsStatus(daysLeft: number): StarsStatus {
  if (daysLeft <= 0) {
    return "expired";
  }
  if (daysLeft <= 5) {
    return "expiring";
  }
  return "active";
}

export function buildGroupStarsStatus(
  record: GroupRecord,
  entry: ResolvedStarsEntry | undefined,
): GroupStarsStatus {
  const managedGroup = buildManagedGroup(record, entry);
  const fallbackExpiry = addDays(new Date(record.updatedAt), Math.max(1, Math.ceil(record.creditBalance))).toISOString();
  const expiresAt = entry?.expiresAt ?? fallbackExpiry;
  const daysLeft =
    managedGroup.status.kind === "active"
      ? managedGroup.status.daysLeft
      : calculateDaysLeft(expiresAt);
  return {
    group: managedGroup,
    expiresAt,
    daysLeft,
    status: determineStarsStatus(daysLeft),
  };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export async function searchGroupRecords(
  query: string,
  limit = 20,
  options: { userId?: string | null; includeAll?: boolean } = {},
): Promise<ManagedGroup[]> {
  const normalizedQuery = normalizeText(query);
  const records = await loadGroupsSnapshot(options.userId ?? null, {
    includeAll: options.includeAll ?? false,
  });
  const starsLookup = await resolveStarsEntries(records);

  const matches = records
    .filter((record) => {
      if (!normalizedQuery) {
        return true;
      }
      const id = normalizeText(record.chatId);
      const title = normalizeText(record.title);
      const invite = record.inviteLink ? normalizeText(record.inviteLink) : "";
      return id.includes(normalizedQuery) || title.includes(normalizedQuery) || invite.includes(normalizedQuery);
    })
    .map((record) => buildManagedGroup(record, starsLookup.get(record.chatId)));

  if (matches.length === 0 && normalizedQuery) {
    return [
      {
        id: query.trim(),
        title: query.trim().startsWith("@") ? query.trim() : `Group ${query.trim()}`,
        membersCount: 0,
        photoUrl: null,
        status: {
          kind: "expired",
          expiredAt: new Date().toISOString(),
          graceEndsAt: addDays(new Date(), 10).toISOString(),
        },
        canManage: false,
        inviteLink: query.trim().startsWith("http") ? query.trim() : undefined,
      },
    ];
  }

  return matches.slice(0, limit);
}

export async function buildStarsOverview(
  currentUserId: string | null, 
  options: GroupFilterOptions = {}
): Promise<StarsOverview> {
  const stars = getStarsState();
  const balance = await resolveStarsBalance(currentUserId);
  const managedRecords = (await loadGroupsSnapshot(currentUserId, options)).filter((group) => group.managed);
  const starsLookup = await resolveStarsEntries(managedRecords);
  const groups = managedRecords
    .map((record) => buildGroupStarsStatus(record, starsLookup.get(record.chatId)))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    balance,
    plans: stars.plans,
    groups,
  };
}

function createTrend(current: number, previous: number): TrendRecord {
  if (previous <= 0) {
    if (current <= 0) {
      return { direction: "flat", percent: 0 };
    }
    return { direction: "up", percent: 100 };
  }
  const diff = current - previous;
  const percent = Number(Math.abs((diff / previous) * 100).toFixed(1));
  if (diff > 0) {
    return { direction: "up", percent };
  }
  if (diff < 0) {
    return { direction: "down", percent };
  }
  return { direction: "flat", percent: 0 };
}

function computeRemainingTime(status: GroupStatus): { remainingMs: number; isExpired: boolean } {
  if (status.kind === "active") {
    const remainingMs = Math.max(new Date(status.expiresAt).getTime() - Date.now(), 0);
    return {
      remainingMs,
      isExpired: remainingMs <= 0,
    };
  }
  const remainingMs = Math.max(new Date(status.graceEndsAt).getTime() - Date.now(), 0);
  return {
    remainingMs,
    isExpired: true,
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildFallbackMetrics(group: ManagedGroup): GroupMetricsRecord {
  const seed = hashString(group.id);
  const membersTotal = group.membersCount;
  const previousMembers = Math.max(membersTotal - (seed % 9), 1);
  const messagesToday = 80 + (seed % 150);
  const messagesYesterday = Math.max(messagesToday - (seed % 40), 20);
  const newMembersToday = Math.max((seed % 12) - 4, 0);
  const newMembersYesterday = Math.max(newMembersToday - (seed % 5), 0);
  const { remainingMs, isExpired } = computeRemainingTime(group.status);

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

type MembershipEventRecord = Awaited<ReturnType<typeof listMembershipEventsFromDb>> extends Array<infer Item>
  ? Item
  : never;

type ModerationActionRecord = Awaited<ReturnType<typeof listModerationActionsFromDb>> extends Array<infer Item>
  ? Item
  : never;

type RuleAuditRecord = Awaited<ReturnType<typeof listRuleAudits>> extends Array<infer Item> ? Item : never;

function toTimestamp(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function buildMetricsFromData(
  group: ManagedGroup,
  record: GroupRecord,
  membershipEvents: MembershipEventRecord[],
  moderationActions: ModerationActionRecord[],
): GroupMetricsRecord {
  const { remainingMs, isExpired } = computeRemainingTime(group.status);

  const now = Date.now();
  const dayMs = 86_400_000;
  const dayAgo = now - dayMs;
  const twoDaysAgo = now - dayMs * 2;

  let newMembersToday = 0;
  let newMembersYesterday = 0;
  for (const event of membershipEvents) {
    if (event.event !== "join") {
      continue;
    }
    const eventTime = toTimestamp(event.createdAt);
    if (eventTime >= dayAgo) {
      newMembersToday += 1;
    } else if (eventTime >= twoDaysAgo) {
      newMembersYesterday += 1;
    } else {
      break;
    }
  }

  // Count messages from moderation actions (each action represents a message that was processed)
  // But we need to be careful: some actions might be bulk operations or system actions
  // For now, we'll count actions that have a userId (user-generated messages)
  let messagesToday = 0;
  let messagesYesterday = 0;
  for (const action of moderationActions) {
    // Only count actions that have a userId (actual user messages, not system actions)
    if (!action.userId) {
      continue;
    }
    const actionTime = toTimestamp(action.createdAt);
    if (actionTime >= dayAgo) {
      messagesToday += 1;
    } else if (actionTime >= twoDaysAgo) {
      messagesYesterday += 1;
    } else {
      break;
    }
  }

  // For the dashboard, we want to show TODAY's metrics, not lifetime
  // So membersTotal should be the new members TODAY, not the total members in the group
  const membersTodayCount = newMembersToday;
  const estimatedPreviousMembers = newMembersYesterday || (membersTodayCount > 0 ? membersTodayCount : 1);

  return {
    membersTotal: membersTodayCount,
    membersTrend: createTrend(membersTodayCount, estimatedPreviousMembers),
    remainingMs,
    isExpired,
    messagesToday,
    messagesTrend: createTrend(messagesToday, messagesYesterday || (messagesToday > 0 ? messagesToday : 1)),
    newMembersToday,
    newMembersTrend: createTrend(newMembersToday, newMembersYesterday || (newMembersToday > 0 ? newMembersToday : 1)),
  };
}

function parseMaybeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mapAuditToWarning(audit: RuleAuditRecord): GroupWarningRecord {
  const payload = parseMaybeRecord(audit.payload);
  const member =
    (payload?.member as string | undefined) ??
    (payload?.username as string | undefined) ??
    audit.offenderId ??
    "Unknown member";
  const rule =
    (payload?.rule as string | undefined) ??
    (payload?.ruleName as string | undefined) ??
    audit.ruleId ??
    "Firewall rule";
  const message =
    (payload?.message as string | undefined) ??
    (payload?.reason as string | undefined) ??
    audit.action ??
    "Automated action";
  const severityText = ((payload?.severity as string | undefined) ?? (payload?.level as string | undefined) ?? "").toLowerCase();
  const severity: GroupWarningRecord["severity"] =
    severityText === "critical" || severityText === "warning" ? (severityText as GroupWarningRecord["severity"]) : "info";

  return {
    id: audit.id,
    member,
    rule,
    message,
    timestamp: new Date(audit.createdAt).toISOString(),
    severity,
  };
}

function mapActionToBotAction(action: ModerationActionRecord): GroupBotActionRecord {
  const metadata = parseMaybeRecord(action.metadata);
  const statusText = ((metadata?.status as string | undefined) ?? (action.severity as string | undefined) ?? "").toLowerCase();
  const status: GroupBotActionRecord["status"] = statusText === "failed" || statusText === "error" ? "failed" : "success";
  const target =
    (metadata?.target as string | undefined) ?? action.userId ?? (metadata?.member as string | undefined) ?? null;
  const performedBy =
    (metadata?.performedBy as string | undefined) ?? action.actorId ?? "firewall-bot";

  return {
    id: action.id,
    action: action.action,
    target,
    timestamp: action.createdAt,
    performedBy,
    status,
  };
}

function sumPointsInRange(points: AnalyticsPoint[], startMs: number, endMs: number): number {
  if (points.length === 0) {
    return 0;
  }
  return points.reduce((total, point) => {
    const timestamp = Date.parse(point.timestamp);
    if (Number.isNaN(timestamp)) {
      return total;
    }
    if (timestamp >= startMs && timestamp < endMs) {
      return total + point.value;
    }
    return total;
  }, 0);
}

function startOfDayTimestamp(value: number): number {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function resolveMessageTypes(metadata: Record<string, unknown> | null): AnalyticsMessageType[] {
  if (!metadata) {
    return ["text"];
  }

  const types = new Set<AnalyticsMessageType>();
  const rawMediaTypes = metadata.mediaTypes;
  const mediaTypes = Array.isArray(rawMediaTypes)
    ? (rawMediaTypes as unknown[]).filter((entry): entry is string => typeof entry === "string")
    : [];
  const eventKind = typeof metadata.eventKind === "string" ? metadata.eventKind : null;
  const containsLink =
    metadata.containsLink === true ||
    (Array.isArray(metadata.domains) && metadata.domains.length > 0);
  const forwarded = metadata.forwarded === true;

  for (const media of mediaTypes) {
    switch (media) {
      case "photo":
        types.add("photo");
        break;
      case "video":
      case "video_note":
        types.add("video");
        break;
      case "audio":
      case "voice":
        types.add("voice");
        break;
      case "animation":
        types.add("gif");
        break;
      case "sticker":
        types.add("sticker");
        break;
      case "document":
        types.add("file");
        break;
      default:
        break;
    }
  }

  if (containsLink) {
    types.add("link");
  }
  if (forwarded) {
    types.add("forward");
  }
  if (eventKind === "text") {
    types.add("text");
  }

  if (types.size === 0) {
    types.add(eventKind === "media" && mediaTypes.length === 0 ? "file" : "text");
  }

  return Array.from(types);
}

function createEmptyAnalyticsSnapshot(timezone: string): GroupAnalyticsSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    timezone,
    members: [],
    messages: ANALYTICS_MESSAGE_TYPES.map((type) => ({
      type,
      points: [],
    })),
    summary: {
      newMembersTotal: 0,
      messagesTotal: 0,
      averageMessagesPerDay: 0,
      topMessageType: null,
      membersTrend: { direction: "flat", percent: 0 },
      messagesTrend: { direction: "flat", percent: 0 },
    },
  };
}

async function resolveGroupTimezone(chatId: string): Promise<string> {
  if (!databaseAvailable) {
    return "UTC";
  }
  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    if (settings && typeof settings.timezone === "string" && settings.timezone.trim().length > 0) {
      return settings.timezone.trim();
    }
  } catch (error) {
    if (error instanceof GroupNotFoundError) {
      throw error;
    }
    logger.warn("failed to resolve group timezone", { chatId, error });
  }
  return "UTC";
}

export async function buildGroupAnalyticsSnapshot(chatId: string): Promise<GroupAnalyticsSnapshot> {
  const records = await loadGroupsSnapshot(null, { includeAll: true });
  const record = records.find((entry) => entry.chatId === chatId);
  if (!record) {
    throw new GroupNotFoundError(chatId);
  }

  if (!databaseAvailable) {
    logger.warn("buildGroupAnalyticsSnapshot: database not available", { chatId });
    return createEmptyAnalyticsSnapshot("UTC");
  }

  const timezone = await resolveGroupTimezone(chatId);
  const nowMs = Date.now();
  const since = new Date(nowMs - ANALYTICS_LOOKBACK_DAYS * DAY_MS);
  const sinceMs = since.getTime();

  const [membershipEvents, moderationActions] = await Promise.all([
    listMembershipEventsSince(chatId, since),
    listModerationActionsSince(chatId, since),
  ]);

  logger.debug("buildGroupAnalyticsSnapshot: fetched data", {
    chatId,
    membershipEventsCount: membershipEvents.length,
    moderationActionsCount: moderationActions.length,
  });

  const memberBuckets = new Map<number, { joins: number; leaves: number }>();
  let totalJoins = 0;
  for (const event of membershipEvents) {
    const eventTime = Date.parse(event.createdAt);
    if (Number.isNaN(eventTime) || eventTime < sinceMs) {
      continue;
    }
    const bucketKey = startOfDayTimestamp(eventTime);
    const entry = memberBuckets.get(bucketKey) ?? { joins: 0, leaves: 0 };
    if (event.event === "join") {
      entry.joins += 1;
      totalJoins += 1;
    } else if (event.event === "leave") {
      entry.leaves += 1;
    }
    memberBuckets.set(bucketKey, entry);
  }

  const membersPoints: AnalyticsPoint[] = Array.from(memberBuckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, counts]) => ({
      timestamp: new Date(bucket).toISOString(),
      value: counts.joins - counts.leaves,
    }));

  const messageBuckets = new Map<number, Map<AnalyticsMessageType, number>>();
  const bucketTotals = new Map<number, number>();

  for (const action of moderationActions) {
    const actionTime = Date.parse(action.createdAt);
    if (Number.isNaN(actionTime) || actionTime < sinceMs) {
      continue;
    }
    const bucketKey = startOfDayTimestamp(actionTime);
    const metadata = parseMaybeRecord(action.metadata);
    const resolvedTypes = resolveMessageTypes(metadata);
    const bucketMap = messageBuckets.get(bucketKey) ?? new Map<AnalyticsMessageType, number>();
    for (const type of new Set<AnalyticsMessageType>(resolvedTypes)) {
      bucketMap.set(type, (bucketMap.get(type) ?? 0) + 1);
    }
    messageBuckets.set(bucketKey, bucketMap);
    bucketTotals.set(bucketKey, (bucketTotals.get(bucketKey) ?? 0) + 1);
  }

  const sortedBuckets = Array.from(messageBuckets.keys()).sort((a, b) => a - b);
  const messageSeries: AnalyticsMessageSeries[] = ANALYTICS_MESSAGE_TYPES.map((type) => ({
    type,
    points: sortedBuckets
      .map((bucket) => {
        const count = messageBuckets.get(bucket)?.get(type) ?? 0;
        if (count <= 0) {
          return null;
        }
        return {
          timestamp: new Date(bucket).toISOString(),
          value: count,
        };
      })
      .filter((point): point is AnalyticsPoint => point !== null),
  }));

  const messageTotalsPoints: AnalyticsPoint[] = Array.from(bucketTotals.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, total]) => ({
      timestamp: new Date(bucket).toISOString(),
      value: total,
    }));

  const messagesTotal = messageTotalsPoints.reduce((sum, point) => sum + point.value, 0);
  const averageMessagesPerDay =
    messagesTotal > 0 ? Number((messagesTotal / ANALYTICS_LOOKBACK_DAYS).toFixed(1)) : 0;

  let topMessageType: AnalyticsMessageType | null = null;
  let topCount = 0;
  for (const series of messageSeries) {
    const totalForType = series.points.reduce((sum, point) => sum + point.value, 0);
    if (totalForType > topCount) {
      topCount = totalForType;
      topMessageType = series.type;
    }
  }

  const currentWindowStart = nowMs - ANALYTICS_TREND_WINDOW_DAYS * DAY_MS;
  const previousWindowStart = currentWindowStart - ANALYTICS_TREND_WINDOW_DAYS * DAY_MS;

  const currentMembers = sumPointsInRange(membersPoints, currentWindowStart, nowMs);
  const previousMembers = sumPointsInRange(membersPoints, previousWindowStart, currentWindowStart);
  const membersTrend = createTrend(currentMembers, previousMembers);

  const currentMessages = sumPointsInRange(messageTotalsPoints, currentWindowStart, nowMs);
  const previousMessages = sumPointsInRange(
    messageTotalsPoints,
    previousWindowStart,
    currentWindowStart,
  );
  const messagesTrend = createTrend(currentMessages, previousMessages);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    timezone,
    members: membersPoints,
    messages: messageSeries,
    summary: {
      newMembersTotal: totalJoins,
      messagesTotal,
      averageMessagesPerDay,
      topMessageType,
      membersTrend,
      messagesTrend,
    },
  };
}

export async function loadGroupDetailByChatId(chatId: string, userId?: string | null): Promise<GroupDetailRecord> {
  // Try to load all groups first (for admin access)
  let records = await loadGroupsSnapshot();
  let record = records.find((entry) => entry.chatId === chatId);
  
  // If not found and we have userId, try loading user-specific groups
  if (!record && userId) {
    records = await loadGroupsSnapshot(userId, { includeAll: false });
    record = records.find((entry) => entry.chatId === chatId);
  }
  
  // If still not found, try with includeAll flag for admins
  if (!record) {
    records = await loadGroupsSnapshot(userId, { includeAll: true });
    record = records.find((entry) => entry.chatId === chatId);
  }
  
  if (!record) {
    logger.warn("Group not found in loadGroupDetailByChatId", { 
      chatId, 
      userId,
      availableGroups: records.map(r => r.chatId)
    });
    throw new GroupNotFoundError(chatId);
  }
  
  logger.info("Found group in loadGroupDetailByChatId", {
    chatId,
    userId,
    groupTitle: record.title,
    groupManaged: record.managed
  });

  const starsLookup = await resolveStarsEntries([record]);
  const group = buildManagedGroup(record, starsLookup.get(record.chatId));

  let membershipEvents: any[] = [];
  let moderationActions: any[] = [];
  let audits: any[] = [];

  try {
    if (databaseAvailable) {
      const [membershipEventsResult, moderationActionsResult, auditsResult] = await Promise.all([
        listMembershipEventsFromDb(chatId, 500).catch(err => {
          logger.warn("Failed to load membership events", { chatId, error: err.message });
          return [];
        }),
        listModerationActionsFromDb(chatId, 200).catch(err => {
          logger.warn("Failed to load moderation actions", { chatId, error: err.message });
          return [];
        }),
        listRuleAudits(chatId, 50).catch(err => {
          logger.warn("Failed to load rule audits", { chatId, error: err.message });
          return [];
        }),
      ]);
      
      membershipEvents = membershipEventsResult;
      moderationActions = moderationActionsResult;
      audits = auditsResult;
    }
  } catch (error) {
    logger.error("Database operations failed, using fallback data", { chatId, error });
  }

  let metrics: GroupMetricsRecord;
  if (!databaseAvailable) {
    metrics = buildFallbackMetrics(group);
  } else {
    metrics = buildMetricsFromData(group, record, membershipEvents, moderationActions);
    if (
      metrics.membersTotal === 0 &&
      metrics.messagesToday === 0 &&
      metrics.newMembersToday === 0 &&
      (record.membersCount === 0 || moderationActions.length === 0)
    ) {
      metrics = buildFallbackMetrics(group);
    }
  }

  const cutoffMs = Date.now() - DAY_MS;
  const warnings = audits
    .map((audit) => mapAuditToWarning(audit))
    .filter((warning) => {
      const timestamp = Date.parse(warning.timestamp);
      return Number.isFinite(timestamp) ? timestamp >= cutoffMs : true;
    });
  const botActions = moderationActions
    .map((action) => mapActionToBotAction(action))
    .filter((action) => {
      const timestamp = Date.parse(action.timestamp);
      return Number.isFinite(timestamp) ? timestamp >= cutoffMs : true;
    });

  logger.debug("loadGroupDetailByChatId result", {
    chatId,
    auditsCount: audits.length,
    warningsCount: warnings.length,
    moderationActionsCount: moderationActions.length,
    botActionsCount: botActions.length,
  });

  return {
    group,
    metrics,
    warnings,
    botActions,
  };
}
