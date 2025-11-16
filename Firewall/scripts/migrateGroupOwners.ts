import { Telegraf } from "telegraf";
import { setMissingGroupOwners } from "../server/db/migrations/setMissingGroupOwners.js";
import { logger } from "../server/utils/logger.js";

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN environment variable is required");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

async function main() {
  logger.info("Starting group owners migration script");
  
  try {
    await setMissingGroupOwners(bot.telegram);
    logger.info("Migration completed successfully");
    process.exit(0);
  } catch (error) {
    logger.error("Migration failed", { error });
    process.exit(1);
  }
}

main();
