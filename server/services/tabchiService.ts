/**
 * Tabchi (Spam Bot) Detection Service
 * 
 * Provides cross-group spam bot detection, tracking, and management.
 * Uses confidence scoring to prevent false positives.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { logger } from "../utils/logger.js";

// Confidence threshold - users below this are NOT restricted on join
const CONFIDENCE_THRESHOLD = 70;

// Detection types
export type TabchiDetectionType =
    | "cross_group"      // Violations in 3+ groups
    | "single_group"     // Multiple violations in one group
    | "bot_adder"        // Added malicious bots
    | "message_pattern"; // Spam message patterns

export type TabchiRecord = {
    id: string;
    telegramUserId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    detectionType: TabchiDetectionType;
    confidence: number;
    groupsAffected: number;
    detectedAt: Date;
    lastSeenAt: Date;
    removedAt: Date | null;
    removedBy: string | null;
    metadata: Record<string, unknown> | null;
};

export type TabchiCheckResult = {
    isTabchi: boolean;
    confidence: number;
    detectionType: TabchiDetectionType | null;
    reason: string | null;
};

/**
 * Check if a user is a known tabchi with confidence above threshold
 */
export async function isKnownTabchi(telegramUserId: string): Promise<TabchiCheckResult> {
    try {
        const record = await prisma.tabchiRecord.findUnique({
            where: { telegramUserId },
        });

        if (!record || record.removedAt) {
            return {
                isTabchi: false,
                confidence: 0,
                detectionType: null,
                reason: null,
            };
        }

        return {
            isTabchi: record.confidence >= CONFIDENCE_THRESHOLD,
            confidence: record.confidence,
            detectionType: record.detectionType as TabchiDetectionType,
            reason: record.confidence >= CONFIDENCE_THRESHOLD
                ? `Known tabchi (${record.detectionType}, confidence: ${record.confidence}%)`
                : null,
        };
    } catch (error) {
        logger.error("failed to check tabchi status", { telegramUserId, error });
        return {
            isTabchi: false,
            confidence: 0,
            detectionType: null,
            reason: null,
        };
    }
}

/**
 * Check if user is whitelisted (should never be flagged)
 */
export async function isWhitelisted(telegramUserId: string, groupId?: string): Promise<boolean> {
    try {
        const whitelist = await prisma.tabchiWhitelist.findUnique({
            where: { telegramUserId },
        });

        if (!whitelist) return false;

        // If no groupId specified on whitelist, it's global
        if (!whitelist.groupId) return true;

        // If groupId specified, check if it matches
        return !groupId || whitelist.groupId === groupId;
    } catch (error) {
        logger.error("failed to check whitelist", { telegramUserId, error });
        return false;
    }
}

/**
 * Add user to tabchi database
 */
