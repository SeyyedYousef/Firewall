
// ========== ANTI-TABCHI HANDLERS ==========

async function showAntiTabchiSettings(ctx: Context, chatId: string): Promise<void> {
    let banSettings;
    try {
        banSettings = await loadBanSettingsByChatId(chatId);
    } catch {
        banSettings = null;
    }

    const rawBan = banSettings as unknown as Record<string, unknown> | null;
    const antiTabchi = (rawBan?.antiTabchi as Record<string, unknown>) ?? {};

    // Default values
    const tabchiLock = antiTabchi.tabchiLock !== false; // Default true if undefined (as requested "Lock: Tabchi" checkmark)
    const adLock = antiTabchi.adLock !== false;
    const bioLock = antiTabchi.bioLock !== false;
    const actionMode = (antiTabchi.actionMode as string) ?? "mute"; // silence = mute
    const actionTime = (antiTabchi.actionTime as string) ?? "entry"; // entry = immediately
    const detectionSeconds = (antiTabchi.detectionMessageSeconds as number) ?? 150; // 2 min 30 sec = 150 sec

    // Format labels
    const getLockIcon = (enabled: boolean) => (enabled ? "✅" : "❌");
    const actionModeLabel = actionMode === "ban" ? "Ban" : "Silence";
    const actionTimeLabel = actionTime === "entry" ? "Immediately" : "After Message"; // "بمحض ورود" vs "بعد از ارسال پیام"

    const minutes = Math.floor(detectionSeconds / 60);
    const seconds = detectionSeconds % 60;
    const timeLabel = `${minutes}m ${seconds}s`;

    const message = `🛡 <b>Anti-Tabchi Settings</b>

• In this section you can:

* Configure action against Tabchi (Ban or Silence)
* Set action timing (Immediately on entry or after sending message)
* Configure Tabchi detection notification`;

    const rows: any[] = [];

    // Locks row
    rows.push([Markup.button.callback(`• Tabchi Lock: ${getLockIcon(tabchiLock)}`, `fw_adv_at_toggle:${chatId}:tabchiLock`)]);
    rows.push([Markup.button.callback(`• Ad Lock: ${getLockIcon(adLock)}`, `fw_adv_at_toggle:${chatId}:adLock`)]);
    rows.push([Markup.button.callback(`• Bio Link Lock: ${getLockIcon(bioLock)}`, `fw_adv_at_toggle:${chatId}:bioLock`)]);

    // Action Mode
    rows.push([Markup.button.callback(`• Action Mode: ${actionModeLabel}`, `fw_adv_at_mode:${chatId}`)]);

    // Action Time
    rows.push([Markup.button.callback(`• Action Time: ${actionTimeLabel}`, `fw_adv_at_time:${chatId}`)]);

    // Detection Message Time
    rows.push([Markup.button.callback(`• Detection Message: ${timeLabel}`, `fw_adv_at_msg_time_show:${chatId}`)]);
    rows.push([
        Markup.button.callback("《", `fw_adv_at_msg_time:${chatId}:downfast`),
        Markup.button.callback("〈", `fw_adv_at_msg_time:${chatId}:down`),
        Markup.button.callback("〉", `fw_adv_at_msg_time:${chatId}:up`),
        Markup.button.callback("》", `fw_adv_at_msg_time:${chatId}:upfast`),
    ]);

    // Back button
    rows.push([Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]);

    const keyboard = Markup.inlineKeyboard(rows);
    await replyOrEditRoot(ctx, message, keyboard);
}

// Handler for toggles
bot.action(/^fw_adv_at_toggle:(-?\d+):([a-zA-Z]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = (ctx.callbackQuery as any)?.data ?? "";
    const match = data.match(/^fw_adv_at_toggle:(-?\d+):([a-zA-Z]+)$/);
    const chatId = match?.[1];
    const settingKey = match?.[2];

    if (!chatId || !settingKey) return;

    try {
        const settings = await loadBanSettingsByChatId(chatId);
        const rawSettings = settings as unknown as Record<string, unknown>;

        // Ensure antiTabchi struct exists
        if (!rawSettings.antiTabchi) rawSettings.antiTabchi = {};
        const at = rawSettings.antiTabchi as Record<string, unknown>;

        // Toggle
        // If undefined, default was true (for these locks), so toggling makes it false
        // Logic: if value is strictly false, become true. Else (true or undefined), become false.
        const current = at[settingKey] !== false;
        at[settingKey] = !current;

        await saveBanSettingsByChatId(chatId, settings);
    } catch (error) {
        logger.error("Failed to toggle anti-tabchi setting", { chatId, settingKey, error });
    }

    await showAntiTabchiSettings(ctx, chatId);
});

