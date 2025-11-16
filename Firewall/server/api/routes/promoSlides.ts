import { Router } from "express";

import { requireTelegramInitData } from "../middleware/telegramInit.js";
import { requirePanelAdmin, resolvePanelPrivileges } from "../middleware/acl.js";
import {
  createPromoSlide,
  deletePromoSlide,
  listActivePromoSlides,
  listPromoSlides,
  recordPromoSlideEvent,
  reorderPromoSlides,
  selectPromoSlideVariants,
  updatePromoSlide,
} from "../../services/promoSlideService.js";
import { addPromoSlide, removePromoSlide, setPromoSlides } from "../../../bot/state.js";

export function createPromoSlidesRouter(): Router {
  const router = Router();

  router.use(requireTelegramInitData());

  router.get("/active", async (req, res) => {
    const slides = await listActivePromoSlides();
    const userId = req.telegramAuth?.userId ?? null;
    const selected = selectPromoSlideVariants(slides, userId);
    
    // Only bot owner can manage promo slides
    const ownerTelegramId = process.env.BOT_OWNER_ID?.trim() ?? null;
    const canManage = Boolean(userId && ownerTelegramId && userId === ownerTelegramId);
    
    res.json({
      slides: selected,
      total: slides.length,
      canManage,
    });
  });

  router.get("/", requirePanelAdmin(), async (_req, res) => {
    const slides = await listPromoSlides();
    res.json({
      slides,
    });
  });

  router.post("/", requirePanelAdmin(), async (req, res) => {
    const {
      imageData,
      linkUrl,
      title,
      subtitle,
      description,
      accentColor,
      ctaLabel,
      ctaLink,
      abTestGroupId,
      variant,
      startsAt,
      endsAt,
      active,
      position,
      metadata,
      fileName,
    } = req.body ?? {};

    if (typeof imageData !== "string" || imageData.trim().length === 0) {
      res.status(400).json({ error: "imageData is required" });
      return;
    }
    if (typeof linkUrl !== "string" || linkUrl.trim().length === 0) {
      res.status(400).json({ error: "linkUrl is required" });
      return;
    }

    const id =
      typeof req.body?.id === "string" && req.body.id.trim().length > 0
        ? req.body.id.trim()
        : `promo-${Date.now()}`;

    try {
      const record = await createPromoSlide({
        id,
        imageData,
        imageFileName: typeof fileName === "string" ? fileName : null,
        linkUrl,
        title,
        subtitle,
        description,
        accentColor,
        ctaLabel,
        ctaLink,
        abTestGroupId,
        variant,
        startsAt,
        endsAt,
        active,
        position: typeof position === "number" ? position : undefined,
        createdBy: req.telegramAuth?.userId ?? null,
        metadata: metadata && typeof metadata === "object" ? metadata : undefined,
      });
      addPromoSlide(record, { persist: false });
      res.status(201).json(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create promo slide";
      res.status(400).json({ error: message });
    }
  });

  router.post("/telegram", requirePanelAdmin(), async (req, res) => {
    const { fileId, linkUrl, title, subtitle, description, accentColor, ctaLabel, ctaLink, abTestGroupId, variant, startsAt, endsAt, active, position } =
      req.body ?? {};

    if (typeof fileId !== "string" || fileId.trim().length === 0) {
      res.status(400).json({ error: "fileId is required" });
      return;
    }
    if (typeof linkUrl !== "string" || linkUrl.trim().length === 0) {
      res.status(400).json({ error: "linkUrl is required" });
      return;
    }

    const id =
      typeof req.body?.id === "string" && req.body.id.trim().length > 0
        ? req.body.id.trim()
        : `promo-${Date.now()}`;

    try {
      const record = await createPromoSlide({
        id,
        fileId: fileId.trim(),
        linkUrl,
        title,
        subtitle,
        description,
        accentColor,
        ctaLabel,
        ctaLink,
        abTestGroupId,
        variant,
        startsAt,
        endsAt,
        active,
        position: typeof position === "number" ? position : undefined,
        createdBy: req.telegramAuth?.userId ?? null,
        metadata: {
          source: "mini-app",
        },
      });
      addPromoSlide(record, { persist: false });
      res.status(201).json(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create promo slide";
      res.status(400).json({ error: message });
    }
  });

  router.patch("/order", requirePanelAdmin(), async (req, res) => {
    const { order } = req.body ?? {};
    if (!Array.isArray(order) || !order.every((id) => typeof id === "string")) {
      res.status(400).json({ error: "order must be an array of slide ids" });
      return;
    }

    const slides = await reorderPromoSlides(order as string[]);
    setPromoSlides(slides, { persist: false });
    res.json({
      slides,
    });
  });

  router.patch("/:id", requirePanelAdmin(), async (req, res) => {
    const { id } = req.params;
    try {
      const record = await updatePromoSlide(id, req.body ?? {});
      addPromoSlide(record, { persist: false });
      res.json(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update promo slide";
      res.status(400).json({ error: message });
    }
  });

  router.delete("/:id", requirePanelAdmin(), async (req, res) => {
    const { id } = req.params;
    await deletePromoSlide(id);
    removePromoSlide(id, { persist: false });
    res.status(204).end();
  });

  router.post("/:id/events", async (req, res) => {
    const { id } = req.params;
    const { type, durationMs, bounced, variant } = req.body ?? {};
    if (type !== "view" && type !== "click") {
      res.status(400).json({ error: "type must be 'view' or 'click'" });
      return;
    }

    const updated = await recordPromoSlideEvent(id, type, {
      durationMs: typeof durationMs === "number" ? durationMs : undefined,
      bounced: typeof bounced === "boolean" ? bounced : undefined,
      variant: typeof variant === "string" ? variant : undefined,
    });

    if (updated) {
      addPromoSlide(updated, { persist: false });
    }

    res.json({
      ok: true,
    });
  });

  return router;
}
