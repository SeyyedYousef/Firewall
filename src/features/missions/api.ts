import type { MissionCompletionRecord, UserProfileSummary } from "@/features/profile/api";
import { requestApi } from "@/features/dashboard/api";

type ChannelMissionResponse = {
  ok: boolean;
  rewardXp?: number;
  completion?: MissionCompletionRecord | null;
  profile?: UserProfileSummary | null;
  alreadyCompleted?: boolean;
};

type DailySpinResponse = {
  rewardXp: number;
  completion: MissionCompletionRecord;
  profile: UserProfileSummary;
};

export async function completeChannelMission(channelUsername: string): Promise<ChannelMissionResponse> {
  const normalized = channelUsername.replace(/^@+/u, "").trim();
  if (!normalized) {
    throw new Error("Invalid channel username");
  }

  const payload = await requestApi<ChannelMissionResponse>("/missions/verify-channel", {
    method: "POST",
    body: JSON.stringify({ channelUsername: normalized }),
  });

  if (!payload || typeof payload.ok !== "boolean") {
    throw new Error("Unexpected response from verification endpoint");
  }

  return {
    ok: payload.ok,
    rewardXp: typeof payload.rewardXp === "number" ? payload.rewardXp : undefined,
    completion: payload.completion ?? null,
    profile: payload.profile ?? null,
    alreadyCompleted: Boolean(payload.alreadyCompleted),
  };
}

export async function spinDailyWheel(): Promise<DailySpinResponse> {
  const payload = await requestApi<DailySpinResponse>("/missions/daily-spin", {
    method: "POST",
  });
  if (
    !payload ||
    typeof payload.rewardXp !== "number" ||
    !payload.completion ||
    !payload.profile
  ) {
    throw new Error("Unexpected response from daily spin endpoint");
  }

  return payload;
}
