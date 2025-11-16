import { Prisma } from "@prisma/client";

import { prisma } from "../db/client.js";
import { logger } from "../utils/logger.js";
import type { MissionCategory } from "./missionTypes.js";
import { ALL_MISSION_CATEGORIES } from "./missionTypes.js";
import { resolveActiveMissionCycle } from "./missionCycleService.js";
import { issueCreditCode, maskCreditCode, notifyUserOfCreditCode } from "./creditCodeService.js";

const LEVEL_THRESHOLDS = [0, 250, 600, 1050, 1600, 2200, 2850, 3550, 4300, 5100, 5950, 6850];

const MAX_MISSION_REWARD = Number(process.env.MISSION_MAX_XP ?? 500);

const DEFAULT_SEASON_MULTIPLIER = 1;
const configuredSeasonMultiplier = Number.parseFloat(process.env.SEASON_MULTIPLIER ?? "");
const SEASON_MULTIPLIER =
  Number.isFinite(configuredSeasonMultiplier) && configuredSeasonMultiplier > 0
    ? configuredSeasonMultiplier
    : DEFAULT_SEASON_MULTIPLIER;

export type { MissionCategory } from "./missionTypes.js";

export type UserProfileSummary = {
  id: string;
  telegramUserId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  totalXp: number;
  level: number;
  nextLevelXp: number | null;
  previousLevelXp: number;
  progressToNext: number;
  streak: number;
  lastCheckIn: string | null;
  uptimeScore: number;
  missionsCleared: number;
  globalRank: number | null;
  seasonMultiplier: number;
  badges: string[];
};

export type MissionCompletionRecord = {
  missionId: string;
  category: MissionCategory;
  cycleKey: string;
  xpEarned: number;
  completedAt: string;
  verificationState: "pending" | "verified" | "rejected";
  verificationReason: string | null;
};

export type AchievementRecord = {
  achievementId: string;
  unlockedAt: string;
  metadata: Record<string, unknown> | null;
};

export type RewardRedemptionRecord = {
  id: string;
  rewardId: string;
  cost: number;
  redeemedAt: string;
  metadata: Record<string, unknown> | null;
};

export type RewardDefinition = {
  id: string;
  title: string;
  cost: number;
  creditDays?: number;
  badgeId?: string;
};

export class MissionAlreadyCompletedError extends Error {
  public statusCode = 409;
  constructor(message = "Mission already completed") {
    super(message);
    this.name = "MissionAlreadyCompletedError";
  }
}

export class InsufficientXpError extends Error {
  public statusCode = 400;
  constructor(message = "Not enough XP to redeem this reward") {
    super(message);
    this.name = "InsufficientXpError";
  }
}

export class DailyCheckInAlreadyRecordedError extends Error {
  public statusCode = 409;
  constructor(message = "Daily check-in already recorded for today") {
    super(message);
    this.name = "DailyCheckInAlreadyRecordedError";
  }
}

const REWARD_CATALOG: RewardDefinition[] = [
  { id: "reward-uptime-7", title: "7-day uptime credit", cost: 800, creditDays: 7 },
  { id: "reward-uptime-14", title: "14-day uptime bundle", cost: 1400, creditDays: 14 },
  { id: "reward-uptime-30", title: "30-day uptime bundle", cost: 2500, creditDays: 30 },
  { id: "badge-rookie", title: "Rookie badge", cost: 200, badgeId: "rookie" },
  { id: "badge-active", title: "Active badge", cost: 500, badgeId: "active" },
  { id: "badge-master", title: "Master badge", cost: 1000, badgeId: "master" },
  { id: "badge-elite", title: "Elite badge", cost: 2000, badgeId: "elite" },
  { id: "badge-legend", title: "Legend badge", cost: 5000, badgeId: "legend" },
];

const REWARD_INDEX = new Map(REWARD_CATALOG.map((reward) => [reward.id, reward]));

