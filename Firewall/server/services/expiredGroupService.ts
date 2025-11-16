import { logger } from "../utils/logger.js";
import { fetchGroupsFromDb } from "../db/stateRepository.js";
import { setGroupStatus } from "../db/mutateRepository.js";
import { getStarsState } from "../../bot/state.js";

const GRACE_PERIOD_DAYS = 7; // Days after expiration before auto-leave
const CLEANUP_DELAY_HOURS = 24; // Hours after leave before removing from list

export interface ExpiredGroupInfo {
  chatId: string;
  title: string;
  ownerId: string | null;
  expiresAt: Date;
  graceEndsAt: Date;
  shouldLeave: boolean;
  shouldCleanup: boolean;
}

/**
 * Check for expired groups and determine actions needed
 */
export async function checkExpiredGroups(): Promise<ExpiredGroupInfo[]> {
  try {
    const groups = await fetchGroupsFromDb();
    const starsState = getStarsState();
    const now = new Date();
    const expiredGroups: ExpiredGroupInfo[] = [];

    for (const group of groups) {
      // Skip if group is already marked as removed
      if (group.status === "removed") {
        continue;
      }

      // Check stars expiration
      const starsEntry = starsState.groups[group.chatId];
      if (!starsEntry || !starsEntry.expiresAt) {
        continue;
      }

      const expiresAt = new Date(starsEntry.expiresAt);
      const graceEndsAt = new Date(expiresAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
      const cleanupTime = new Date(graceEndsAt.getTime() + CLEANUP_DELAY_HOURS * 60 * 60 * 1000);

      const isExpired = now > expiresAt;
      const shouldLeave = now > graceEndsAt;
      const shouldCleanup = now > cleanupTime;

      if (isExpired) {
        expiredGroups.push({
          chatId: group.chatId,
          title: group.title || "Unknown Group",
          ownerId: group.ownerId,
          expiresAt,
          graceEndsAt,
          shouldLeave,
          shouldCleanup,
        });
      }
    }

    return expiredGroups;
  } catch (error) {
    logger.error("Failed to check expired groups", { error });
    return [];
  }
}

/**
 * Leave expired groups and update their status
 */
export async function processExpiredGroups(bot: any): Promise<void> {
  try {
    const expiredGroups = await checkExpiredGroups();
    
    for (const group of expiredGroups) {
      if (group.shouldLeave) {
        await leaveExpiredGroup(bot, group);
      }
      
      if (group.shouldCleanup) {
        await cleanupExpiredGroup(group);
      }
    }
  } catch (error) {
    logger.error("Failed to process expired groups", { error });
  }
}

/**
 * Leave a specific expired group
 */
async function leaveExpiredGroup(bot: any, group: ExpiredGroupInfo): Promise<void> {
  try {
    // Send farewell message before leaving
    const farewellMessage = `🔥 <b>Firewall Protection Expired</b>

Your group protection has expired and the grace period has ended.

To continue using Firewall:
• Renew your subscription in the dashboard
• Contact support if you need assistance

Thank you for using Firewall! 🙏`;

    try {
      await bot.telegram.sendMessage(group.chatId, farewellMessage, {
        parse_mode: "HTML",
      });
    } catch (msgError) {
      logger.warn("Failed to send farewell message", { 
        chatId: group.chatId, 
        error: msgError 
      });
    }

    // Leave the group
    await bot.telegram.leaveChat(group.chatId);
    
    // Update group status to removed
    await setGroupStatus(group.chatId, "removed", { title: group.title });
    
    logger.info("Left expired group", {
      chatId: group.chatId,
      title: group.title,
      ownerId: group.ownerId,
    });
  } catch (error) {
    logger.error("Failed to leave expired group", {
      chatId: group.chatId,
      title: group.title,
      error,
    });
  }
}

/**
 * Clean up expired group from lists (after delay)
 */
async function cleanupExpiredGroup(group: ExpiredGroupInfo): Promise<void> {
  try {
    // Additional cleanup logic can be added here
    // For now, just log the cleanup
    logger.info("Cleaned up expired group", {
      chatId: group.chatId,
      title: group.title,
    });
  } catch (error) {
    logger.error("Failed to cleanup expired group", {
      chatId: group.chatId,
      error,
    });
  }
}

/**
 * Start the expired groups monitor
 */
export function startExpiredGroupsMonitor(bot: any): void {
  const MONITOR_INTERVAL = 60 * 60 * 1000; // Check every hour

  const runMonitor = async () => {
    try {
      await processExpiredGroups(bot);
    } catch (error) {
      logger.error("Expired groups monitor error", { error });
    }
  };

  // Run immediately
  void runMonitor();

  // Schedule periodic runs
  setInterval(runMonitor, MONITOR_INTERVAL);
  
  logger.info("Expired groups monitor started", { 
    intervalMs: MONITOR_INTERVAL,
    gracePeriodDays: GRACE_PERIOD_DAYS,
    cleanupDelayHours: CLEANUP_DELAY_HOURS,
  });
}
