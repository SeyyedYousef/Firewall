import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db/client.js", () => ({
  prisma: {
    rewardRedemption: {
      findMany: vi.fn(),
    },
  },
}));

const { prisma } = await import("../server/db/client.js");
const { listRecentBadgeRedemptions } = await import("../server/services/userProfileService.js");

describe("badge fulfillment reporting", () => {
  beforeEach(() => {
    (prisma.rewardRedemption.findMany as unknown as vi.Mock).mockResolvedValue([
      {
        id: "redemption-1",
        userProfileId: "profile-1",
        rewardId: "badge-master",
        cost: 1000,
        redeemedAt: new Date("2025-02-05T00:00:00.000Z"),
        metadata: {
          badgeId: "master",
        },
        profile: {
          id: "profile-1",
          telegramUserId: "10001",
          displayName: "Alpha",
          username: "alpha",
        },
      },
      {
        id: "redemption-2",
        userProfileId: "profile-2",
        rewardId: "badge-legend",
        cost: 5000,
        redeemedAt: new Date("2025-02-06T00:00:00.000Z"),
        metadata: null,
        profile: {
          id: "profile-2",
          telegramUserId: "10002",
          displayName: null,
          username: "beta",
        },
      },
    ]);
  });

  it("normalizes badge metadata for staff dashboards", async () => {
    const rows = await listRecentBadgeRedemptions();
    expect(rows).toHaveLength(2);

    const master = rows[0]!;
    expect(master.badgeId).toBe("master");
    expect(master.displayName).toBe("Alpha");
    expect(master.username).toBe("alpha");

    const legend = rows[1]!;
    expect(legend.badgeId).toBe("legend");
    expect(legend.username).toBe("beta");
  });
});