function normalizeDisplayName(options: {
  firstName?: string;
  lastName?: string;
  username?: string;
}): string | null {
  const parts = [options.firstName, options.lastName].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (parts.length > 0) {
    return parts.join(" ");
  }
  if (options.username && options.username.trim().length > 0) {
    return options.username;
  }
  return null;
}

function clampMissionReward(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) {
    return 0;
  }
  return Math.min(Math.floor(xp), MAX_MISSION_REWARD);
}

function computeLevel(totalXp: number): {
  level: number;
  previousThreshold: number;
  nextThreshold: number | null;
  progress: number;
} {
  let level = 1;
  let previousThreshold = 0;
  let nextThreshold: number | null = null;

  for (let index = 0; index < LEVEL_THRESHOLDS.length; index += 1) {
    const threshold = LEVEL_THRESHOLDS[index] ?? 0;
    const following = LEVEL_THRESHOLDS[index + 1] ?? null;
    if (totalXp >= threshold) {
      level = index + 1;
      previousThreshold = threshold;
      nextThreshold = following;
    } else {
      nextThreshold = threshold;
      break;
    }
  }

  const denominator = nextThreshold ? nextThreshold - previousThreshold : 1;
  const progress =
    nextThreshold === null
      ? 1
      : Math.min(1, Math.max(0, (totalXp - previousThreshold) / Math.max(1, denominator)));

  return { level, previousThreshold, nextThreshold, progress };
}

function toSummary(
  profile: {
    id: string;
    telegramUserId: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    totalXp: number;
    level: number;
    streak: number;
    lastCheckIn: Date | null;
  },
  badges: readonly string[] = [],
): UserProfileSummary {
  const { previousThreshold, nextThreshold, progress } = computeLevel(profile.totalXp);

  return {
    id: profile.id,
    telegramUserId: profile.telegramUserId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    totalXp: profile.totalXp,
    level: profile.level,
    previousLevelXp: previousThreshold,
    nextLevelXp: nextThreshold,
    progressToNext: progress,
    streak: profile.streak,
    lastCheckIn: profile.lastCheckIn ? profile.lastCheckIn.toISOString() : null,
    uptimeScore: 0,
    missionsCleared: 0,
    globalRank: null,
    seasonMultiplier: SEASON_MULTIPLIER,
    badges: [...badges],
  };
}

function resolveRewardDefinition(rewardId: string): RewardDefinition | null {
  const normalized = typeof rewardId === "string" ? rewardId.trim() : "";
  if (!normalized) {
    return null;
  }
  return REWARD_INDEX.get(normalized) ?? null;
}

async function loadBadgeIds(profileId: string): Promise<string[]> {
  const rows = await prisma.userBadge.findMany({
    where: { userProfileId: profileId },
    orderBy: { awardedAt: "asc" },
    select: { badgeId: true },
  });
  return rows.map((row) => row.badgeId);
}

async function awardBadge(profileId: string, badgeId: string): Promise<void> {
  const normalized = badgeId.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Badge identifier is required");
  }
  await prisma.userBadge.upsert({
    where: {
      userProfileId_badgeId: {
        userProfileId: profileId,
        badgeId: normalized,
      },
    },
    update: {
      awardedAt: new Date(),
    },
    create: {
      userProfileId: profileId,
      badgeId: normalized,
    },
  });
}

