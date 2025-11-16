import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock the dependencies
const mockListGroups = vi.fn();
const mockGetPanelSettings = vi.fn(() => ({ freeTrialDays: 15 }));

vi.mock("../bot/state.js", () => ({
  listGroups: mockListGroups,
  getPanelSettings: mockGetPanelSettings,
}));

vi.mock("../server/db/stateRepository.js", () => ({
  fetchGroupsFromDb: vi.fn().mockResolvedValue([]),
}));

// Import after mocking
import { loadGroupsSnapshot } from "../server/services/dashboardService.js";

describe("Owner-only groups filtering", () => {
  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Disable database for these tests
    delete process.env.DATABASE_URL;
  });

  it("should only show groups where user is owner", async () => {
    const userId = "123456789";
    const mockGroups = [
      {
        chatId: "-1001111111111",
        title: "Group 1 - Owner",
        ownerId: userId, // User is owner
        adminIds: [],
        managed: true,
        creditBalance: 10,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        lastAdjustmentNote: null,
        membersCount: 100,
        inviteLink: null,
        photoUrl: null,
        adminRestricted: false,
        adminWarningSentAt: null,
        status: null,
        statusUpdatedAt: null,
        dbId: null,
      },
      {
        chatId: "-1002222222222",
        title: "Group 2 - Admin Only",
        ownerId: "987654321", // Different owner
        adminIds: [userId], // User is admin but not owner
        managed: true,
        creditBalance: 5,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        lastAdjustmentNote: null,
        membersCount: 50,
        inviteLink: null,
        photoUrl: null,
        adminRestricted: false,
        adminWarningSentAt: null,
        status: null,
        statusUpdatedAt: null,
        dbId: null,
      },
      {
        chatId: "-1003333333333",
        title: "Group 3 - Another Owner",
        ownerId: "555666777", // Different owner
        adminIds: [],
        managed: true,
        creditBalance: 15,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        lastAdjustmentNote: null,
        membersCount: 200,
        inviteLink: null,
        photoUrl: null,
        adminRestricted: false,
        adminWarningSentAt: null,
        status: null,
        statusUpdatedAt: null,
        dbId: null,
      },
    ];

    mockListGroups.mockReturnValue(mockGroups);

    const result = await loadGroupsSnapshot(userId, { includeAll: false });

    // Should only return the group where user is owner
    expect(result).toHaveLength(1);
    expect(result[0].chatId).toBe("-1001111111111");
    expect(result[0].title).toBe("Group 1 - Owner");
    expect(result[0].ownerId).toBe(userId);
  });

  it("should return empty array when user is not owner of any groups", async () => {
    const userId = "123456789";
    const mockGroups = [
      {
        chatId: "-1001111111111",
        title: "Group 1",
        ownerId: "987654321", // Different owner
        adminIds: [userId], // User is admin but not owner
        managed: true,
        creditBalance: 10,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        lastAdjustmentNote: null,
        membersCount: 100,
        inviteLink: null,
        photoUrl: null,
        adminRestricted: false,
        adminWarningSentAt: null,
        status: null,
        statusUpdatedAt: null,
        dbId: null,
      },
    ];

    mockListGroups.mockReturnValue(mockGroups);

    const result = await loadGroupsSnapshot(userId, { includeAll: false });

    // Should return empty array since user is not owner of any groups
    expect(result).toHaveLength(0);
  });

  it("should show all groups when includeAll is true (panel admin)", async () => {
    const userId = "123456789";
    const mockGroups = [
      {
        chatId: "-1001111111111",
        title: "Group 1 - Owner",
        ownerId: userId,
        adminIds: [],
        managed: true,
        creditBalance: 10,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        lastAdjustmentNote: null,
        membersCount: 100,
        inviteLink: null,
        photoUrl: null,
        adminRestricted: false,
        adminWarningSentAt: null,
        status: null,
        statusUpdatedAt: null,
        dbId: null,
      },
      {
        chatId: "-1002222222222",
        title: "Group 2 - Admin Only",
        ownerId: "987654321",
        adminIds: [userId],
        managed: true,
        creditBalance: 5,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        lastAdjustmentNote: null,
        membersCount: 50,
        inviteLink: null,
        photoUrl: null,
        adminRestricted: false,
        adminWarningSentAt: null,
        status: null,
        statusUpdatedAt: null,
        dbId: null,
      },
    ];

    mockListGroups.mockReturnValue(mockGroups);

    const result = await loadGroupsSnapshot(userId, { includeAll: true });

    // Should return all groups when includeAll is true
    expect(result).toHaveLength(2);
  });
});
