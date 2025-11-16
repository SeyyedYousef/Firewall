import { Router } from "express";
import { requireTelegramInitData } from "../middleware/telegramInit.js";
import { requireOwnerAccess } from "../middleware/acl.js";
import { listBroadcasts, recordBroadcast } from "../../../bot/state.js";
import { logger } from "../../utils/logger.js";

export function createBroadcastsRouter(): Router {
  const router = Router();

  router.use(requireTelegramInitData());
  router.use(requireOwnerAccess());

  // Get broadcast history
  router.get("/", async (req, res) => {
    try {
      const broadcasts = listBroadcasts();
      res.json({
        broadcasts,
        total: broadcasts.length,
      });
    } catch (error) {
      logger.error("failed to fetch broadcasts", { error });
      res.status(500).json({ error: "Failed to fetch broadcasts" });
    }
  });

  // Create new broadcast
  router.post("/", async (req, res) => {
    try {
      const { message, confirm } = req.body;

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({ error: "Message is required" });
      }

      if (!confirm) {
        return res.status(400).json({ 
          error: "Confirmation required",
          preview: {
            message: message.trim(),
            estimatedGroups: "Will be calculated based on active groups"
          }
        });
      }

      // Record the broadcast
      const broadcast = recordBroadcast(message.trim());

      // TODO: Implement actual broadcast sending logic
      // This would involve sending the message to all active groups
      logger.info("broadcast created", {
        broadcastId: broadcast.id,
        messageLength: message.length,
      });

      res.json({
        success: true,
        broadcast,
        message: "Broadcast created successfully"
      });

    } catch (error) {
      logger.error("failed to create broadcast", { error });
      res.status(500).json({ error: "Failed to create broadcast" });
    }
  });

  // Get broadcast statistics
  router.get("/stats", async (req, res) => {
    try {
      const broadcasts = listBroadcasts();
      const now = new Date();
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const recentBroadcasts = broadcasts.filter(b => 
        new Date(b.createdAt) > last30Days
      );

      res.json({
        total: broadcasts.length,
        last30Days: recentBroadcasts.length,
        lastBroadcast: broadcasts[0]?.createdAt || null,
        avgPerMonth: broadcasts.length > 0 ? Math.round(broadcasts.length / 12) : 0,
      });
    } catch (error) {
      logger.error("failed to fetch broadcast stats", { error });
      res.status(500).json({ error: "Failed to fetch broadcast statistics" });
    }
  });

  return router;
}