export async function getOrCreateUserProfile(
  telegramUserId: string,
  meta: {
    username?: string;
    firstName?: string;
    lastName?: string;
    photoUrl?: string;
  } = {},
): Promise<UserProfileSummary> {
  const normalizedDisplayName = normalizeDisplayName(meta);
  const updates: Prisma.UserProfileUpdateInput = {};
  if (meta.username) {
    updates.username = meta.username;
  }
  if (normalizedDisplayName) {
    updates.displayName = normalizedDisplayName;
  }
  if (meta.photoUrl) {
    updates.avatarUrl = meta.photoUrl;
  }

  const record = await prisma.userProfile.upsert({
    where: { telegramUserId },
    create: {
      telegramUserId,
      username: meta.username ?? null,
      displayName: normalizedDisplayName,
      avatarUrl: meta.photoUrl ?? null,
      totalXp: 0,
      level: 1,
      streak: 0,
    },
    update: updates,
  });

  if (record.level <= 0) {
    const { level } = computeLevel(record.totalXp);
    if (record.level !== level) {
      await prisma.userProfile.update({
        where: { id: record.id },
        data: { level },
      });
      record.level = level;
    }
  }

  const badges = await loadBadgeIds(record.id);
  return toSummary(record, badges);
}

export async function listMissionCompletions(profileId: string): Promise<MissionCompletionRecord[]> {
  const now = new Date();
  const activeCycles = await loadActiveCycles(now);

  const rows = await prisma.userMission.findMany({
    where: { userProfileId: profileId },
    orderBy: { completedAt: "desc" },
  });

  return rows
    .filter((row) => {
      const category = row.category as MissionCategory;
      if (category === "general") {
        return true;
      }
      const cycle = activeCycles.get(category);
      if (!cycle) {
        return true;
      }
      return row.cycleKey === cycle.cycleKey;
    })
    .map((row) => ({
      missionId: row.missionId,
      category: row.category as MissionCategory,
      cycleKey: row.cycleKey,
      xpEarned: row.xpEarned,
      completedAt: row.completedAt.toISOString(),
      verificationState: (row.verificationState as MissionCompletionRecord["verificationState"]) ?? "pending",
      verificationReason: row.verificationReason ?? null,
    }));
}

async function loadActiveCycles(reference: Date): Promise<Map<MissionCategory, { cycleKey: string }>> {
  const relevant: MissionCategory[] = ["daily", "weekly", "monthly"];
  const results = await Promise.all(
    relevant.map(async (category) => {
      const cycle = await resolveActiveMissionCycle(category, { referenceDate: reference });
      return [category, { cycleKey: cycle.cycleKey }] as const;
    }),
  );
  return new Map(results);
}

export async function listAchievements(profileId: string): Promise<AchievementRecord[]> {
  const rows = await prisma.userAchievement.findMany({
    where: { userProfileId: profileId },
    orderBy: { unlockedAt: "desc" },
  });

  return rows.map((row) => ({
    achievementId: row.achievementId,
    unlockedAt: row.unlockedAt.toISOString(),
    metadata: row.metadata as Record<string, unknown> | null,
  }));
}

export async function recordDailyCheckIn(profileId: string): Promise<UserProfileSummary> {
  const existing = await prisma.userProfile.findUnique({
    where: { id: profileId },
  });
  if (!existing) {
    throw new Error("Profile not found");
  }

  const now = new Date();
  let nextStreak = 1;

  if (existing.lastCheckIn) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const lastCheck = new Date(existing.lastCheckIn);
    lastCheck.setHours(0, 0, 0, 0);
    const daysDelta = Math.floor((startOfToday.getTime() - lastCheck.getTime()) / msPerDay);
    if (daysDelta === 0) {
      throw new DailyCheckInAlreadyRecordedError();
    }
    if (daysDelta === 1) {
      nextStreak = existing.streak + 1;
    } else if (daysDelta < 0) {
      nextStreak = existing.streak;
    }
  }

  const updated = await prisma.userProfile.update({
    where: { id: profileId },
    data: {
      lastCheckIn: now,
      streak: nextStreak,
    },
  });

  const badges = await loadBadgeIds(profileId);
  return toSummary(updated, badges);
}

