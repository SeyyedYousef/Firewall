import type { Telegraf } from "telegraf";
import { getState, markTrialReminderSent, markTrialExpired } from "../state.js";
import { logger } from "../../server/utils/logger.js";
import { escapeHtml, escapeAttribute, collectRecipients, sendSafe, notifyRecipients, type MonitorRecipientOptions } from "../../server/utils/monitorUtils.js";

const DAY_MS = 86_400_000;
const WARNING_DAYS = Number.parseInt(process.env.TRIAL_REMINDER_DAYS ?? "3", 10);
const MONITOR_INTERVAL_MS = Number.parseInt(process.env.TRIAL_MONITOR_INTERVAL_MS ?? "900000", 10);

let monitorTimer: NodeJS.Timeout | null = null;

export type TrialMonitorOptions = MonitorRecipientOptions;

export function startTrialMonitor(bot: Telegraf, options: TrialMonitorOptions = {}): void {
  if (monitorTimer) {
    return;
  }

  if (Number.isNaN(MONITOR_INTERVAL_MS) || MONITOR_INTERVAL_MS <= 0) {
    logger.warn("trial monitor disabled due to invalid interval", {
      interval: process.env.TRIAL_MONITOR_INTERVAL_MS,
    });
    return;
  }

  const run = async () => {
    try {
      await evaluateTrials(bot, options);
    } catch (error) {
      logger.error("trial monitor run failed", { error });
    }
  };

  void run();
  monitorTimer = setInterval(run, MONITOR_INTERVAL_MS);
  logger.info("trial monitor started", { intervalMs: MONITOR_INTERVAL_MS });
}

async function evaluateTrials(bot: Telegraf, options: TrialMonitorOptions): Promise<void> {
  const state = getState();
  const now = Date.now();
  const miniAppUrl = process.env.MINI_APP_URL;
  const reminderDays = Math.max(1, WARNING_DAYS);
  const recipients = collectRecipients(options);

  for (const record of Object.values(state.stars.groups)) {
    if (!record.gifted) {
      continue;
    }

    const expiresAtMs = Date.parse(record.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      continue;
    }

    const groupRecord = state.groups[record.groupId];
    if (!groupRecord) {
      continue;
    }

    if (record.disabled && groupRecord.managed === false) {
      continue;
    }

    const msRemaining = expiresAtMs - now;

    if (msRemaining <= 0) {
      if (!record.disabled) {
        const updatedGroup = markTrialExpired(record.groupId, new Date(now));
        await sendExpirationNotice(bot, record.groupId, updatedGroup?.title ?? record.groupId, miniAppUrl, recipients);
      }
      continue;
    }

    const daysRemaining = Math.ceil(msRemaining / DAY_MS);
    if (daysRemaining <= reminderDays && !record.trialReminderSentAt) {
      markTrialReminderSent(record.groupId, new Date(now));
      await sendReminderNotice(bot, record.groupId, groupRecord.title, daysRemaining, miniAppUrl, recipients);
    }
  }
}

async function sendReminderNotice(
  bot: Telegraf,
  chatId: string,
  title: string,
  daysRemaining: number,
  miniAppUrl: string | undefined,
  recipients: string[],
): Promise<void> {
  const safeTitle = escapeHtml(title);
  const safeLink = miniAppUrl ? escapeAttribute(miniAppUrl) : undefined;
  const messageLines = [
    `Firewall trial for ${safeTitle} expires in ${daysRemaining} day(s).`,
    safeLink
      ? `Renew via <a href="${safeLink}">this link</a> or use /panel.`
      : "Renew via /panel.",
  ];

  await sendSafe(bot, chatId, messageLines.join("\n"));

  if (recipients.length > 0) {
    const dmMessage = [
      `Reminder: Firewall trial for ${safeTitle} expires in ${daysRemaining} day(s).`,
      "Please renew to avoid interruption.",
    ].join("\n");
    await notifyRecipients(bot, recipients, dmMessage);
  }
}

async function sendExpirationNotice(
  bot: Telegraf,
  chatId: string,
  title: string,
  miniAppUrl: string | undefined,
  recipients: string[],
): Promise<void> {
  const safeTitle = escapeHtml(title);
  const safeLink = miniAppUrl ? escapeAttribute(miniAppUrl) : undefined;
  const lines = [
    `Firewall trial for ${safeTitle} has ended and the group access is disabled.`,
    safeLink
      ? `Renew via <a href="${safeLink}">this link</a> or use /panel.`
      : "Renew via /panel.",
  ];

  await sendSafe(bot, chatId, lines.join("\n"));

  if (recipients.length > 0) {
    const dmMessage = [
      `Firewall trial for ${safeTitle} has ended and access was disabled.`,
      "Renew if you need continued service.",
    ].join("\n");
    await notifyRecipients(bot, recipients, dmMessage);
  }
}
