import type { Telegraf } from "telegraf";
import { logger } from "../server/utils/logger.js";
import { invalidateCachedRules } from "./processing/firewallEngine.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

export function installFirewall(_bot: Telegraf): void {
  if (!databaseAvailable) {
    logger.debug("firewall engine disabled (no DATABASE_URL)");
    return;
  }

  logger.info("firewall engine enabled via processing pipeline");
}

export async function invalidateFirewallCache(chatId?: string | null): Promise<void> {
  if (!databaseAvailable) {
    return;
  }
  await invalidateCachedRules(chatId ?? undefined);
}
