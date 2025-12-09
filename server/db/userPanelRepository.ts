/**
 * User Panel Settings Repository
 * 
 * Handles per-user lock overrides and settings within a group.
 */

import { prisma, databaseAvailable } from "./client.js";
import { logger } from "../utils/logger.js";

export type UserLockOverrideState = 'default' | 'open' | 'locked';

export type UserLockOverrides = Record<string, UserLockOverrideState>;

export type UserPanelSettingsRecord = {
    groupId: string;
    telegramUserId: string;
    nickname: string | null;
    lockOverrides: UserLockOverrides;
};

const DEFAULT_SETTINGS: UserPanelSettingsRecord = {
    groupId: "",
    telegramUserId: "",
    nickname: null,
    lockOverrides: {},
};

/**
 * Get user panel settings for a specific user in a group
 */
export async function getUserPanelSettings(
    chatId: string,
    telegramUserId: string
): Promise<UserPanelSettingsRecord> {
    if (!databaseAvailable) {
        return { ...DEFAULT_SETTINGS, groupId: chatId, telegramUserId };
    }

    try {
        const group = await prisma.group.findUnique({
            where: { telegramChatId: chatId },
            select: { id: true },
        });

        if (!group) {
            return { ...DEFAULT_SETTINGS, groupId: chatId, telegramUserId };
        }

        const settings = await prisma.userPanelSettings.findUnique({
            where: {
                groupId_telegramUserId: {
                    groupId: group.id,
                    telegramUserId,
                },
            },
        });

        if (!settings) {
            return { ...DEFAULT_SETTINGS, groupId: chatId, telegramUserId };
        }

        return {
            groupId: chatId,
            telegramUserId,
            nickname: settings.nickname,
            lockOverrides: (settings.lockOverrides as UserLockOverrides) ?? {},
        };
    } catch (error) {
        logger.error("Failed to load user panel settings", { chatId, telegramUserId, error });
        return { ...DEFAULT_SETTINGS, groupId: chatId, telegramUserId };
    }
}

/**
 * Save user panel settings for a specific user in a group
 */
export async function saveUserPanelSettings(
    chatId: string,
    telegramUserId: string,
    settings: Partial<UserPanelSettingsRecord>
): Promise<void> {
    if (!databaseAvailable) {
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { telegramChatId: chatId },
            select: { id: true },
        });

        if (!group) {
            logger.warn("Cannot save user panel settings - group not found", { chatId });
            return;
        }

        await prisma.userPanelSettings.upsert({
            where: {
                groupId_telegramUserId: {
                    groupId: group.id,
                    telegramUserId,
                },
            },
            create: {
                groupId: group.id,
                telegramUserId,
                nickname: settings.nickname ?? null,
                lockOverrides: settings.lockOverrides ?? {},
            },
            update: {
                nickname: settings.nickname,
                lockOverrides: settings.lockOverrides ?? {},
                updatedAt: new Date(),
            },
        });
    } catch (error) {
        logger.error("Failed to save user panel settings", { chatId, telegramUserId, error });
        throw error;
    }
}

/**
 * Get a specific lock override for a user
 */
export async function getUserLockOverride(
    chatId: string,
    telegramUserId: string,
    lockKey: string
): Promise<UserLockOverrideState> {
    const settings = await getUserPanelSettings(chatId, telegramUserId);
    return settings.lockOverrides[lockKey] ?? 'default';
}

/**
 * Set a specific lock override for a user
 */
export async function setUserLockOverride(
    chatId: string,
    telegramUserId: string,
    lockKey: string,
    state: UserLockOverrideState
): Promise<void> {
    const settings = await getUserPanelSettings(chatId, telegramUserId);

    if (state === 'default') {
        // Remove the override if setting to default
        delete settings.lockOverrides[lockKey];
    } else {
        settings.lockOverrides[lockKey] = state;
    }

    await saveUserPanelSettings(chatId, telegramUserId, {
        lockOverrides: settings.lockOverrides,
    });
}

/**
 * Set user nickname
 */
export async function setUserNickname(
    chatId: string,
    telegramUserId: string,
    nickname: string | null
): Promise<void> {
    const settings = await getUserPanelSettings(chatId, telegramUserId);
    await saveUserPanelSettings(chatId, telegramUserId, {
        ...settings,
        nickname,
    });
}

/**
 * Check if a lock should be applied based on user override and group setting
 * Returns: true = lock applies, false = lock doesn't apply
 */
export async function shouldApplyLockForUser(
    chatId: string,
    telegramUserId: string,
    lockKey: string,
    groupLockEnabled: boolean
): Promise<boolean> {
    const override = await getUserLockOverride(chatId, telegramUserId, lockKey);

    switch (override) {
        case 'locked':
            // User-specific lock - always apply
            return true;
        case 'open':
            // User-specific unlock - never apply
            return false;
        case 'default':
        default:
            // Use group setting
            return groupLockEnabled;
    }
}
