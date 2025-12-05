/**
 * Debug script to check banSettings in database
 * Run with: npx tsx scripts/debug-ban-settings.ts
 */

import 'dotenv/config';
import { prisma } from '../server/db/client.js';
import { loadBanSettingsByChatId } from '../server/db/groupSettingsRepository.js';

async function debugBanSettings() {
    console.log("=== Debug Ban Settings ===\n");

    // Get all groups
    const groups = await prisma.group.findMany({
        select: {
            id: true,
            title: true,
            telegramChatId: true,
            banSettings: true,
        },
    });

    console.log(`Found ${groups.length} groups in database\n`);

    for (const group of groups) {
        console.log(`\n--- Group: ${group.title} ---`);
        console.log(`  ID: ${group.id}`);
        console.log(`  Chat ID: ${group.telegramChatId}`);
        console.log(`  banSettings (raw from DB):`);
        console.log(JSON.stringify(group.banSettings, null, 2));

        // Now load via the function
        try {
            const loadedSettings = await loadBanSettingsByChatId(group.telegramChatId);
            console.log(`\n  banSettings (via loadBanSettingsByChatId):`);
            console.log(JSON.stringify(loadedSettings, null, 2));

            // Check for vipMembers specifically
            const raw = loadedSettings as unknown as Record<string, unknown>;
            console.log(`\n  vipMembers: ${JSON.stringify(raw.vipMembers)}`);
            console.log(`  exemptUsers: ${JSON.stringify(raw.exemptUsers)}`);
            console.log(`  forwardWhitelist: ${JSON.stringify(raw.forwardWhitelist)}`);
        } catch (error) {
            console.log(`  ERROR loading via function: ${error}`);
        }
    }

    await prisma.$disconnect();
}

debugBanSettings().catch(console.error);
