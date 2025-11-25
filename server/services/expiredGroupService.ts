import { logger } from "../utils/logger.js";
import { fetchGroupsFromDb } from "../db/stateRepository.js";
import { setGroupStatus } from "../db/mutateRepository.js";
import { getStarsState, removeGroupCompletely, getState } from "../../bot/state.js";
import { prisma } from "../db/client.js";

const GRACE_PERIOD_DAYS = 3; // Days after expiration before auto-leave
const DAY_MS = 24 * 60 * 60 * 1000;

// Track when we last sent expiration notifications (in memory - resets on restart)
const lastNotificationSent: Map<string, number> = new Map();

export interface ExpiredGroupInfo {
  chatId: string;
  title: string;
  ownerId: string | null;
  expiresAt: Date;
  graceEndsAt: Date;
  daysSinceExpiration: number;
  shouldNotifyOwner: boolean;
  shouldLeave: boolean;
}

/**
 * Check for expired groups and determine actions needed
 */
export async function checkExpiredGroups(): Promise<ExpiredGroupInfo[]> {
  try {
    const groups = await fetchGroupsFromDb();
    const starsState = getStarsState();
    const botState = getState();
    const now = new Date();
    const nowMs = now.getTime();
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

      const expiresAtMs = Date.parse(starsEntry.expiresAt);
      if (!Number.isFinite(expiresAtMs)) {
        continue;
      }

      const expiresAt = new Date(expiresAtMs);
      const graceEndsAt = new Date(expiresAtMs + GRACE_PERIOD_DAYS * DAY_MS);

      const isExpired = nowMs > expiresAtMs;
      if (!isExpired) {
        continue;
      }

      const daysSinceExpiration = Math.floor((nowMs - expiresAtMs) / DAY_MS);
      const shouldLeave = nowMs > graceEndsAt.getTime();

      // Check if we should send notification today (once per day)
      const lastNotified = lastNotificationSent.get(group.chatId) ?? 0;
      const hoursSinceLastNotification = (nowMs - lastNotified) / (60 * 60 * 1000);
      const shouldNotifyOwner = !shouldLeave && 
        Boolean(group.ownerId) && 
        hoursSinceLastNotification >= 24;

      expiredGroups.push({
        chatId: group.chatId,
        title: group.title || "Unknown Group",
        ownerId: group.ownerId,
        expiresAt,
        graceEndsAt,
        daysSinceExpiration,
        shouldNotifyOwner,
        shouldLeave,
      });
    }

    return expiredGroups;
  } catch (error) {
    logger.error("Failed to check expired groups", { error });
    return [];
  }
}

/**
 * Send expiration notification to group owner
 */
async function notifyGroupOwner(bot: any, group: ExpiredGroupInfo): Promise<void> {
  if (!group.ownerId) {
    return;
  }

  const daysLeft = GRACE_PERIOD_DAYS - group.daysSinceExpiration;
  const miniAppUrl = process.env.MINI_APP_URL;

  const message = `⚠️ <b>Group Subscription Expired</b>

Your group "<b>${escapeHtml(group.title)}</b>" subscription has expired.

📅 <b>Grace period:</b> ${daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining` : 'Ending today'}

⏰ <b>What happens next:</b>
• Firewall protection is currently <b>paused</b>
• If not renewed within ${daysLeft > 0 ? daysLeft : 'today'} day${daysLeft === 1 ? '' : 's'}, the bot will leave the group
• All settings and data will be deleted

${miniAppUrl ? `🔄 <a href="${miniAppUrl}">Renew now</a> to continue protection` : '🔄 Use /panel to renew your subscription'}

Thank you for using Firewall! 🔥`;

  try {
    await bot.telegram.sendMessage(group.ownerId, message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    
    // Mark notification as sent
    lastNotificationSent.set(group.chatId, Date.now());
    
    logger.info("Sent expiration notification to owner", {
      chatId: group.chatId,
      ownerId: group.ownerId,
      daysLeft,
    });
  } catch (error) {
    logger.warn("Failed to send expiration notification to owner", {
      chatId: group.chatId,
      ownerId: group.ownerId,
      error,
    });
  }
}

/**
 * Leave expired group and clean up all data
 */
async function leaveAndCleanupGroup(bot: any, group: ExpiredGroupInfo): Promise<void> {
  try {
    // Send farewell message to the group
    const farewellMessage = `🔥 <b>Firewall Protection Ended</b>

Your group's subscription has expired and the 3-day grace period has ended.

The bot will now leave this group and all settings will be deleted.

