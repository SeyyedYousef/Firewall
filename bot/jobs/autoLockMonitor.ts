
import { Telegraf } from "telegraf";
import { prisma } from "../../server/db/client.js"; // Adjust import path
import { logger } from "../../server/utils/logger.js"; // Adjust import path
import { saveBanSettingsByChatId, GroupBanSettingsRecord, AutoLockSettings } from "../../server/db/groupSettingsRepository.js"; // Adjust import path
import { Context } from "telegraf";

// Helper to parse "HH:MM"
function parseTime(timeStr: string): number {
    const [hh, mm] = timeStr.split(":").map(Number);
    return hh * 60 + mm;
}

export function startAutoLockMonitor(bot: Telegraf<Context>) {
    // Run every minute
    setInterval(async () => {
        try {
            await checkAutoLocks(bot);
        } catch (error) {
            logger.error("AutoLock check failed", { error });
        }
    }, 60 * 1000);

    // Run once immediately on startup
    void checkAutoLocks(bot);
}

async function checkAutoLocks(bot: Telegraf<Context>) {
    // 1. Fetch all groups with autoLock enabled
    // Since autoLock is in a JSON column, we fetch all groups and filter in-memory
    // Note: For large-scale apps, consider adding a dedicated boolean column

    const groups = await prisma.group.findMany({
        where: {
            banSettings: {
                path: ['autoLock', 'enabled'],
                equals: true
            }
        }
    });

    const now = new Date();

    for (const group of groups) {
        const chatId = group.telegramChatId;

        try {
            // Get timezone from generalSettings JSON field on the same Group record
            const timezone = (group.generalSettings as any)?.timezone ?? "UTC"; // Default UTC

            // Adjust 'now' to group's timezone
            // We can use Intl.DateTimeFormat or a library. Native is fine.
            const groupTimeStr = now.toLocaleTimeString("en-GB", { timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit' });
            const groupMinutes = parseTime(groupTimeStr); // Minutes from 00:00 in group's TZ

            const settings = group.banSettings as unknown as GroupBanSettingsRecord;
            if (!settings) continue;
            const al = settings.autoLock;
            if (!al || !al.enabled || !al.startTime || !al.endTime) continue;

            const start = parseTime(al.startTime);
            const end = parseTime(al.endTime);

            let shouldBeLocked = false;
            if (start < end) {
                // Simple range: 09:00 to 17:00
                shouldBeLocked = groupMinutes >= start && groupMinutes < end;
            } else {
                // Cross-midnight: 23:00 to 08:00
                shouldBeLocked = groupMinutes >= start || groupMinutes < end;
            }

            // Check last applied state to avoid spamming API
            // We store a volatile state in autoLock for logic, but persisting it to DB is safer for restarts.
            // Using 'any' cast to access dynamic property if not in type definition yet, 
            // but we should add it to schema or type definition if possible.
            const lastState = (al as any).lastAppliedState as "locked" | "unlocked" | undefined;
            const targetState = shouldBeLocked ? "locked" : "unlocked";

            if (lastState !== targetState) {
                logger.info("AutoLock state change detected", { chatId, timezone, groupTime: groupTimeStr, from: lastState, to: targetState });

                // Apply Change
                if (targetState === "locked") {
                    // Lock Logic: Remove 'can_send_messages'
                    // Note: This matches "Strict Lock" or typical "Silence" behavior.
                    // We set permissions to false.
                    await bot.telegram.setChatPermissions(chatId, {
                        can_send_messages: false,
                        can_send_audios: false,
                        can_send_documents: false,
                        can_send_photos: false,
                        can_send_videos: false,
                        can_send_voice_notes: false,
                        can_send_polls: false,
                        can_send_other_messages: false,
                        can_add_web_page_previews: false,
                        can_change_info: false,
                        can_invite_users: true, // Usually we allow inviting unless strict
                        can_pin_messages: false
                    });

                    await bot.telegram.sendMessage(chatId, "🔒 <b>Group Auto-Locked</b>\n\nThe group has been silenced according to the schedule.", { parse_mode: "HTML" });
                } else {
                    // Unlock Logic: Restore permissions
                    // Default public group permissions usually allow messages.
                    await bot.telegram.setChatPermissions(chatId, {
                        can_send_messages: true,
                        can_send_audios: true,
                        can_send_documents: true,
                        can_send_photos: true,
                        can_send_videos: true,
                        can_send_voice_notes: true,
                        can_send_polls: true,
                        can_send_other_messages: true,
                        can_add_web_page_previews: true,
                        can_invite_users: true,
                        can_change_info: false,
                        can_pin_messages: false
                    });

                    await bot.telegram.sendMessage(chatId, "🔓 <b>Group Auto-Unlocked</b>\n\nThe group silence has been lifted.", { parse_mode: "HTML" });
                }

                // Update DB state
                (al as any).lastAppliedState = targetState;
                await saveBanSettingsByChatId(chatId, settings);
            }

        } catch (error) {
            logger.error("Error processing auto lock for group", { chatId, error });
        }
    }
}