// Handler for Action Mode (Ban/Silence)
bot.action(/^fw_adv_at_mode:(-?\d+)$/, async (ctx) => {
    const data = (ctx.callbackQuery as any)?.data ?? "";
    const match = data.match(/^fw_adv_at_mode:(-?\d+)$/);
    const chatId = match?.[1];
    if (!chatId) return;

    try {
        const settings = await loadBanSettingsByChatId(chatId);
        const rawSettings = settings as unknown as Record<string, unknown>;
        if (!rawSettings.antiTabchi) rawSettings.antiTabchi = {};
        const at = rawSettings.antiTabchi as Record<string, unknown>;

        const current = (at.actionMode as string) ?? "mute";
        const next = current === "mute" ? "ban" : "mute";
        at.actionMode = next;

        await saveBanSettingsByChatId(chatId, settings);
        await ctx.answerCbQuery(`Action set to: ${next === "ban" ? "Ban" : "Silence"}`);
    } catch (error) {
        logger.error("Failed to toggle anti-tabchi mode", { chatId, error });
        await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
    }

    await showAntiTabchiSettings(ctx, chatId);
});

// Handler for Action Time (Entry/Message)
bot.action(/^fw_adv_at_time:(-?\d+)$/, async (ctx) => {
    const data = (ctx.callbackQuery as any)?.data ?? "";
    const match = data.match(/^fw_adv_at_time:(-?\d+)$/);
    const chatId = match?.[1];
    if (!chatId) return;

    try {
        const settings = await loadBanSettingsByChatId(chatId);
        const rawSettings = settings as unknown as Record<string, unknown>;
        if (!rawSettings.antiTabchi) rawSettings.antiTabchi = {};
        const at = rawSettings.antiTabchi as Record<string, unknown>;

        const current = (at.actionTime as string) ?? "entry";
        const next = current === "entry" ? "message" : "entry";
        at.actionTime = next;

        await saveBanSettingsByChatId(chatId, settings);
        await ctx.answerCbQuery(`Time set to: ${next === "entry" ? "Immediately" : "After Message"}`);
    } catch (error) {
        logger.error("Failed to toggle anti-tabchi time", { chatId, error });
        await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
    }

    await showAntiTabchiSettings(ctx, chatId);
});

// Handler for Detection Message Timer
bot.action(/^fw_adv_at_msg_time:(-?\d+):(up|down|upfast|downfast)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = (ctx.callbackQuery as any)?.data ?? "";
    const match = data.match(/^fw_adv_at_msg_time:(-?\d+):(up|down|upfast|downfast)$/);
    const chatId = match?.[1];
    const direction = match?.[2];
    if (!chatId || !direction) return;

    try {
        const settings = await loadBanSettingsByChatId(chatId);
        const rawSettings = settings as unknown as Record<string, unknown>;
        if (!rawSettings.antiTabchi) rawSettings.antiTabchi = {};
        const at = rawSettings.antiTabchi as Record<string, unknown>;

        let current = (at.detectionMessageSeconds as number) ?? 150;

        const adjustments: Record<string, number> = {
            up: 5,
            down: -5,
            upfast: 30,
            downfast: -30,
        };

        current += adjustments[direction] ?? 0;
        current = Math.max(0, Math.min(3600, current)); // 0 to 60 mins
        at.detectionMessageSeconds = current;

        await saveBanSettingsByChatId(chatId, settings);
    } catch (error) {
        logger.error("Failed to adjust detection timer", { chatId, error });
    }

    await showAntiTabchiSettings(ctx, chatId);
});
