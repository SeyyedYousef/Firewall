import { Router } from "express";

import { requireTelegramInitData } from "../middleware/telegramInit.js";
import { requirePanelAdmin } from "../middleware/acl.js";
import {
  createGiveaway,
  getGiveawayConfig,
  getGiveawayDashboard,
  getGiveawayDetail,
  joinGiveaway,
  type ParticipantValidation,
  type RefundConditions,
} from "../../services/giveawayService.js";

export function createGiveawaysRouter(): Router {
  const router = Router();

  router.use(requireTelegramInitData());

  router.get("/config", requirePanelAdmin(), async (_req, res) => {
    const config = await getGiveawayConfig();
    res.json(config);
  });

  router.get("/dashboard", requirePanelAdmin(), async (req, res) => {
    const ownerTelegramId = req.telegramAuth?.userId ?? null;
    const dashboard = await getGiveawayDashboard(ownerTelegramId);
    res.json(dashboard);
  });

  router.post("/", requirePanelAdmin(), async (req, res) => {
    const auth = req.telegramAuth;
    if (!auth) {
      res.status(401).json({ error: "Telegram authentication required" });
      return;
    }

    const {
      groupId,
      planId,
      winners,
      durationHours,
      premiumOnly,
      extraChannel,
      title,
      validation,
      refundPolicy,
      notifyStart,
      notifyEnd,
    } = req.body ?? {};

    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    if (typeof planId !== "string" || planId.trim().length === 0) {
      res.status(400).json({ error: "planId is required" });
      return;
    }

    try {
      const result = await createGiveaway({
        ownerTelegramId: auth.userId,
        groupChatId: groupId.trim(),
        planId: planId.trim(),
        winners: Number.isFinite(Number(winners)) ? Number(winners) : 1,
        durationHours: Number.isFinite(Number(durationHours)) ? Number(durationHours) : 6,
        premiumOnly: Boolean(premiumOnly),
        extraChannel: typeof extraChannel === "string" ? extraChannel : null,
        title: typeof title === "string" ? title : null,
        notifyStart: Boolean(notifyStart),
        notifyEnd: Boolean(notifyEnd),
        validation:
          validation && typeof validation === "object"
            ? (validation as Partial<ParticipantValidation>)
            : undefined,
        refundPolicy:
          refundPolicy && typeof refundPolicy === "object"
            ? (refundPolicy as Partial<RefundConditions>)
            : undefined,
      });

      res.status(201).json(result);
    } catch (error) {
      const status =
        error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: number }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      res.status(status).json({ error: error instanceof Error ? error.message : "Failed to create giveaway" });
    }
  });

  router.get("/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const detail = await getGiveawayDetail(id, req.telegramAuth?.userId ?? null);
      res.json(detail);
    } catch (error) {
      const status =
        error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: number }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      res.status(status).json({ error: error instanceof Error ? error.message : "Failed to load giveaway detail" });
    }
  });

  router.post("/:id/join", async (req, res) => {
    const { id } = req.params;
    const auth = req.telegramAuth;
    if (!auth) {
      res.status(401).json({ error: "Telegram authentication required" });
      return;
    }

    try {
      const detail = await joinGiveaway(id, {
        telegramId: auth.userId,
        username: auth.user.username,
        firstName: auth.user.first_name,
        lastName: auth.user.last_name,
        isPremium: auth.user.is_premium,
        isBot: Boolean((auth.user as { is_bot?: boolean }).is_bot),
        sourceIp: req.ip,
      });
      res.json(detail);
    } catch (error) {
      const status =
        error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode?: number }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      res.status(status).json({ error: error instanceof Error ? error.message : "Unable to join giveaway" });
    }
  });

  return router;
}
