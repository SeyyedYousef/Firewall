import "dotenv/config";

import { startBotPolling, startBotWebhookServer } from "../bot/index.js";
import { logger } from "./utils/logger.js";
import { requireEnv, optionalWarnEnv } from "./utils/env.js";

async function main(): Promise<void> {
  requireEnv(["BOT_TOKEN", "BOT_OWNER_ID", "MINI_APP_URL"], "bot bootstrap");
  optionalWarnEnv(["CHANNEL_URL"], "bot bootstrap");

  const mode = (process.env.BOT_START_MODE ?? "webhook").toLowerCase();

  if (mode === "polling") {
    logger.info("server starting bot in polling mode");
    await startBotPolling();
    return;
  }

  requireEnv(["WEBHOOK_DOMAIN"], "webhook mode");

  const domain = process.env.WEBHOOK_DOMAIN!.trim();
  const webhookPath = process.env.WEBHOOK_PATH;
  let secretToken = process.env.BOT_WEBHOOK_SECRET?.trim();
  const isProduction = (process.env.NODE_ENV ?? "").toLowerCase() === "production";

  if (!secretToken || secretToken.length < 16) {
    const guidance =
      "BOT_WEBHOOK_SECRET must be a strong random string when running in webhook mode. See docs/deployment-guide.md";
    if (isProduction) {
      logger.error(guidance);
      throw new Error("BOT_WEBHOOK_SECRET is required in production webhook mode");
    }
    logger.warn(
      `${guidance}. Continuing because NODE_ENV is not 'production', but webhook requests will not be authenticated.`,
    );
    secretToken = undefined;
  }

  const port = Number.isFinite(Number(process.env.PORT)) ? Number(process.env.PORT) : undefined;
  const host = process.env.HOST;

  logger.info("server starting webhook server");
  await startBotWebhookServer({
    domain,
    path: webhookPath,
    port,
    host,
    secretToken,
  });
}

main().catch((error) => {
  logger.error("server failed to start bot server", { error });
  process.exitCode = 1;
});