export async function recordTabchi(input: {
    telegramUserId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    detectionType: TabchiDetectionType;
    confidence: number;
    groupsAffected?: number;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    try {
        await prisma.tabchiRecord.upsert({
            where: { telegramUserId: input.telegramUserId },
            create: {
                telegramUserId: input.telegramUserId,
                username: input.username ?? null,
                firstName: input.firstName ?? null,
                lastName: input.lastName ?? null,
                detectionType: input.detectionType,
                confidence: Math.min(100, Math.max(0, input.confidence)),
                groupsAffected: input.groupsAffected ?? 1,
                metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
            },
            update: {
                username: input.username ?? undefined,
                firstName: input.firstName ?? undefined,
                lastName: input.lastName ?? undefined,
                detectionType: input.detectionType,
                confidence: Math.min(100, Math.max(0, input.confidence)),
                groupsAffected: { increment: 1 },
                lastSeenAt: new Date(),
                metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
                // Clear removal if re-detected
                removedAt: null,
                removedBy: null,
            },
        });

        logger.info("tabchi recorded", {
            telegramUserId: input.telegramUserId,
            detectionType: input.detectionType,
            confidence: input.confidence,
        });
    } catch (error) {
        logger.error("failed to record tabchi", { input, error });
    }
}

/**
 * Remove user from tabchi list
 */
export async function removeFromTabchiList(
    telegramUserId: string,
    removedBy: string
): Promise<boolean> {
    try {
        const existing = await prisma.tabchiRecord.findUnique({
            where: { telegramUserId },
        });

        if (!existing) {
            return false;
        }

        await prisma.tabchiRecord.update({
            where: { telegramUserId },
            data: {
                removedAt: new Date(),
                removedBy,
            },
        });

        logger.info("tabchi removed from list", { telegramUserId, removedBy });
        return true;
    } catch (error) {
        logger.error("failed to remove tabchi", { telegramUserId, error });
        return false;
    }
}

/**
 * Add user to whitelist (never flagged as tabchi)
 */
export async function addToWhitelist(input: {
    telegramUserId: string;
    addedBy: string;
    groupId?: string;
    reason?: string;
}): Promise<void> {
    try {
        await prisma.tabchiWhitelist.upsert({
            where: { telegramUserId: input.telegramUserId },
            create: {
                telegramUserId: input.telegramUserId,
                addedBy: input.addedBy,
                groupId: input.groupId ?? null,
                reason: input.reason ?? null,
            },
            update: {
                addedBy: input.addedBy,
                groupId: input.groupId ?? null,
                reason: input.reason ?? null,
                addedAt: new Date(),
            },
        });

        // Also remove from tabchi list if exists
        await prisma.tabchiRecord.updateMany({
            where: { telegramUserId: input.telegramUserId },
            data: {
                removedAt: new Date(),
                removedBy: input.addedBy,
            },
        });

        logger.info("user added to whitelist", {
            telegramUserId: input.telegramUserId,
            addedBy: input.addedBy,
        });
    } catch (error) {
        logger.error("failed to add to whitelist", { input, error });
    }
}

/**
 * Remove user from whitelist
 */
export async function removeFromWhitelist(telegramUserId: string): Promise<boolean> {
    try {
        const result = await prisma.tabchiWhitelist.deleteMany({
            where: { telegramUserId },
        });
        return result.count > 0;
    } catch (error) {
        logger.error("failed to remove from whitelist", { telegramUserId, error });
        return false;
    }
}

/**
 * Get tabchi info for a user
 */
export async function getTabchiInfo(telegramUserId: string): Promise<TabchiRecord | null> {
    try {
        const record = await prisma.tabchiRecord.findUnique({
            where: { telegramUserId },
        });

        if (!record) return null;

        return {
            id: record.id,
            telegramUserId: record.telegramUserId,
            username: record.username,
            firstName: record.firstName,
            lastName: record.lastName,
            detectionType: record.detectionType as TabchiDetectionType,
            confidence: record.confidence,
            groupsAffected: record.groupsAffected,
            detectedAt: record.detectedAt,
            lastSeenAt: record.lastSeenAt,
            removedAt: record.removedAt,
            removedBy: record.removedBy,
            metadata: record.metadata as Record<string, unknown> | null,
        };
    } catch (error) {
        logger.error("failed to get tabchi info", { telegramUserId, error });
        return null;
    }
}

/**
 * Check cross-group violation patterns
 * Returns the number of unique groups where user has violations
 */
export async function checkCrossGroupViolations(telegramUserId: string): Promise<number> {
    try {
        // Count unique groups where user has moderation actions (message deletions)
        const result = await prisma.moderationAction.groupBy({
            by: ['groupId'],
            where: {
                userId: telegramUserId,
                action: { in: ['delete_message', 'warn', 'mute', 'restrict'] },
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
            },
        });

        return result.length;
    } catch (error) {
        logger.error("failed to check cross-group violations", { telegramUserId, error });
        return 0;
    }
}

/**
 * Analyze user and potentially flag as tabchi based on cross-group behavior
 */
export async function analyzeAndFlagIfTabchi(
    telegramUserId: string,
    username?: string,
    firstName?: string
): Promise<boolean> {
    // Check whitelist first
    if (await isWhitelisted(telegramUserId)) {
        return false;
    }

    // Check cross-group violations
    const groupCount = await checkCrossGroupViolations(telegramUserId);

    if (groupCount >= 3) {
        // Calculate confidence: 50 base + 10 per group (max 90)
        const confidence = Math.min(90, 50 + (groupCount * 10));

        await recordTabchi({
            telegramUserId,
            username,
            firstName,
            detectionType: "cross_group",
            confidence,
            groupsAffected: groupCount,
            metadata: {
                analyzedAt: new Date().toISOString(),
                groupCount,
            },
        });

        return true;
    }

    return false;
}

/**
 * Get tabchi statistics
 */
export async function getTabchiStats(): Promise<{
    total: number;
    active: number;
    removed: number;
    byType: Record<string, number>;
}> {
    try {
        const [total, active, byTypeRaw] = await Promise.all([
            prisma.tabchiRecord.count(),
            prisma.tabchiRecord.count({ where: { removedAt: null } }),
            prisma.tabchiRecord.groupBy({
                by: ['detectionType'],
                _count: true,
                where: { removedAt: null },
            }),
        ]);

        const byType: Record<string, number> = {};
        byTypeRaw.forEach((item: { detectionType: string; _count: number }) => {
            byType[item.detectionType] = item._count;
        });

        return {
            total,
            active,
            removed: total - active,
            byType,
        };
    } catch (error) {
        logger.error("failed to get tabchi stats", { error });
        return { total: 0, active: 0, removed: 0, byType: {} };
    }
}