export async function completeMission(options: {
  profileId: string;
  missionId: string;
  category: MissionCategory;
  xpReward: number;
  cycleKey?: string;
  verificationState?: MissionCompletionRecord["verificationState"];
  verificationReason?: string | null;
}): Promise<{ profile: UserProfileSummary; completion: MissionCompletionRecord }> {
  const reward = clampMissionReward(options.xpReward);
  const cycleKey = options.cycleKey?.trim().length ? options.cycleKey.trim() : "legacy";
  const verificationState = options.verificationState ?? "verified";
  const verificationReason = options.verificationReason ?? null;

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.userMission.findUnique({
      where: {
        userProfileId_missionId_category_cycleKey: {
          userProfileId: options.profileId,
          missionId: options.missionId,
          category: options.category,
          cycleKey,
        },
      },
    });
    if (duplicate) {
      throw new MissionAlreadyCompletedError();
    }

    const completion = await tx.userMission.create({
      data: {
        userProfileId: options.profileId,
        missionId: options.missionId,
        category: options.category,
        cycleKey,
        xpEarned: reward,
        verificationState,
        verificationReason,
      },
    });

    const updatedProfile = await tx.userProfile.update({
      where: { id: options.profileId },
      data: {
        totalXp: { increment: reward },
      },
    });

    const { level } = computeLevel(updatedProfile.totalXp);
    if (level !== updatedProfile.level) {
      await tx.userProfile.update({
        where: { id: options.profileId },
        data: {
          level,
        },
      });
      updatedProfile.level = level;
    }

    const summary = toSummary(updatedProfile);
    const badges = await loadBadgeIds(options.profileId);
    return {
      profile: { ...summary, badges },
      completion: {
        missionId: completion.missionId,
        category: completion.category as MissionCategory,
        cycleKey: completion.cycleKey,
        xpEarned: completion.xpEarned,
        completedAt: completion.completedAt.toISOString(),
        verificationState: completion.verificationState as MissionCompletionRecord["verificationState"],
        verificationReason: completion.verificationReason ?? null,
      },
    };
  }).catch((error) => {
    if (error instanceof MissionAlreadyCompletedError) {
      throw error;
    }
    logger.error("mission completion failed", { error });
    throw error;
  });
}

export async function unlockAchievement(options: {
  profileId: string;
  achievementId: string;
  metadata?: Record<string, unknown>;
}): Promise<AchievementRecord> {
  const record = await prisma.userAchievement.upsert({
    where: {
      userProfileId_achievementId: {
        userProfileId: options.profileId,
        achievementId: options.achievementId,
      },
    },
    update: {
      metadata: options.metadata ?? Prisma.JsonNull,
      unlockedAt: new Date(),
    },
    create: {
      userProfileId: options.profileId,
      achievementId: options.achievementId,
      metadata: options.metadata ?? Prisma.JsonNull,
    },
  });

  return {
    achievementId: record.achievementId,
    unlockedAt: record.unlockedAt.toISOString(),
    metadata: record.metadata as Record<string, unknown> | null,
  };
}

