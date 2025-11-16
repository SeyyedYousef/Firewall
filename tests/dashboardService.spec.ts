import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgres://test-db";

const mockGetStarsState = vi.fn(() => ({
  balance: 0,
  groups: {},
}));
const mockListGroups = vi.fn(() => []);
const mockGetPanelSettings = vi.fn(() => ({
  freeTrialDays: 15,
}));
const mockFetchGroupsFromDb = vi.fn();
const mockFetchOwnerWalletBalance = vi.fn();
const mockFetchLatestStarsStatusForGroups = vi.fn();
const mockListModerationActionsFromDb = vi.fn();
const mockListMembershipEventsFromDb = vi.fn();
const mockListModerationActionsSince = vi.fn();
const mockListMembershipEventsSince = vi.fn();
const mockCountModerationActionsSince = vi.fn();
const mockCountMembershipJoinsSince = vi.fn();
const mockListRuleAudits = vi.fn();
const mockLoadGeneralSettingsByChatId = vi.fn();

vi.mock("../bot/state.js", () => ({
  getStarsState: mockGetStarsState,
  listGroups: mockListGroups,
  getPanelSettings: mockGetPanelSettings,
}));

vi.mock("../server/db/stateRepository.js", () => ({
  fetchGroupsFromDb: mockFetchGroupsFromDb,
  fetchOwnerWalletBalance: mockFetchOwnerWalletBalance,
  fetchLatestStarsStatusForGroups: mockFetchLatestStarsStatusForGroups,
  listModerationActionsFromDb: mockListModerationActionsFromDb,
  listMembershipEventsFromDb: mockListMembershipEventsFromDb,
  listModerationActionsSince: mockListModerationActionsSince,
  listMembershipEventsSince: mockListMembershipEventsSince,
  countModerationActionsSince: mockCountModerationActionsSince,
  countMembershipJoinsSince: mockCountMembershipJoinsSince,
}));

vi.mock("../server/db/firewallRepository.js", () => ({
  listRuleAudits: mockListRuleAudits,
}));

class MockGroupNotFoundError extends Error {
  constructor(groupId: string) {
    super(`Group (${groupId}) was not found`);
    this.name = "GroupNotFoundError";
  }
}

vi.mock("../server/db/groupSettingsRepository.js", () => ({
  GroupNotFoundError: MockGroupNotFoundError,
  loadGeneralSettingsByChatId: mockLoadGeneralSettingsByChatId,
}));

const DAY_MS = 86_400_000;

const dashboardService = await import("../server/services/dashboardService.ts");
const {
  buildManagedGroup,
  buildManagedGroups,
  computeDashboardInsights,
  buildGroupAnalyticsSnapshot,
} = dashboardService;

