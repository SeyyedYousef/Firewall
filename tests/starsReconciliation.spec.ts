import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db/client.js", () => {
  return {
    prisma: {
      starTransaction: {
        findMany: vi.fn(),
      },
    },
  };
});

const { prisma } = await import("../server/db/client.js");
const { findStarsReconciliationIssues } = await import("../server/services/starsReconciliation.js");

describe("stars reconciliation", () => {
  beforeEach(() => {
    (prisma.starTransaction.findMany as unknown as vi.Mock).mockResolvedValue([
      {
        id: "tx-completed",
        status: "completed",
        amount: -500,
        metadata: {
          groupChatId: "-1001",
          planId: "stars-30",
          planDays: 30,
          expiresAt: "2025-02-01T00:00:00.000Z",
          telemetry: [],
        },
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        completedAt: new Date("2025-01-01T00:10:00.000Z"),
      },
      {
        id: "tx-pending",
        status: "pending",
        amount: -500,
        metadata: {
          groupChatId: "-1001",
          telemetry: [],
        },
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        completedAt: null,
      },
    ]);
  });

  it("reports mismatches between state and transaction history", async () => {
    const fakeState = {
      stars: {
        groups: {
          "-1001": {
            groupId: "-1001",
            expiresAt: "2025-01-10T00:00:00.000Z",
            gifted: false,
          },
        },
      },
    } as unknown;

    const issues = await findStarsReconciliationIssues({
      state: fakeState,
      toleranceSeconds: 0,
      pendingThresholdMinutes: 0,
    });

    expect(issues.length).toBeGreaterThanOrEqual(1);
    const groupIssue = issues.find((issue) => issue.groupId === "-1001");
    expect(groupIssue).toBeDefined();
    expect(groupIssue?.issues.join(" ")).toContain("expiry mismatch");

    const pendingIssue = issues.find((issue) => issue.issues.some((msg) => msg.includes("pending transactions")));
    expect(pendingIssue).toBeDefined();
  });
});
