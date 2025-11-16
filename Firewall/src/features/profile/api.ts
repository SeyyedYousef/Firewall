import { requestApi } from "@/features/dashboard/api.ts";

export type MissionCategory = "daily" | "weekly" | "monthly" | "general";

export type UserProfileSummary = {
  id: string;
  telegramUserId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  totalXp: number;
  level: number;
  previousLevelXp: number;
  nextLevelXp: number | null;
  progressToNext: number;
  streak: number;
  lastCheckIn: string | null;
  weeklyObjectivesCompleted?: number;
  weeklyObjectivesTotal?: number;
  seasonAmbitionProgress?: number;
  seasonAmbitionGoal?: string | null;
  uptimeScore?: number;
  missionsCleared?: number;
  globalRank?: number | null;
  seasonMultiplier?: number;
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

export type ProfileBootstrap = {
  profile: UserProfileSummary;
  missions: Record<MissionCategory, string[]>;
};

export async function fetchUserProfile(): Promise<ProfileBootstrap> {
  return requestApi<ProfileBootstrap>("/profile", { method: "GET" });
}

export async function fetchMissionCompletions(): Promise<MissionCompletionRecord[]> {
  const response = await requestApi<{ completions: MissionCompletionRecord[] }>("/profile/missions");
  return response.completions;
}

export async function recordDailyCheckIn() {
  return requestApi<{ profile: UserProfileSummary }>("/profile/check-in", { method: "POST" });
}

export async function fetchAchievements(): Promise<AchievementRecord[]> {
  const response = await requestApi<{ achievements: AchievementRecord[] }>("/profile/achievements");
  return response.achievements;
}

export async function redeemReward(rewardId: string, cost: number) {
  return requestApi<{ profile: UserProfileSummary; reward: RewardRedemptionRecord }>("/profile/rewards/redeem", {
    method: "POST",
    body: JSON.stringify({ rewardId, cost }),
  });
}

export type UserPreferences = {
  pushEnabled: boolean;
  digestEnabled: boolean;
  autoEscalate: boolean;
  silentFailures: boolean;
};

export async function fetchUserPreferences(): Promise<UserPreferences> {
  const response = await requestApi<{ preferences: UserPreferences }>("/profile/preferences");
  return response.preferences;
}

export async function updateUserPreferences(preferences: UserPreferences) {
  return requestApi<{ success: boolean; preferences: UserPreferences }>("/profile/preferences", {
    method: "PUT",
    body: JSON.stringify({ preferences }),
  });
}
