import { Router } from "express";
import { requireTelegramInitData } from "../middleware/telegramInit.js";
import { prisma } from "../../db/client.js";
import { recordReferralActivation } from "../../services/missionVerificationService.js";

export function createReferralsRouter(): Router {
  const router = Router();

  // Track new referral (when someone clicks referral link)
  router.post("/track", async (req, res) => {
    try {
      const { referrerId, newUserId, source } = req.body;

      if (!referrerId || !newUserId) {
        return res.status(400).json({ error: "referrerId and newUserId are required" });
      }

      // Check if referral already exists
      const existing = await prisma.referral.findFirst({
        where: {
          referrerId: referrerId.toString(),
          referredUserId: newUserId.toString(),
        },
      });

      if (existing) {
        return res.json({ success: true, message: "Referral already tracked" });
      }

      // Create new referral record
      const referral = await prisma.referral.create({
        data: {
          referrerId: referrerId.toString(),
          referredUserId: newUserId.toString(),
          source: source || "unknown",
          trackedAt: new Date(),
        },
      });

      res.json({ 
        success: true, 
        referralId: referral.id,
        message: "Referral tracked successfully" 
      });

    } catch (error) {
      console.error("Error tracking referral:", error);
      res.status(500).json({ error: "Failed to track referral" });
    }
  });

  // Activate referral (when referred user makes first purchase)
  router.post("/activate", requireTelegramInitData(), async (req, res) => {
    try {
      const { referredUserId, purchaseAmount } = req.body;
      const auth = req.telegramAuth!;

      if (!referredUserId) {
        return res.status(400).json({ error: "referredUserId is required" });
      }

      // Find the referral record
      const referral = await prisma.referral.findFirst({
        where: {
          referredUserId: referredUserId.toString(),
          activatedAt: null, // Not yet activated
        },
      });

      if (!referral) {
        return res.status(404).json({ error: "Referral not found or already activated" });
      }

      // Activate the referral
      const updatedReferral = await prisma.referral.update({
        where: { id: referral.id },
        data: {
          activatedAt: new Date(),
          purchaseAmount: purchaseAmount || 0,
        },
      });

      // Count total activated referrals for the referrer
      const totalActivated = await prisma.referral.count({
        where: {
          referrerId: referral.referrerId,
          activatedAt: { not: null },
        },
      });

      // Count activated this week and month
      const now = new Date();
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const activatedThisWeek = await prisma.referral.count({
        where: {
          referrerId: referral.referrerId,
          activatedAt: { 
            not: null,
            gte: startOfWeek,
          },
        },
      });

      const activatedThisMonth = await prisma.referral.count({
        where: {
          referrerId: referral.referrerId,
          activatedAt: { 
            not: null,
            gte: startOfMonth,
          },
        },
      });

      // Grant missions to referrer
      await recordReferralActivation({
        telegramUserId: referral.referrerId,
        activatedTotal: totalActivated,
        activatedThisWeek,
        activatedThisMonth,
      });

      res.json({ 
        success: true, 
        referralId: updatedReferral.id,
        totalActivated,
        activatedThisWeek,
        activatedThisMonth,
        message: "Referral activated successfully" 
      });

    } catch (error) {
      console.error("Error activating referral:", error);
      res.status(500).json({ error: "Failed to activate referral" });
    }
  });

  // Get referral statistics
  router.get("/stats", requireTelegramInitData(), async (req, res) => {
    try {
      const auth = req.telegramAuth!;
      const userId = auth.userId.toString();

      // Count tracked and activated referrals
      const tracked = await prisma.referral.count({
        where: { referrerId: userId },
      });

      const activated = await prisma.referral.count({
        where: { 
          referrerId: userId,
          activatedAt: { not: null },
        },
      });

      // Calculate XP earned (assuming 100 XP per activation)
      const xpEarned = activated * 100;

      res.json({
        tracked,
        activated,
        pending: tracked - activated,
        xpEarned,
      });

    } catch (error) {
      console.error("Error fetching referral stats:", error);
      res.status(500).json({ error: "Failed to fetch referral statistics" });
    }
  });

  // Get referral list for user
  router.get("/list", requireTelegramInitData(), async (req, res) => {
    try {
      const auth = req.telegramAuth!;
      const userId = auth.userId.toString();

      const referrals = await prisma.referral.findMany({
        where: { referrerId: userId },
        orderBy: { trackedAt: 'desc' },
        take: 50, // Limit to last 50 referrals
      });

      res.json({ referrals });

    } catch (error) {
      console.error("Error fetching referral list:", error);
      res.status(500).json({ error: "Failed to fetch referral list" });
    }
  });

  return router;
}