describe("dashboardService", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockGetStarsState.mockReturnValue({
      balance: 0,
      groups: {},
    });
    mockGetPanelSettings.mockReturnValue({ freeTrialDays: 15 });
    mockFetchLatestStarsStatusForGroups.mockResolvedValue(new Map());
    mockCountModerationActionsSince.mockResolvedValue(0);
    mockCountMembershipJoinsSince.mockResolvedValue(0);
    mockListModerationActionsSince.mockResolvedValue([]);
    mockListMembershipEventsSince.mockResolvedValue([]);
    mockLoadGeneralSettingsByChatId.mockResolvedValue({ timezone: "UTC" });
    mockListRuleAudits.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const baseRecord = {
    chatId: "-100123456",
    title: "Example Group",
    creditBalance: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAdjustmentNote: null,
    membersCount: 150,
    inviteLink: null,
    photoUrl: null,
    managed: true,
    adminRestricted: false,
    adminWarningSentAt: null,
    ownerId: null,
    adminIds: [],
    status: null,
    statusUpdatedAt: new Date().toISOString(),
    dbId: "uuid-group-1",
  } as const;

  describe("buildManagedGroup", () => {
    it("marks groups with an active trial as active", () => {
      const chatId = baseRecord.chatId;
      const trialExpiry = new Date(Date.now() + 3 * DAY_MS).toISOString();
      mockGetStarsState.mockReturnValue({
        balance: 0,
        groups: {
          [chatId]: {
            groupId: chatId,
            expiresAt: trialExpiry,
            gifted: true,
            trialReminderSentAt: null,
            trialExpiredAt: null,
            disabled: false,
          },
        },
      });

      const group = buildManagedGroup({ ...baseRecord });
      expect(group.status.kind).toBe("active");
      expect(group.status.daysLeft).toBeGreaterThanOrEqual(3);
      expect(group.status.expiresAt).toBe(trialExpiry);
    });

    it("falls back to expired status when trial is disabled", () => {
      const chatId = baseRecord.chatId;
      const expiredAt = new Date(Date.now() - DAY_MS).toISOString();
      mockGetStarsState.mockReturnValue({
        balance: 0,
        groups: {
          [chatId]: {
            groupId: chatId,
            expiresAt: expiredAt,
            gifted: true,
            trialReminderSentAt: null,
            trialExpiredAt: expiredAt,
            disabled: true,
          },
        },
      });

      const group = buildManagedGroup({ ...baseRecord });
      expect(group.status.kind).toBe("expired");
      expect(group.status.expiredAt).toBeDefined();
    });

    it("uses database stars status when state is missing", async () => {
      const chatId = baseRecord.chatId;
      const expiresAt = new Date(Date.now() + 5 * DAY_MS).toISOString();
      mockGetStarsState.mockReturnValue({
        balance: 0,
        groups: {},
      });
      mockFetchLatestStarsStatusForGroups.mockResolvedValue(
        new Map([[baseRecord.dbId, { expiresAt, gifted: false }]]),
      );

      const [group] = await buildManagedGroups([{ ...baseRecord }]);
      expect(group.status.kind).toBe("active");
      expect(group.status.expiresAt).toBe(expiresAt);
      expect(group.status.daysLeft).toBeGreaterThanOrEqual(5);
    });
  });

  describe("computeDashboardInsights", () => {
    it("uses a rolling 24-hour window for metrics", async () => {
      vi.useFakeTimers();
      const now = new Date("2025-02-01T12:00:00.000Z");
      vi.setSystemTime(now);

      mockCountModerationActionsSince.mockResolvedValue(12);
      mockCountMembershipJoinsSince.mockResolvedValue(7);

      const chatId = baseRecord.chatId;
      const expiresAt = new Date(now.getTime() + 2 * DAY_MS).toISOString();
      mockGetStarsState.mockReturnValue({
        balance: 0,
        groups: {
          [chatId]: {
            groupId: chatId,
            expiresAt,
            gifted: false,
            trialReminderSentAt: null,
            trialExpiredAt: null,
            disabled: false,
          },
        },
      });

      const insights = await computeDashboardInsights([{ ...baseRecord }]);
      expect(insights.messagesToday).toBe(12);
      expect(insights.newMembersToday).toBe(7);
      expect(insights.expiringSoon).toBe(1);

      expect(mockCountModerationActionsSince).toHaveBeenCalledTimes(1);
      expect(mockCountMembershipJoinsSince).toHaveBeenCalledTimes(1);
      const sinceArg = mockCountModerationActionsSince.mock.calls[0][1] as Date;
      expect(Math.abs(now.getTime() - sinceArg.getTime() - DAY_MS)).toBeLessThan(5);
    });
  });

  describe("buildGroupAnalyticsSnapshot", () => {
    it("aggregates membership deltas and moderation actions", async () => {
      vi.useFakeTimers();
      const now = new Date("2025-03-15T10:00:00.000Z");
      vi.setSystemTime(now);

      const chatId = baseRecord.chatId;
      const record = { ...baseRecord };
      const loadGroupsSnapshotSpy = vi
        .spyOn(dashboardService, "loadGroupsSnapshot")
        .mockResolvedValue([record]);

      mockLoadGeneralSettingsByChatId.mockResolvedValue({ timezone: "Asia/Tehran" });

      mockListMembershipEventsSince.mockResolvedValue([
        {
          id: "join-1",
          userId: "1001",
          event: "join",
          payload: null,
          createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: "join-2",
          userId: "1002",
          event: "join",
          payload: null,
          createdAt: new Date(now.getTime() - 3 * DAY_MS).toISOString(),
        },
      ]);

      mockListModerationActionsSince.mockResolvedValue([
        {
          id: "act-1",
          userId: "2001",
          actorId: "bot",
          action: "delete",
          severity: null,
          reason: null,
          metadata: {
            eventKind: "text",
            messageLength: 24,
            containsLink: false,
          },
          createdAt: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: "act-2",
          userId: "2002",
          actorId: "bot",
          action: "warn",
          severity: null,
          reason: null,
          metadata: {
            eventKind: "media",
            mediaTypes: ["photo"],
          },
          createdAt: new Date(now.getTime() - 5 * DAY_MS).toISOString(),
        },
      ]);

      const snapshot = await buildGroupAnalyticsSnapshot(chatId);

      expect(snapshot.timezone).toBe("Asia/Tehran");
      expect(snapshot.summary.newMembersTotal).toBe(2);
      expect(snapshot.summary.messagesTotal).toBe(2);
      expect(snapshot.summary.topMessageType).toBe("text");
      expect(snapshot.summary.averageMessagesPerDay).toBeCloseTo(0.1, 1);

      const textSeries = snapshot.messages.find((series) => series.type === "text");
      expect(textSeries?.points.length).toBeGreaterThan(0);
      const photoSeries = snapshot.messages.find((series) => series.type === "photo");
      expect(photoSeries?.points.length).toBeGreaterThan(0);

      expect(snapshot.members.length).toBeGreaterThan(0);
      expect(loadGroupsSnapshotSpy).toHaveBeenCalled();
    });
  });
});
