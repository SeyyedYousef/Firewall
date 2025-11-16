import { randomInt } from "node:crypto";

import { prisma } from "../db/client.js";
import { logger } from "../utils/logger.js";
import { resolveActiveMissionCycle } from "./missionCycleService.js";
import { getMissionDefinition, listMissionDefinitions } from "./missionRegistry.js";
import type { MissionDefinition } from "./missionRegistry.js";
import type { MissionCategory } from "./missionTypes.js";
import {
  MissionAlreadyCompletedError,
  completeMission,
  getOrCreateUserProfile,
  type MissionCompletionRecord,
  type UserProfileSummary,
} from "./userProfileService.js";

type MissionGrantContext = Record<string, unknown>;

export type MissionGrantResult = {
  rewardXp: number;
  completion: MissionCompletionRecord;
  profile: UserProfileSummary;
};

export class MissionVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionVerificationError";
  }
}

export async function spinDailyWheel(profileId: string): Promise<MissionGrantResult> {
  const definition = getMissionDefinition("daily-wheel");
  if (definition.verification.kind !== "daily-spin") {
    throw new MissionVerificationError("daily-wheel mission is not configured for daily spin rewards");
  }

  const rewardXp = randomInt(definition.verification.minXp, definition.verification.maxXp + 1);
  return grantMissionCompletion({
    profileId,
    missionId: definition.id,
    rewardXpOverride: rewardXp,
    context: {
      source: "daily-spin",
      minXp: definition.verification.minXp,
      maxXp: definition.verification.maxXp,
    },
  });
}

export async function grantChannelMembershipMission(options: {
  profileId: string;
  missionId?: string;
  channelUsername: string;
  context?: MissionGrantContext;
}): Promise<MissionGrantResult> {
  const missionId = options.missionId ?? "join-channel";
  const definition = getMissionDefinition(missionId);
  if (definition.verification.kind !== "channel-membership") {
    throw new MissionVerificationError(`Mission '${missionId}' is not a channel membership mission`);
  }

  const normalized = normalizeChannelUsername(options.channelUsername);
  const expected = normalizeChannelUsername(definition.verification.channelUsername);
  if (normalized !== expected) {
    throw new MissionVerificationError(
      `Mission '${missionId}' requires membership in @${expected}, but received @${normalized}`,
    );
  }

  return grantMissionCompletion({
    profileId: options.profileId,
    missionId: definition.id,
    context: {
      source: "channel-membership",
      channelUsername: expected,
      ...(options.context ?? {}),
    },
  });
}

export async function grantMissionCompletion(options: {
  profileId: string;
  missionId: string;
  rewardXpOverride?: number;
  context?: MissionGrantContext;
}): Promise<MissionGrantResult> {
  const definition = getMissionDefinition(options.missionId);
  const rewardXp = resolveReward(definition, options.rewardXpOverride);

  const cycle = await resolveActiveMissionCycle(definition.category);
  const result = await completeMission({
    profileId: options.profileId,
    missionId: definition.id,
    category: definition.category,
    xpReward: rewardXp,
    cycleKey: cycle.cycleKey,
  });

  await logMissionEvent({
    profileId: options.profileId,
    missionId: definition.id,
    category: definition.category,
    cycleKey: cycle.cycleKey,
    state: "verified",
    payload: {
      rewardXp,
      verificationKind: definition.verification.kind,
      context: options.context ?? null,
    },
  });

  return {
    rewardXp,
    completion: result.completion,
    profile: result.profile,
  };
}

export function resolveReward(definition: MissionDefinition, rewardOverride?: number): number {
  if (definition.verification.kind === "daily-spin") {
    if (rewardOverride === undefined) {
      throw new MissionVerificationError("Daily spin missions require an explicit reward override");
    }
    if (!Number.isFinite(rewardOverride)) {
      throw new MissionVerificationError("Daily spin reward must be a finite number");
    }
    const reward = Math.floor(rewardOverride);
    if (reward < definition.verification.minXp || reward > definition.verification.maxXp) {
      throw new MissionVerificationError(
        `Daily spin reward must be between ${definition.verification.minXp} and ${definition.verification.maxXp}`,
      );
    }
    return reward;
  }

  if (definition.verification.kind === "channel-membership") {
    if (rewardOverride !== undefined && rewardOverride !== definition.verification.xp) {
      throw new MissionVerificationError("Channel membership missions do not support overriding the reward XP");
    }
    return definition.verification.xp;
  }

  if (definition.verification.kind === "backend-event") {
    if (rewardOverride !== undefined && rewardOverride !== definition.verification.xp) {
      throw new MissionVerificationError("Backend-event missions do not support overriding the reward XP");
    }
    return definition.verification.xp;
  }

  throw new MissionVerificationError(`Unsupported verification kind for mission '${definition.id}'`);
}

type MissionEventLog = {
  profileId: string;
  missionId: string;
  category: MissionCategory;
  cycleKey: string;
  state: string;
  payload: Record<string, unknown> | null;
};

async function logMissionEvent(entry: MissionEventLog): Promise<void> {
  await prisma.missionEvent.create({
    data: {
      userProfileId: entry.profileId,
      missionId: entry.missionId,
      category: entry.category,
      cycleKey: entry.cycleKey,
      state: entry.state,
      payload: entry.payload,
    },
  });
}

function normalizeChannelUsername(value: string): string {
  return value.replace(/^@+/u, "").trim().toLowerCase();
}

