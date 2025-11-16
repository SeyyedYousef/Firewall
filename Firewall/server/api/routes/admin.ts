import { Router } from "express";
import { getState, withState } from "../../../bot/state.js";
import { prisma } from "../../db/client.js";

type AdminRouterOptions = {
  ownerTelegramId: string | null;
  telegram?: any;
};

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router();

  // Reset bot endpoint - completely wipes bot data and leaves all groups
  router.post("/reset-bot", async (req, res) => {
    try {
      const { ownerTelegramId, confirmationCode } = req.body;

      // Verify owner access
      if (!ownerTelegramId || ownerTelegramId !== options.ownerTelegramId) {
        return res.status(403).json({ error: "Unauthorized - owner access required" });
      }

      // Verify confirmation
      if (confirmationCode !== "RESET_CONFIRMED") {
        return res.status(400).json({ error: "Invalid confirmation code" });
      }

      const telegram = options.telegram;
      if (!telegram) {
        return res.status(500).json({ error: "Telegram bot instance not available" });
      }

      // Load current state to get groups
      const currentState = getState();
      const groupIds = Object.keys(currentState.groups);
      let groupsLeft = 0;
      let recordsDeleted = 0;

      // Leave all groups
      for (const chatId of groupIds) {
        try {
          await telegram.leaveChat(chatId);
          groupsLeft++;
        } catch (error) {
          console.warn(`Failed to leave group ${chatId}:`, error);
          // Continue with other groups even if one fails
        }
      }

      // Delete all database records
      try {
        // Delete group records
        const groupDeleteResult = await prisma.group.deleteMany({});
        recordsDeleted += groupDeleteResult.count;

        // Delete stars transactions
        const starsDeleteResult = await prisma.starsTransaction.deleteMany({});
        recordsDeleted += starsDeleteResult.count;

        // Delete firewall rules
        const firewallDeleteResult = await prisma.firewallRule.deleteMany({});
        recordsDeleted += firewallDeleteResult.count;

        // Delete membership events
        const membershipDeleteResult = await prisma.membershipEvent.deleteMany({});
        recordsDeleted += membershipDeleteResult.count;

        // Delete analytics events
        const analyticsDeleteResult = await prisma.analyticsEvent.deleteMany({});
        recordsDeleted += analyticsDeleteResult.count;

      } catch (error) {
        console.error("Database cleanup error:", error);
        return res.status(500).json({ error: "Failed to clean database" });
      }

      // Reset bot state to empty - create fresh state structure
      const emptyState = {
        panelAdmins: [],
        bannedUserIds: [],
        groups: {},
        settings: {
          freeDays: 7,
          monthlyStars: 100,
          welcomeMessages: [],
          onboardingMessages: [],
          gpidHelpText: "",
          buttonLabels: {},
          channelAnnouncement: "",
          infoCommands: ""
        },
        ownerSession: { state: "idle" as const },
        promoSlides: [],
        broadcasts: [],
        stars: {
          balance: 0,
          groups: {}
        }
      };

      // Reset state using internal function (we'll need to create a reset helper)
      // For now, we'll manually reset each part
      Object.assign(currentState, emptyState);

      res.json({
        success: true,
        groupsLeft,
        recordsDeleted,
        message: "Bot reset completed successfully"
      });

    } catch (error) {
      console.error("Bot reset error:", error);
      res.status(500).json({ 
        error: "Internal server error during reset",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return router;
}
