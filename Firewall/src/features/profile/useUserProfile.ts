import { useCallback, useEffect, useState } from "react";

import {
  fetchAchievements,
  fetchUserProfile,
  recordDailyCheckIn,
  redeemReward as apiRedeemReward,
  type AchievementRecord,
  type ProfileBootstrap,
  type RewardRedemptionRecord,
  type UserProfileSummary,
} from "./api.ts";

// Cache for profile data to reduce API calls
const CACHE_DURATION = 30000; // 30 seconds
let profileCache: {
  data: ProfileBootstrap | null;
  timestamp: number;
} = { data: null, timestamp: 0 };

let achievementsCache: {
  data: AchievementRecord[] | null;
  timestamp: number;
} = { data: null, timestamp: 0 };

type UseUserProfileResult = {
  profile: UserProfileSummary | null;
  missions: ProfileBootstrap["missions"];
  achievements: AchievementRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  checkIn: () => Promise<void>;
  redeemReward: (rewardId: string, cost: number) => Promise<RewardRedemptionRecord>;
};

const EMPTY_MISSIONS: ProfileBootstrap["missions"] = {
  daily: [],
  weekly: [],
  monthly: [],
  general: [],
};

export function useUserProfile(): UseUserProfileResult {
  const [profile, setProfile] = useState<UserProfileSummary | null>(null);
  const [missions, setMissions] = useState<ProfileBootstrap["missions"]>(EMPTY_MISSIONS);
  const [achievements, setAchievements] = useState<AchievementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    
    try {
      const now = Date.now();
      
      // Check cache for profile data
      const profileCacheValid = !forceRefresh && 
        profileCache.data && 
        (now - profileCache.timestamp) < CACHE_DURATION;
        
      // Check cache for achievements data  
      const achievementsCacheValid = !forceRefresh &&
        achievementsCache.data &&
        (now - achievementsCache.timestamp) < CACHE_DURATION;
      
      let bootstrap: ProfileBootstrap;
      let unlocked: AchievementRecord[];
      
      if (profileCacheValid && achievementsCacheValid) {
        // Use cached data
        bootstrap = profileCache.data!;
        unlocked = achievementsCache.data!;
      } else {
        // Fetch fresh data in parallel
        const promises: Promise<any>[] = [];
        
        if (!profileCacheValid) {
          promises.push(fetchUserProfile());
        } else {
          promises.push(Promise.resolve(profileCache.data));
        }
        
        if (!achievementsCacheValid) {
          promises.push(fetchAchievements());
        } else {
          promises.push(Promise.resolve(achievementsCache.data));
        }
        
        const [bootstrapResult, unlockedResult] = await Promise.all(promises);
        
        bootstrap = bootstrapResult;
        unlocked = unlockedResult;
        
        // Update cache
        if (!profileCacheValid) {
          profileCache = { data: bootstrap, timestamp: now };
        }
        if (!achievementsCacheValid) {
          achievementsCache = { data: unlocked, timestamp: now };
        }
      }
      
      setProfile(bootstrap.profile);
      setMissions({
        daily: bootstrap.missions.daily ?? [],
        weekly: bootstrap.missions.weekly ?? [],
        monthly: bootstrap.missions.monthly ?? [],
        general: bootstrap.missions.general ?? [],
      });
      setAchievements(unlocked);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load profile";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const checkIn = useCallback(async () => {
    try {
      const response = await recordDailyCheckIn();
      setProfile(response.profile);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to record check-in";
      setError(message);
    }
  }, []);

  const redeemReward = useCallback(
    async (rewardId: string, cost: number) => {
      if (!profile) {
        throw new Error("Profile not loaded");
      }
      try {
        const result = await apiRedeemReward(rewardId, cost);
        setProfile(result.profile);
        return result.reward;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to redeem reward";
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [profile],
  );

  const refresh = useCallback(() => load(true), [load]);

  return {
    profile,
    missions,
    achievements,
    loading,
    error,
    refresh,
    checkIn,
    redeemReward,
  };
}
