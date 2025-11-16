import { Router } from "express";

import { requireTelegramInitData } from "../middleware/telegramInit.js";
import { verifyTelegramChannelMembership } from "../../services/telegramMembershipService.js";
import {
  MissionAlreadyCompletedError,
  grantChannelMembershipMission,
  spinDailyWheel,
} from "../../services/missionVerificationService.js";
import { getOrCreateUserProfile } from "../../services/userProfileService.js";

export function createMissionsRouter(): Router {
  const router = Router();

  router.post(
    "/verify-channel",
    requireTelegramInitData(),
    async (req, res) => {
      const { channelUsername } = (req.body ?? {}) as { channelUsername?: unknown };
      if (typeof channelUsername !== "string" || channelUsername.trim().length === 0) {
        res.status(400).json({ error: "channelUsername is required" });
        return;
      }

      try {
        const auth = req.telegramAuth!;
        const profile = await getOrCreateUserProfile(auth.userId, {
          username: auth.user?.username,
          firstName: auth.user?.first_name,
          lastName: auth.user?.last_name,
          photoUrl: auth.user?.photo_url,
        });

        const ok = await verifyTelegramChannelMembership(auth.userId, channelUsername);
        if (!ok) {
          res.json({ ok: false });
          return;
        }

        try {
          const result = await grantChannelMembershipMission({
            profileId: profile.id,
            channelUsername,
            context: {
              telegramUserId: auth.userId,
            },
          });

          res.json({
            ok: true,
            rewardXp: result.rewardXp,
            completion: result.completion,
            profile: result.profile,
            alreadyCompleted: false,
          });
        } catch (error) {
          if (error instanceof MissionAlreadyCompletedError) {
            res.json({
              ok: true,
              rewardXp: 0,
              completion: null,
              profile,
              alreadyCompleted: true,
            });
            return;
          }
          throw error;
        }
      } catch (error) {
        res.status(502).json({
          error: error instanceof Error ? error.message : "Unable to verify channel membership",
        });
      }
    },
  );

  router.post(
    "/daily-spin",
    requireTelegramInitData(),
    async (req, res) => {
      try {
        const auth = req.telegramAuth!;
        const profile = await getOrCreateUserProfile(auth.userId, {
          username: auth.user?.username,
          firstName: auth.user?.first_name,
          lastName: auth.user?.last_name,
          photoUrl: auth.user?.photo_url,
        });

        const result = await spinDailyWheel(profile.id);
        res.status(201).json({
          rewardXp: result.rewardXp,
          completion: result.completion,
          profile: result.profile,
        });
      } catch (error) {
        if (error instanceof MissionAlreadyCompletedError) {
          res.status(409).json({ error: "Daily spin already completed for this cycle" });
          return;
        }
        res.status(500).json({
          error: error instanceof Error ? error.message : "Failed to process daily spin",
        });
      }
    },
  );

  return router;
}