To use Firewall again in the future:
• Add the bot back to your group
• Activate a new subscription

Thank you for using Firewall! 🙏`;

    try {
      await bot.telegram.sendMessage(group.chatId, farewellMessage, {
        parse_mode: "HTML",
      });
    } catch (msgError) {
      logger.warn("Failed to send farewell message to group", { 
        chatId: group.chatId, 
        error: msgError 
      });
    }

    // Notify owner about the removal
    if (group.ownerId) {
      const ownerMessage = `❌ <b>Group Removed</b>

Your group "<b>${escapeHtml(group.title)}</b>" has been removed from Firewall due to subscription expiration.

All settings and data have been deleted.

You can add the bot back to your group and purchase a new subscription anytime.

Thank you for using Firewall! 🔥`;

      try {
        await bot.telegram.sendMessage(group.ownerId, ownerMessage, {
          parse_mode: "HTML",
        });
      } catch (ownerMsgError) {
        logger.warn("Failed to send removal notification to owner", {
          ownerId: group.ownerId,
          error: ownerMsgError,
        });
      }
    }

    // Leave the group
    try {
      await bot.telegram.leaveChat(group.chatId);
    } catch (leaveError) {
      logger.warn("Failed to leave chat (may have already been removed)", {
        chatId: group.chatId,
        error: leaveError,
      });
    }
    
    // Clean up database records
    await cleanupGroupData(group.chatId);
    
    // Clean up local state
    removeGroupCompletely(group.chatId);
    
    // Remove from notification tracking
    lastNotificationSent.delete(group.chatId);
    
    logger.info("Left and cleaned up expired group", {
      chatId: group.chatId,
      title: group.title,
      ownerId: group.ownerId,
    });
  } catch (error) {
    logger.error("Failed to leave and cleanup expired group", {
      chatId: group.chatId,
      title: group.title,
      error,
    });
  }
}

/**
 * Clean up all database records for a group
 */
async function cleanupGroupData(chatId: string): Promise<void> {
  try {
    // Update group status to removed
    await setGroupStatus(chatId, "removed", {});
    
    // Delete related records using raw queries for safety
    const group = await prisma.group.findUnique({
      where: { telegramChatId: chatId },
      select: { id: true },
    });

    if (group) {
      // Delete group settings if the model exists
      try {
        await prisma.$executeRaw`DELETE FROM "GroupSetting" WHERE "groupId" = ${group.id}`;
      } catch (e) {
        logger.debug("No group settings to delete or table doesn't exist", { chatId });
      }

      // Delete ban rules
      try {
        await prisma.$executeRaw`DELETE FROM "BanRule" WHERE "groupId" = ${group.id}`;
      } catch (e) {
        logger.debug("No ban rules to delete or table doesn't exist", { chatId });
      }

      // Delete silence windows
      try {
        await prisma.$executeRaw`DELETE FROM "SilenceWindow" WHERE "groupId" = ${group.id}`;
      } catch (e) {
        logger.debug("No silence windows to delete or table doesn't exist", { chatId });
      }
    }

    logger.info("Cleaned up all database records for group", { chatId });
  } catch (error) {
    logger.error("Failed to cleanup group database records", {
      chatId,
      error,
    });
  }
}

/**
 * Process all expired groups
 */
export async function processExpiredGroups(bot: any): Promise<void> {
  try {
    const expiredGroups = await checkExpiredGroups();
    
    for (const group of expiredGroups) {
      if (group.shouldLeave) {
        // Grace period ended - leave and cleanup
        await leaveAndCleanupGroup(bot, group);
      } else if (group.shouldNotifyOwner) {
        // Still in grace period - send daily notification
        await notifyGroupOwner(bot, group);
      }
    }
    
    if (expiredGroups.length > 0) {
      logger.info("Processed expired groups", {
        total: expiredGroups.length,
        notified: expiredGroups.filter(g => g.shouldNotifyOwner).length,
        removed: expiredGroups.filter(g => g.shouldLeave).length,
      });
    }
  } catch (error) {
    logger.error("Failed to process expired groups", { error });
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

  // Run after a short delay to let bot initialize
  setTimeout(() => {
    void runMonitor();
  }, 10000);

  // Schedule periodic runs
  setInterval(runMonitor, MONITOR_INTERVAL);
  
  logger.info("Expired groups monitor started", { 
    intervalMs: MONITOR_INTERVAL,
    gracePeriodDays: GRACE_PERIOD_DAYS,
  });
}

/**
 * Helper function to escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