export async function redeemReward(options: {
  profileId: string;
  rewardId: string;
  cost?: number;
  metadata?: Record<string, unknown>;
}): Promise<{ profile: UserProfileSummary; reward: RewardRedemptionRecord }> {
  const definition = resolveRewardDefinition(options.rewardId);
  if (!definition) {
    throw new Error("Unknown reward");
  }

  if (typeof options.cost === "number" && options.cost !== definition.cost) {
    throw new Error("Reward cost mismatch");
  }

  // Check if this is a badge and if user already owns it
  if (definition.badgeId) {
    const existingBadge = await prisma.userBadge.findUnique({
      where: {
        userProfileId_badgeId: {
          userProfileId: options.profileId,
          badgeId: definition.badgeId.trim().toLowerCase(),
        },
      },
    });
    if (existingBadge) {
      throw new Error("Badge already owned");
    }
  }

  const initialMetadata =
    options.metadata && Object.keys(options.metadata).length > 0 ? options.metadata : undefined;

  const context = await prisma.$transaction(async (tx) => {
    const profile = await tx.userProfile.findUnique({ where: { id: options.profileId } });
    if (!profile) {
      throw new Error("Profile not found");
    }
    if (profile.totalXp < definition.cost) {
      throw new InsufficientXpError();
    }

    const redemption = await tx.rewardRedemption.create({
      data: {
        userProfileId: options.profileId,
        rewardId: definition.id,
        cost: definition.cost,
        metadata: initialMetadata ?? Prisma.JsonNull,
      },
    });

    const updatedProfile = await tx.userProfile.update({
      where: { id: options.profileId },
      data: {
        totalXp: { decrement: definition.cost },
      },
    });

    const { level } = computeLevel(updatedProfile.totalXp);
    if (level !== updatedProfile.level) {
      await tx.userProfile.update({
        where: { id: options.profileId },
        data: { level },
      });
      updatedProfile.level = level;
    }

    return {
      profile,
      updatedProfile,
      redemption,
    };
  });

  let rewardMetadata: Record<string, unknown> = {
    ...(initialMetadata ?? {}),
  };

  if (definition.creditDays) {
    const codeResult = await issueCreditCode(
      {
        profileId: options.profileId,
        telegramUserId: context.profile.telegramUserId,
        valueDays: definition.creditDays,
        metadata: {
          rewardId: definition.id,
        },
      },
      prisma,
    );

    rewardMetadata = {
      ...rewardMetadata,
      creditDays: definition.creditDays,
      creditCodePreview: maskCreditCode(codeResult.code),
    };

    await notifyUserOfCreditCode({
      telegramUserId: context.profile.telegramUserId,
      code: codeResult.code,
      valueDays: definition.creditDays,
    }).catch((error) => {
      logger.warn("failed to deliver credit code DM", {
        profileId: options.profileId,
        rewardId: definition.id,
        error,
      });
    });
  }

  if (definition.badgeId) {
    await awardBadge(options.profileId, definition.badgeId);
    rewardMetadata = {
      ...rewardMetadata,
      badgeId: definition.badgeId,
    };
  }

  if (Object.keys(rewardMetadata).length > 0) {
    await prisma.rewardRedemption.update({
      where: { id: context.redemption.id },
      data: {
        metadata: rewardMetadata as Prisma.JsonValue,
      },
    });
  }

  const badges = await loadBadgeIds(options.profileId);
  const summary = toSummary(context.updatedProfile, badges);

  return {
    profile: summary,
    reward: {
      id: context.redemption.id,
      rewardId: context.redemption.rewardId,
      cost: context.redemption.cost,
      redeemedAt: context.redemption.redeemedAt.toISOString(),
      metadata: Object.keys(rewardMetadata).length > 0 ? rewardMetadata : null,
    },
  };
}

export type BadgeRedemptionSummary = {
  id: string;
  profileId: string;
  telegramUserId: string;
  displayName: string | null;
  username: string | null;
  badgeId: string;
  redeemedAt: string;
};

export async function listRecentBadgeRedemptions(limit = 20): Promise<BadgeRedemptionSummary[]> {
  const take = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = await prisma.rewardRedemption.findMany({
    where: {
      rewardId: {
        startsWith: "badge-",
      },
    },
    orderBy: { redeemedAt: "desc" },
    take,
    include: {
      profile: {
        select: {
          id: true,
          telegramUserId: true,
          displayName: true,
          username: true,
        },
      },
    },
  });

  return rows.map((row) => {
    const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
    const badgeId =
      typeof metadata?.badgeId === "string"
        ? metadata.badgeId
        : row.rewardId.replace(/^badge-/, "");
    return {
      id: row.id,
      profileId: row.userProfileId,
      telegramUserId: row.profile?.telegramUserId ?? "unknown",
      displayName: row.profile?.displayName ?? null,
      username: row.profile?.username ?? null,
      badgeId,
      redeemedAt: row.redeemedAt.toISOString(),
    };
  });
}
