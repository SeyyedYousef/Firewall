import type { Telegraf } from "telegraf";
import { logger } from "../../server/utils/logger.js";
import { escapeHtml, collectRecipients, sendSafe, notifyRecipients, type MonitorRecipientOptions } from "../../server/utils/monitorUtils.js";
import { getState, markAdminPermission } from "../state.js";

const ADMIN_MONITOR_INTERVAL_MS = Number.parseInt(process.env.ADMIN_MONITOR_INTERVAL_MS ?? "3600000", 10);
const ADMIN_WARNING_COOLDOWN_MS = Number.parseInt(process.env.ADMIN_WARNING_COOLDOWN_MS ?? "21600000", 10);

let adminTimer: NodeJS.Timeout | null = null;

export type AdminMonitorOptions = MonitorRecipientOptions;

export function startAdminMonitor(bot: Telegraf, options: AdminMonitorOptions = {}): void {
  if (adminTimer) {
    return;
  }

  if (!Number.isFinite(ADMIN_MONITOR_INTERVAL_MS) || ADMIN_MONITOR_INTERVAL_MS <= 0) {
    logger.warn("admin monitor disabled due to invalid interval", {
      interval: process.env.ADMIN_MONITOR_INTERVAL_MS,
    });
    return;
  }

  const run = async () => {
    try {
      await evaluateAdminPermissions(bot, options);
    } catch (error) {
      logger.error("admin monitor run failed", { error });
    }
  };

  void run();
  adminTimer = setInterval(run, ADMIN_MONITOR_INTERVAL_MS);
  logger.info("admin monitor started", { intervalMs: ADMIN_MONITOR_INTERVAL_MS });
}

async function evaluateAdminPermissions(bot: Telegraf, options: AdminMonitorOptions): Promise<void> {
  if (!bot.botInfo) {
    try {
      await bot.telegram.getMe();
    } catch (error) {
      logger.error("admin monitor failed to fetch bot info", { error });
      return;
    }
  }

  const botId = bot.botInfo?.id;
  if (!botId) {
    return;
  }

  const state = getState();
  const recipients = collectRecipients(options);
  const now = Date.now();

  for (const group of Object.values(state.groups)) {
    const chatId = group.chatId;
    try {
      const member = await bot.telegram.getChatMember(chatId, botId);
      const status = member.status;
      const hasAdmin = status === "administrator" || status === "creator";

      if (hasAdmin) {
        if (group.adminRestricted) {
          const updated = markAdminPermission(chatId, true);
          if (updated && !updated.adminRestricted) {
            await notifyRecovery(bot, chatId, updated.title, recipients);
          }
        } else if (group.managed === false) {
          markAdminPermission(chatId, true);
        }
        continue;
      }

      const warningSentAt = group.adminWarningSentAt ? Date.parse(group.adminWarningSentAt) : null;
      const shouldWarn = !warningSentAt || now - warningSentAt >= ADMIN_WARNING_COOLDOWN_MS;

      if (shouldWarn || !group.adminRestricted) {
        const updated = markAdminPermission(chatId, false, { warningDate: new Date(now) });
        await notifyAdminLoss(bot, chatId, updated?.title ?? chatId, recipients);
      }
    } catch (error) {
      logger.warn("admin monitor failed to check permissions", { chatId, error });
    }
  }
}

async function notifyAdminLoss(
  bot: Telegraf,
  chatId: string,
  title: string,
  recipients: string[],
): Promise<void> {
  const safeTitle = escapeHtml(title);
  const groupMessage = [
    `Firewall Bot lost administrator permissions in ${safeTitle}.`,
    "Please restore administrator access so the panel can keep working.",
  ].join("\n");

  await sendSafe(bot, chatId, groupMessage);

  if (recipients.length === 0) {
    return;
  }

  const dmMessage = [
    `Firewall Bot lost admin permission in ${safeTitle}.`,
    "Automations may stop until administrator access is restored.",
    "Please promote the bot again from /panel.",
  ].join("\n");

  await notifyRecipients(bot, recipients, dmMessage);
}

async function notifyRecovery(bot: Telegraf, chatId: string, title: string, recipients: string[]): Promise<void> {
  const safeTitle = escapeHtml(title);
  const message = [
    `Firewall Bot admin access was restored in ${safeTitle}.`,
    "Automations are active again; you can review settings from /panel.",
  ].join("\n");

  if (recipients.length > 0) {
    await notifyRecipients(bot, recipients, message);
  }

  await sendSafe(bot, chatId, message);
}
