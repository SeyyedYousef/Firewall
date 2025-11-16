import { Router } from "express";

import { requireTelegramInitData } from "../middleware/telegramInit.js";
import {
  DailyCheckInAlreadyRecordedError,
  InsufficientXpError,
  getOrCreateUserProfile,
  listAchievements,
  listMissionCompletions,
  recordDailyCheckIn,
  redeemReward,
  type MissionCategory,
} from "../../services/userProfileService.js";
import { recordStreakProgress } from "../../services/missionVerificationService.js";
import { logger } from "../../utils/logger.js";
import { prisma } from "../../db/client.js";

export function createProfileRouter(): Router {
  const router = Router();

  router.use(requireTelegramInitData());

  router.get("/", async (req, res) => {
    const auth = req.telegramAuth!;
    
    // Parallel execution for better performance
    const [profile, completions] = await Promise.all([
      getOrCreateUserProfile(auth.userId, {
        username: auth.user?.username,
        firstName: auth.user?.first_name,
        lastName: auth.user?.last_name,
        photoUrl: auth.user?.photo_url,
      }),
      // Defer mission completions loading if not needed immediately
      listMissionCompletions(auth.userId).catch(() => [])
    ]);

    const grouped = completions.reduce<Record<MissionCategory, string[]>>((acc, record) => {
      if (!acc[record.category]) {
        acc[record.category] = [];
      }
      acc[record.category]!.push(record.missionId);
      return acc;
    }, {
      daily: [],
      weekly: [],
      monthly: [],
      general: [],
    });

    // Add cache headers for better performance
    res.set('Cache-Control', 'public, max-age=30'); // 30 seconds cache
    res.json({
      profile,
      missions: grouped,
    });
  });

  router.get("/missions", async (req, res) => {
    const auth = req.telegramAuth!;
    const profile = await getOrCreateUserProfile(auth.userId, {
      username: auth.user?.username,
      firstName: auth.user?.first_name,
      lastName: auth.user?.last_name,
      photoUrl: auth.user?.photo_url,
    });
    const completions = await listMissionCompletions(profile.id);
    res.json({ completions });
  });

  router.post("/missions/:missionId/complete", (_req, res) => {
    res.status(410).json({
      error:
        "Manual mission completion is no longer supported. Use the dedicated verification endpoints or wait for backend confirmation.",
    });
  });


  router.post("/rewards/redeem", async (req, res) => {
    const auth = req.telegramAuth!;
    const rewardIdRaw = req.body?.rewardId;
    const costRaw = req.body?.cost;
    const metadataRaw = req.body?.metadata;

    if (typeof rewardIdRaw !== "string" || rewardIdRaw.trim().length === 0) {
      res.status(400).json({ error: "rewardId is required" });
      return;
    }

    const profile = await getOrCreateUserProfile(auth.userId, {
      username: auth.user?.username,
      firstName: auth.user?.first_name,
      lastName: auth.user?.last_name,
      photoUrl: auth.user?.photo_url,
    });

    try {
      const result = await redeemReward({
        profileId: profile.id,
        rewardId: rewardIdRaw.trim(),
        cost: typeof costRaw === "number" ? costRaw : undefined,
        metadata:
          metadataRaw && typeof metadataRaw === "object" && !Array.isArray(metadataRaw)
            ? (metadataRaw as Record<string, unknown>)
            : undefined,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof InsufficientXpError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to redeem reward" });
    }
  });

  router.get("/achievements", async (req, res) => {
    const auth = req.telegramAuth!;
    const profile = await getOrCreateUserProfile(auth.userId, {
      username: auth.user?.username,
      firstName: auth.user?.first_name,
      lastName: auth.user?.last_name,
      photoUrl: auth.user?.photo_url,
    });
    const achievements = await listAchievements(profile.id);
    res.json({ achievements });
  });

  router.post("/check-in", async (req, res) => {
    const auth = req.telegramAuth!;
    const profile = await getOrCreateUserProfile(auth.userId, {
      username: auth.user?.username,
      firstName: auth.user?.first_name,
      lastName: auth.user?.last_name,
      photoUrl: auth.user?.photo_url,
    });
    try {
      const previousStreak = profile.streak;
      const updated = await recordDailyCheckIn(profile.id);
      try {
        await recordStreakProgress({
          telegramUserId: auth.userId,
          newStreak: updated.streak,
          previousStreak,
        });
      } catch (missionError) {
        logger.warn("failed to record streak mission progress", {
          telegramUserId: auth.userId,
          error: missionError,
        });
      }
      res.json({ profile: updated });
    } catch (error) {
      if (error instanceof DailyCheckInAlreadyRecordedError) {
        res.status(error.statusCode).json({ error: error.message, profile });
        return;
      }
      res.status(500).json({ error: "Failed to record check-in" });
    }
  });

  router.get("/preferences", async (req, res) => {
    const auth = req.telegramAuth!;
    const profile = await getOrCreateUserProfile(auth.userId, {
      username: auth.user?.username,
      firstName: auth.user?.first_name,
      lastName: auth.user?.last_name,
      photoUrl: auth.user?.photo_url,
    });
    
    // Get preferences directly from database
    const dbProfile = await prisma.userProfile.findUnique({
      where: { telegramUserId: auth.userId.toString() },
      select: { preferences: true }
    });
    
    const preferences = dbProfile?.preferences as Record<string, unknown> | null;
    res.json({ 
      preferences: preferences ?? {
        pushEnabled: true,
        digestEnabled: true,
        autoEscalate: false,
        silentFailures: true,
      }
    });
  });

  router.put("/preferences", async (req, res) => {
    const auth = req.telegramAuth!;
    const { preferences } = req.body;
    
    if (!preferences || typeof preferences !== 'object') {
      res.status(400).json({ error: "Invalid preferences data" });
      return;
    }

    try {
      const profile = await getOrCreateUserProfile(auth.userId, {
        username: auth.user?.username,
        firstName: auth.user?.first_name,
        lastName: auth.user?.last_name,
        photoUrl: auth.user?.photo_url,
      });

      const updatedProfile = await prisma.userProfile.update({
        where: { id: profile.id },
        data: { preferences },
      });

      res.json({ 
        success: true,
        preferences: updatedProfile.preferences 
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to update preferences" });
    }
  });

  return router;
}

