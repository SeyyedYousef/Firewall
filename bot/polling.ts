import { logger } from "../server/utils/logger.js";
import { startBotPolling } from "./index.js";

startBotPolling().catch((error) => {
  logger.error("bot failed to start polling", { error });
  process.exitCode = 1;
});
