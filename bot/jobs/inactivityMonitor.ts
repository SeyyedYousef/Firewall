import type { Telegraf } from "telegraf";
import { listInactiveGroups, upsertGroup, type GroupRecord } from "../state.js";
import { logger } from "../../server/utils/logger.js";
import { escapeHtml, collectRecipients, type MonitorRecipientOptions } from "../../server/utils/monitorUtils.js";

const INACTIVITY_DAYS = 3;
const MONITOR_INTERVAL_MS = Number.parseInt(process.env.INACTIVITY_MONITOR_INTERVAL_MS ?? "3600000", 10); // Default: 1 hour

let monitorTimer: NodeJS.Timeout | null = null;

export type InactivityMonitorOptions = MonitorRecipientOptions;

export function startInactivityMonitor(bot: Telegraf, options: InactivityMonitorOptions = {}): void {
  if (monitorTimer) {
    return;
  }

  if (Number.isNaN(MONITOR_INTERVAL_MS) || MONITOR_INTERVAL_MS <= 0) {
    logger.warn("inactivity monitor disabled due to invalid interval", {
      interval: process.env.INACTIVITY_MONITOR_INTERVAL_MS,
    });
    return;
  }

  const run = async () => {
    try {
      await evaluateInactiveGroups(bot, options);
    } catch (error) {
      logger.error("inactivity monitor run failed", { error });
    }
  };

  // Run after a short delay to avoid startup conflicts
  setTimeout(() => {
    void run();
    monitorTimer = setInterval(run, MONITOR_INTERVAL_MS);
  }, 60_000); // Start after 1 minute

  logger.info("inactivity monitor started", { intervalMs: MONITOR_INTERVAL_MS, inactivityDays: INACTIVITY_DAYS });
}

export function stopInactivityMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    logger.info("inactivity monitor stopped");
  }
}

async function evaluateInactiveGroups(bot: Telegraf, options: InactivityMonitorOptions): Promise<void> {
  const inactiveGroups = listInactiveGroups(INACTIVITY_DAYS);

  if (inactiveGroups.length === 0) {
    logger.debug("inactivity monitor: no inactive groups found");
    return;
  }

  logger.info("inactivity monitor: processing inactive groups", { count: inactiveGroups.length });

  const recipients = collectRecipients(options);

  for (const group of inactiveGroups) {
    try {
      // Send warning message to the group before leaving
      await sendInactivityWarning(bot, group);

      // Leave the group
      await leaveGroup(bot, group);

      // Notify admins
      if (recipients.length > 0) {
        await notifyAdmins(bot, recipients, group);
      }

      logger.info("inactivity monitor: left inactive group", {
        chatId: group.chatId,
        title: group.title,
        lastActivity: group.lastActivityAt
      });
    } catch (error) {
      logger.warn("inactivity monitor: failed to process inactive group", {
        chatId: group.chatId,
        error
      });
    }
  }
}

async function sendInactivityWarning(bot: Telegraf, group: GroupRecord): Promise<void> {
  try {
    const message = [
      `⚠️ <b>Inactivity Notice</b>`,
      ``,
      `This group has been inactive for ${INACTIVITY_DAYS} days.`,
      `Firewall Bot is leaving the group.`,
      ``,
      `To continue using Firewall Bot, simply add it back to the group.`,
      ``,
      `Thank you for using Firewall! 🛡️`,
    ].join("\n");

    await bot.telegram.sendMessage(group.chatId, message, { parse_mode: "HTML" });
  } catch (error) {
    // Ignore errors when sending message (group might have restricted bot)
    logger.debug("inactivity monitor: could not send warning to group", { chatId: group.chatId, error });
  }
}

async function leaveGroup(bot: Telegraf, group: GroupRecord): Promise<void> {
  try {
    await bot.telegram.leaveChat(group.chatId);

    // Mark group as unmanaged
    upsertGroup({
      chatId: group.chatId,
      managed: false,
    });
  } catch (error) {
    // May fail if already left or banned
    logger.debug("inactivity monitor: could not leave group", { chatId: group.chatId, error });
  }
}

async function notifyAdmins(bot: Telegraf, recipients: string[], group: GroupRecord): Promise<void> {
  const message = [
    `📤 <b>Auto-Leave Notice</b>`,
    ``,
    `Firewall Bot has left an inactive group:`,
    `• <b>Group:</b> ${escapeHtml(group.title)}`,
    `• <b>ID:</b> <code>${group.chatId}</code>`,
    `• <b>Reason:</b> No activity for ${INACTIVITY_DAYS} days`,
  ].join("\n");

  for (const recipient of recipients) {
    try {
      await bot.telegram.sendMessage(recipient, message, { parse_mode: "HTML" });
    } catch (error) {
      logger.debug("inactivity monitor: could not notify admin", { recipient, error });
    }
  }
}
