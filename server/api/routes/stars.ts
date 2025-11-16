import { Router } from "express";
import { requireTelegramInitData } from "../middleware/telegramInit.js";
import { requireAuthentication, requirePanelAdmin } from "../middleware/acl.js";
import { buildStarsOverview } from "../../services/dashboardService.js";
import {
  finalizeStarsPurchase,
  getStarsWalletSummary,
  purchaseStars,
  refundStarsTransaction,
} from "../../services/starsService.js";
import { listRecentBadgeRedemptions } from "../../services/userProfileService.js";

type StarsRouterOptions = {
  ownerTelegramId: string | null;
};

export function createStarsRouter(options: StarsRouterOptions): Router {
  const router = Router();

  router.use(requireTelegramInitData());

  // Overview endpoint - accessible to all authenticated users
  router.get("/overview", requireAuthentication(), async (req, res) => {
    const auth = req.telegramAuth ?? null;
    const privileges = req.panelPrivileges ?? null;
    const currentUserId = auth?.userId ?? null;
    const includeAll = Boolean(privileges?.isPanelAdmin);
    const overview = await buildStarsOverview(currentUserId, { includeAll });
    res.json(overview);
  });

  // All other endpoints require panel admin access
  router.use(requirePanelAdmin());

  router.post("/purchase", async (req, res) => {
    const { groupId, planId, metadata, gifted } = req.body ?? {};
    try {
      const ownerId = req.telegramAuth?.userId;
      if (!ownerId) {
        res.status(401).json({ error: "Telegram authentication required" });
        return;
      }
      if (typeof groupId !== "string" || groupId.trim().length === 0) {
        res.status(400).json({ error: "groupId is required" });
        return;
      }
      if (typeof planId !== "string" || planId.trim().length === 0) {
        res.status(400).json({ error: "planId is required" });
        return;
      }

      const result = await purchaseStars({
        ownerTelegramId: ownerId,
        groupId: groupId.trim(),
        planId: planId.trim(),
        gifted: Boolean(gifted),
        metadata,
        managed: true,
      });

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete purchase";
      let status =
        error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: number }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      if (message === "Insufficient Stars balance") {
        status = 400;
      }
      res.status(status).json({ error: message });
    }
  });

  router.post("/gift", async (req, res) => {
    const { planId, group } = req.body ?? {};
    if (typeof planId !== "string" || planId.trim().length === 0) {
      res.status(400).json({ error: "planId is required" });
      return;
    }
    if (!group || typeof group !== "object") {
      res.status(400).json({ error: "group payload is required" });
      return;
    }

    const ownerId = req.telegramAuth?.userId;
    if (!ownerId) {
      res.status(401).json({ error: "Telegram authentication required" });
      return;
    }

    const rawGroup = group as {
      id?: unknown;
      title?: unknown;
      membersCount?: unknown;
      photoUrl?: unknown;
      inviteLink?: unknown;
      canManage?: unknown;
    };

    const groupId =
      typeof rawGroup.id === "string" && rawGroup.id.trim().length > 0
        ? rawGroup.id.trim()
        : typeof rawGroup.id === "number"
          ? rawGroup.id.toString()
          : "";
    if (groupId.length === 0) {
      res.status(400).json({ error: "group.id is required" });
      return;
    }

    try {
      const result = await purchaseStars({
        ownerTelegramId: ownerId,
        groupId,
        planId: planId.trim(),
        gifted: true,
        metadata: {
          title: rawGroup.title,
          membersCount: rawGroup.membersCount,
          inviteLink: rawGroup.inviteLink,
          photoUrl: rawGroup.photoUrl,
        },
        managed: Boolean(rawGroup.canManage),
      });

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete gift";
      let status =
        error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: number }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      if (message === "Insufficient Stars balance") {
        status = 400;
      }
      res.status(status).json({ error: message });
    }
  });

  router.get("/wallet", async (req, res) => {
    const ownerId = req.telegramAuth?.userId ?? null;
    try {
      const limit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
      const summary = await getStarsWalletSummary(ownerId, { limit: Number.isFinite(limit) ? limit : undefined });
      res.json(summary);
    } catch (error) {
      const status =
        error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: number }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      res.status(status).json({ error: error instanceof Error ? error.message : "Failed to load wallet summary" });
    }
  });

  router.post("/transactions/:id/complete", async (req, res) => {
    const { id } = req.params;
    const { externalId, status, metadata } = req.body ?? {};

    try {
      const result = await finalizeStarsPurchase(id, {
        externalId: typeof externalId === "string" ? externalId : undefined,
        status: status === "refunded" ? "refunded" : "completed",
        metadataOverride: metadata && typeof metadata === "object" ? metadata : undefined,
      });
      res.json(result);
    } catch (error) {
      const statusCode =
        error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: number }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      res.status(statusCode).json({ error: error instanceof Error ? error.message : "Unable to finalize transaction" });
    }
  });

  router.post("/transactions/:id/refund", async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body ?? {};
    try {
      const result = await refundStarsTransaction(id, {
        operatorTelegramId: req.telegramAuth?.userId,
        reason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : undefined,
      });
      res.json(result);
    } catch (error) {
      const statusCode =
        error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: number }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      res.status(statusCode).json({ error: error instanceof Error ? error.message : "Unable to refund transaction" });
    }
  });

  router.get("/rewards/badges", async (req, res) => {
    try {
      const limitParam = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
      const limit = Number.isFinite(limitParam) ? (limitParam as number) : 25;
      const redemptions = await listRecentBadgeRedemptions(limit);
      res.json({ redemptions });
    } catch (error) {
      const statusCode =
        error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: number }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      res.status(statusCode).json({ error: error instanceof Error ? error.message : "Failed to load badge redemptions" });
    }
  });

  return router;
}
