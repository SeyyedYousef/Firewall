import { afterEach, describe, expect, it, vi } from "vitest";

import * as missionVerificationService from "../server/services/missionVerificationService.js";
import { getMissionDefinition } from "../server/services/missionRegistry.js";

const { MissionVerificationError, resolveReward } = missionVerificationService;

describe("missionVerificationService.resolveReward", () => {
  it("enforces daily spin rewards within range", () => {
    const definition = getMissionDefinition("daily-wheel");
    expect(() => resolveReward(definition, definition.verification.kind === "daily-spin" ? definition.verification.minXp : 0)).not.toThrow();
    expect(() => resolveReward(definition, 999)).toThrow(MissionVerificationError);
  });

  it("returns static XP for backend events", () => {
    const definition = getMissionDefinition("renew-weekly");
    const reward = resolveReward(definition);
    expect(reward).toBeGreaterThan(0);
  });
});

describe("missionVerificationService flows", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("awards daily spin rewards via backend verification", async () => {
    const fakeCompletion = {
      missionId: "daily-wheel",
      category: "daily",
      cycleKey: "cycle-1",
      xpEarned: 0,
      completedAt: new Date().toISOString(),
      verificationState: "verified" as const,
      verificationReason: null,
    };
    const fakeProfile = {
      id: "profile-1",
      telegramUserId: "123",
      username: "firewall",
      displayName: "Firewall",
      avatarUrl: null,
      totalXp: 100,
      level: 1,
      nextLevelXp: null,
      previousLevelXp: 0,
      progressToNext: 0,
      streak: 0,
      lastCheckIn: null,
      uptimeScore: 0,
      missionsCleared: 0,
      globalRank: null,
      seasonMultiplier: 1,
      badges: [],
    };

    const grantMissionCompletionSpy = vi
      .spyOn(missionVerificationService, "grantMissionCompletion")
      .mockImplementation(async (options) => ({
        rewardXp: options.rewardXpOverride ?? 0,
        completion: fakeCompletion,
        profile: fakeProfile,
      }));

    const result = await missionVerificationService.spinDailyWheel("profile-1");

    expect(grantMissionCompletionSpy).toHaveBeenCalledTimes(1);
    const args = grantMissionCompletionSpy.mock.calls[0]![0];
    expect(args).toMatchObject({
      profileId: "profile-1",
      missionId: "daily-wheel",
      context: {
        source: "daily-spin",
      },
    });
    expect(args.rewardXpOverride).toBeGreaterThanOrEqual(1);
    expect(args.rewardXpOverride).toBeLessThanOrEqual(20);
    expect(result.rewardXp).toBe(args.rewardXpOverride);
    expect(result.completion).toBe(fakeCompletion);
    expect(result.profile).toBe(fakeProfile);
  });

  it("verifies channel membership missions before granting XP", async () => {
    const grantMissionCompletionSpy = vi
      .spyOn(missionVerificationService, "grantMissionCompletion")
      .mockResolvedValue({
        rewardXp: 80,
        completion: {
          missionId: "join-channel",
          category: "general",
          cycleKey: "general",
          xpEarned: 80,
          completedAt: new Date().toISOString(),
          verificationState: "verified",
          verificationReason: null,
        },
        profile: {
          id: "profile-2",
          telegramUserId: "999",
          username: "member",
          displayName: "Member",
          avatarUrl: null,
          totalXp: 200,
          level: 2,
          nextLevelXp: 600,
          previousLevelXp: 250,
          progressToNext: 0.5,
          streak: 2,
          lastCheckIn: null,
          uptimeScore: 0,
          missionsCleared: 5,
          globalRank: null,
          seasonMultiplier: 1,
          badges: [],
        },
      });

    await missionVerificationService.grantChannelMembershipMission({
      profileId: "profile-2",
      channelUsername: "Firewall",
    });

    expect(grantMissionCompletionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "profile-2",
        missionId: "join-channel",
        context: expect.objectContaining({
          source: "channel-membership",
          channelUsername: "firewall",
        }),
      }),
    );
  });

  it("rejects channel missions that target the wrong community", async () => {
    await expect(
      missionVerificationService.grantChannelMembershipMission({
        profileId: "profile-3",
        channelUsername: "not-firewall",
      }),
    ).rejects.toThrow(MissionVerificationError);
  });
});
