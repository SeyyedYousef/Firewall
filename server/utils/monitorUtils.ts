/**
 * Common utilities for job monitors
 * Extracted from adminMonitor, inactivityMonitor, and trialMonitor to reduce duplication
 */

import type { Telegraf } from "telegraf";
import { logger } from "./logger.js";

/**
 * Escape HTML special characters for Telegram HTML parse mode
 */
export function escapeHtml(input: string): string {
    return input.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            case "'":
                return "&#39;";
            default:
                return char;
        }
    });
}

/**
 * Escape HTML for use in attributes (additional quote escaping)
 */
export function escapeAttribute(value: string): string {
    return escapeHtml(value).replace(/"/g, "&quot;");
}

export type MonitorRecipientOptions = {
    ownerId?: string | null;
    getPanelAdmins?: () => string[];
};

/**
 * Collect notification recipients from owner and panel admins
 */
export function collectRecipients(options: MonitorRecipientOptions): string[] {
    const ids = new Set<string>();
    if (options.ownerId) {
        ids.add(options.ownerId);
    }
    try {
        const admins = options.getPanelAdmins?.();
        if (admins) {
            admins.map(String).forEach((id) => {
                if (id.trim().length > 0) {
                    ids.add(id.trim());
                }
            });
        }
    } catch (error) {
        logger.warn("failed to load panel admins for notifications", { error });
    }
    return Array.from(ids);
}

/**
 * Send a message safely, catching and logging errors
 */
export async function sendSafe(
    bot: Telegraf,
    chatId: string,
    text: string,
    options: { disableWebPagePreview?: boolean } = {}
): Promise<void> {
    try {
        await bot.telegram.sendMessage(chatId, text, {
            parse_mode: "HTML",
            disable_web_page_preview: options.disableWebPagePreview ?? true,
        } as any);
    } catch (error) {
        logger.warn("failed to send notification message", { chatId, error });
    }
}

/**
 * Send message to multiple recipients
 */
export async function notifyRecipients(
    bot: Telegraf,
    recipients: string[],
    message: string
): Promise<void> {
    for (const recipient of recipients) {
        await sendSafe(bot, recipient, message);
    }
}
