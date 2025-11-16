import { Router } from "express";
import { createGroupsRouter } from "./routes/groups.js";
import { createStarsRouter } from "./routes/stars.js";
import { createFirewallRouter } from "./routes/firewall.js";
import { createMissionsRouter } from "./routes/missions.js";
import { createGiveawaysRouter } from "./routes/giveaways.js";
import { createPromoSlidesRouter } from "./routes/promoSlides.js";
import { createProfileRouter } from "./routes/profile.js";
import { createAdminRouter } from "./routes/admin.js";
import { createReferralsRouter } from "./routes/referrals.js";
import { createBroadcastsRouter } from "./routes/broadcasts.js";

type ApiRouterOptions = {
  ownerTelegramId: string | null;
  telegram?: any;
};

export function createApiRouter(options: ApiRouterOptions): Router {
  const router = Router();

  router.use("/profile", createProfileRouter());
  router.use("/groups", createGroupsRouter({ telegram: options.telegram }));
  router.use("/stars", createStarsRouter({ ownerTelegramId: options.ownerTelegramId }));
  router.use("/firewall", createFirewallRouter());
  router.use("/missions", createMissionsRouter());
  router.use("/promo-slides", createPromoSlidesRouter());
  router.use("/giveaways", createGiveawaysRouter());
  router.use("/referrals", createReferralsRouter());
  router.use("/broadcasts", createBroadcastsRouter());
  router.use("/", createAdminRouter({ ownerTelegramId: options.ownerTelegramId, telegram: options.telegram }));

  return router;
}