export { MissionAlreadyCompletedError } from "./userProfileService.js";

type ProfileHints = {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
};

async function resolveProfileFromTelegram(
  telegramUserId: string | number,
  hints?: ProfileHints,
): Promise<UserProfileSummary> {
  const normalizedId =
    typeof telegramUserId === "number" ? telegramUserId.toString() : telegramUserId.toString().trim();
  return getOrCreateUserProfile(normalizedId, {
    username: hints?.username ?? undefined,
    firstName: hints?.firstName ?? undefined,
    lastName: hints?.lastName ?? undefined,
    photoUrl: hints?.photoUrl ?? undefined,
  });
}

async function tryGrantMission(profileId: string, missionId: string, context?: MissionGrantContext): Promise<void> {
  try {
    await grantMissionCompletion({
      profileId,
      missionId,
      context,
    });
  } catch (error) {
    if (error instanceof MissionAlreadyCompletedError) {
      return;
    }
    logger.warn("mission grant failed", { missionId, profileId, error });
  }
}

export async function recordGroupCreditRenewal(
  ownerTelegramId: string | number,
  context: MissionGrantContext = {},
): Promise<void> {
  const profile = await resolveProfileFromTelegram(ownerTelegramId);
  await tryGrantMission(profile.id, "renew-weekly", {
    source: "group-credit-renewed",
    ...context,
  });
}

export async function recordGiveawayCreation(
  ownerTelegramId: string | number,
  context: MissionGrantContext = {},
): Promise<void> {
  const profile = await resolveProfileFromTelegram(ownerTelegramId);
  await tryGrantMission(profile.id, "monthly-giveaway", {
    source: "giveaway-created",
    ...context,
  });
}

export async function recordBadgeEquipped(
  ownerTelegramId: string | number,
  badgeId: string,
  context: MissionGrantContext = {},
): Promise<void> {
  const profile = await resolveProfileFromTelegram(ownerTelegramId);
  const lower = badgeId.toLowerCase();
  const generalMissionId = `badge-${lower}`;

  await tryGrantMission(profile.id, generalMissionId, {
    source: "badge-equipped",
    badgeId: lower,
    ...context,
  });

  if (lower === "rookie") {
    await tryGrantMission(profile.id, "rookie-badge-progress", {
      source: "badge-equipped",
      badgeId: lower,
      ...context,
    });
  }

  if (lower === "master") {
    await tryGrantMission(profile.id, "master-badge-progress", {
      source: "badge-equipped",
      badgeId: lower,
      ...context,
    });
  }
}

export async function recordStreakProgress(options: {
  telegramUserId: string | number;
  newStreak: number;
  previousStreak?: number;
}): Promise<void> {
  const profile = await resolveProfileFromTelegram(options.telegramUserId);
  const { newStreak } = options;

  if (newStreak >= 3 && (options.previousStreak ?? 0) < 3) {
    await tryGrantMission(profile.id, "complete-daily-3", {
      source: "daily-check-in",
      streak: newStreak,
    });
  }

  if (newStreak >= 6 && (options.previousStreak ?? 0) < 6) {
    await tryGrantMission(profile.id, "streak-day-6", {
      source: "daily-check-in",
      streak: newStreak,
    });
  }
}

const REFERRAL_THRESHOLDS: Array<{ missionId: string; requirement: number }> = [
  { missionId: "referral-1", requirement: 1 },
  { missionId: "referral-3", requirement: 3 },
  { missionId: "referral-6", requirement: 6 },
  { missionId: "referral-9", requirement: 9 },
  { missionId: "referral-30", requirement: 30 },
];

export async function recordReferralActivation(options: {
  telegramUserId: string | number;
  activatedTotal: number;
  activatedThisWeek?: number;
  activatedThisMonth?: number;
}): Promise<void> {
  const profile = await resolveProfileFromTelegram(options.telegramUserId);

  if ((options.activatedThisWeek ?? 0) >= 1) {
    await tryGrantMission(profile.id, "weekly-referral-activated", {
      source: "referral-activated-weekly",
      activatedThisWeek: options.activatedThisWeek ?? 0,
    });
  }

  if ((options.activatedThisMonth ?? 0) >= 3) {
    await tryGrantMission(profile.id, "monthly-referrals", {
      source: "referral-activated-monthly",
      activatedThisMonth: options.activatedThisMonth ?? 0,
    });
  }

  for (const threshold of REFERRAL_THRESHOLDS) {
    if (options.activatedTotal >= threshold.requirement) {
      await tryGrantMission(profile.id, threshold.missionId, {
        source: "referral-activated-total",
        activatedTotal: options.activatedTotal,
        requirement: threshold.requirement,
      });
    }
  }
}

export async function recordBackendMissionEvent(options: {
  telegramUserId: string | number;
  event: string;
  context?: MissionGrantContext;
}): Promise<void> {
  const matches = listMissionDefinitions().filter(
    (definition) =>
      definition.verification.kind === "backend-event" && definition.verification.event === options.event,
  );
  if (matches.length === 0) {
    logger.warn("no mission definitions matched backend event", options);
    return;
  }
  const profile = await resolveProfileFromTelegram(options.telegramUserId);
  await Promise.all(
    matches.map((definition) =>
      tryGrantMission(profile.id, definition.id, {
        source: "backend-event",
        event: options.event,
        ...(options.context ?? {}),
      }),
    ),
  );
}
