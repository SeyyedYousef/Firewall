import { prisma } from "./client.js";
import { logger } from "../utils/logger.js";
import { withPrismaRetry } from "./utils/prismaRetry.js";
import type { PromoSlideRecord } from "../../shared/promo.js";

type JsonRecord = Record<string, unknown>;

export async function fetchPanelSettingsFromDb() {
  const record = await withPrismaRetry(
    () =>
      prisma.botSetting.findUnique({
        where: { key: "panel_settings" },
      }),
    "fetchPanelSettingsFromDb",
  );
  if (!record) {
    return null;
  }
  if (record.value && typeof record.value === "object") {
    return record.value as Record<string, unknown>;
  }
  return null;
}

export async function fetchPanelAdminsFromDb(): Promise<string[]> {
  const users = await withPrismaRetry(
    () =>
      prisma.user.findMany({
        where: {
          role: {
            in: ["owner", "admin", "panel_admin"],
          },
        },
        select: {
          telegramId: true,
        },
      }),
    "fetchPanelAdminsFromDb",
  );
  return users.map((user) => user.telegramId);
}

async function findGroupIdByChatId(chatId: string): Promise<string | null> {
  const normalized = chatId.trim();
  if (!normalized) {
    return null;
  }
  const group = await withPrismaRetry(
    () =>
      prisma.group.findUnique({
        where: { telegramChatId: normalized },
        select: { id: true },
      }),
    "stateRepository:findGroupIdByChatId",
  );
  return group?.id ?? null;
}

export async function fetchGroupsFromDb() {
  const groups = await withPrismaRetry(
    () =>
      prisma.group.findMany({
        orderBy: {
          createdAt: "asc",
        },
        include: {
          owner: {
            select: {
              telegramId: true,
            },
          },
          managers: {
            select: {
              role: true,
              user: {
                select: {
                  telegramId: true,
                },
              },
            },
          },
        },
      }),
    "fetchGroupsFromDb",
  );

  const groupIds = groups.map((group) => group.id);
  const membershipAggregates =
    groupIds.length > 0
      ? await withPrismaRetry(
          () =>
            prisma.membershipEvent.groupBy({
              by: ["groupId", "event"],
              where: {
                groupId: {
                  in: groupIds,
                },
              },
              _count: {
                _all: true,
              },
            }),
          "fetchGroupsFromDb:membershipAggregates",
        )
      : [];

  const joinCounts = new Map<string, number>();
  const leaveCounts = new Map<string, number>();
  for (const aggregate of membershipAggregates) {
    const total = aggregate._count?._all ?? 0;
    if (aggregate.event === "join") {
      joinCounts.set(aggregate.groupId, total);
    } else if (aggregate.event === "leave") {
      leaveCounts.set(aggregate.groupId, total);
    }
  }

  return groups.map((group) => {
    const ownerId = group.owner?.telegramId ?? null;
    const adminIds = new Set<string>();
    if (ownerId) {
      adminIds.add(ownerId);
    }
    for (const manager of group.managers) {
      if (manager.role?.toLowerCase() === "viewer") {
        continue;
      }
      const telegramId = manager.user?.telegramId ?? null;
      if (telegramId) {
        adminIds.add(telegramId);
      }
    }

    const membersJoined = joinCounts.get(group.id) ?? 0;
    const membersLeft = leaveCounts.get(group.id) ?? 0;
    const membersCount = Math.max(0, membersJoined - membersLeft);
    const status = group.status ?? null;
    const managed = status === "removed" ? false : true;

    return {
      chatId: group.telegramChatId,
      title: group.title,
      creditBalance: Number(group.creditBalance ?? 0),
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      lastAdjustmentNote: null,
      membersCount,
      inviteLink: group.inviteLink,
      photoUrl: null,
      managed,
      adminRestricted: status === "removed",
      adminWarningSentAt: status === "removed" ? group.updatedAt.toISOString() : null,
      ownerId,
      adminIds: Array.from(adminIds),
      status,
      statusUpdatedAt: group.updatedAt.toISOString(),
      dbId: group.id,
    };
  });
}

export async function fetchStarsWalletsFromDb() {
  const wallets = await withPrismaRetry(
    () =>
      prisma.starsWallet.findMany({
        include: {
          group: true,
          owner: true,
        },
      }),
    "fetchStarsWalletsFromDb",
  );

  return wallets.map((wallet) => ({
    id: wallet.id,
    balance: wallet.balance,
    currency: wallet.currency,
    group:
      wallet.group && wallet.group.telegramChatId
        ? {
            chatId: wallet.group.telegramChatId,
            title: wallet.group.title,
          }
        : null,
    owner:
      wallet.owner && wallet.owner.telegramId
        ? {
            telegramId: wallet.owner.telegramId,
            displayName: wallet.owner.displayName ?? null,
          }
        : null,
  }));
}

export async function fetchOwnerWalletBalance(ownerTelegramId: string): Promise<number | null> {
  const owner = await withPrismaRetry(
    () =>
      prisma.user.findUnique({
        where: { telegramId: ownerTelegramId },
        include: {
          wallet: true,
        },
      }),
    "fetchOwnerWalletBalance",
  );

  return owner?.wallet?.balance ?? null;
}

function extractString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function extractBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

export type LatestStarsStatusRecord = {
  expiresAt: string | null;
  gifted: boolean;
};

export async function fetchLatestStarsStatusForGroups(
  groupIds: string[],
): Promise<Map<string, LatestStarsStatusRecord>> {
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return new Map();
  }

  const transactions = await withPrismaRetry(
    () =>
      prisma.starTransaction.findMany({
        where: {
          groupId: {
            in: groupIds,
          },
          status: {
            in: ["completed", "refunded"],
          },
        },
        orderBy: [
          { groupId: "asc" },
          { completedAt: "desc" },
          { createdAt: "desc" },
        ],
        select: {
          groupId: true,
          status: true,
          metadata: true,
          completedAt: true,
          createdAt: true,
        },
      }),
    "fetchLatestStarsStatusForGroups",
  );

  const result = new Map<string, LatestStarsStatusRecord>();

  for (const tx of transactions) {
    if (result.has(tx.groupId) || tx.status !== "completed") {
      continue;
    }

    const metadata =
      tx.metadata && typeof tx.metadata === "object" && !Array.isArray(tx.metadata)
        ? (tx.metadata as JsonRecord)
        : {};

    const expiresCandidate =
      extractString(metadata.expiresAt) ??
      extractString(metadata.expires_at) ??
      (metadata.plan && typeof metadata.plan === "object"
        ? extractString((metadata.plan as JsonRecord).expiresAt)
        : null);

    const expiresAt = expiresCandidate
      ? new Date(expiresCandidate).toISOString()
      : tx.completedAt?.toISOString() ?? tx.createdAt?.toISOString() ?? null;

    const gifted = extractBoolean(metadata.gifted) ?? false;

    result.set(tx.groupId, {
      expiresAt,
      gifted,
    });
  }

  return result;
}

export async function fetchOwnerWalletDetails(ownerTelegramId: string, limit = 50) {
  const owner = await withPrismaRetry(
    () =>
      prisma.user.findUnique({
        where: { telegramId: ownerTelegramId },
        include: {
          wallet: {
            include: {
              transactions: {
                orderBy: {
                  createdAt: "desc",
                },
                take: limit,
                include: {
                  group: {
                    select: {
                      telegramChatId: true,
                      title: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    "fetchOwnerWalletDetails",
  );

  if (!owner || !owner.wallet) {
    return null;
  }

  const wallet = owner.wallet;
  return {
    id: wallet.id,
    balance: wallet.balance,
    currency: wallet.currency,
    transactions: wallet.transactions.map((transaction) => ({
      id: transaction.id,
      amount: transaction.amount,
      status: transaction.status,
      type: transaction.type,
      planId:
        transaction.metadata && typeof transaction.metadata === "object" && "planId" in transaction.metadata
          ? (transaction.metadata as Record<string, unknown>).planId ?? null
          : null,
      gifted:
        transaction.metadata && typeof transaction.metadata === "object" && "gifted" in transaction.metadata
          ? Boolean((transaction.metadata as Record<string, unknown>).gifted)
          : false,
      planLabel:
        transaction.metadata && typeof transaction.metadata === "object" && "planLabel" in transaction.metadata
          ? ((transaction.metadata as Record<string, unknown>).planLabel as string | null)
          : null,
      planDays:
        transaction.metadata && typeof transaction.metadata === "object" && "planDays" in transaction.metadata
          ? Number((transaction.metadata as Record<string, unknown>).planDays ?? 0)
          : null,
      planPrice:
        transaction.metadata && typeof transaction.metadata === "object" && "planPrice" in transaction.metadata
          ? Number((transaction.metadata as Record<string, unknown>).planPrice ?? 0)
          : null,
      groupTitle:
        transaction.metadata && typeof transaction.metadata === "object" && "groupTitle" in transaction.metadata
          ? ((transaction.metadata as Record<string, unknown>).groupTitle as string | null)
          : transaction.group?.title ?? null,
      groupId: transaction.group?.telegramChatId ?? null,
      createdAt: transaction.createdAt.toISOString(),
      completedAt: transaction.completedAt ? transaction.completedAt.toISOString() : null,
      externalId: transaction.externalId ?? null,
      invoiceLink:
        transaction.metadata && typeof transaction.metadata === "object" && "invoiceLink" in transaction.metadata
          ? ((transaction.metadata as Record<string, unknown>).invoiceLink as string | null)
          : null,
    })),
  };
}

const SLIDE_ANALYTICS_LOOKBACK_DAYS = 30;

export async function fetchPromoSlidesFromDb(): Promise<PromoSlideRecord[]> {
  logger.debug("loading promo slides from database");
  const now = new Date();
  const lookbackCutoff = new Date(now.getTime() - SLIDE_ANALYTICS_LOOKBACK_DAYS * 86_400_000);

  const slides = await withPrismaRetry(
    () =>
      prisma.promoSlide.findMany({
        orderBy: [
          { position: "asc" },
          { createdAt: "asc" },
        ],
        include: {
          analyticsBuckets: {
            where: {
              bucket: {
                gte: lookbackCutoff,
              },
            },
          },
        },
      }),
    "fetchPromoSlidesFromDb",
  );

  return slides.map((slide) => {
    const analyticsTotals = slide.analyticsBuckets.reduce(
      (acc, bucket) => {
        acc.impressions += bucket.impressions ?? 0;
        acc.clicks += bucket.clicks ?? 0;
        acc.totalViewDurationMs += Number(bucket.totalViewDurationMs ?? BigInt(0));
        acc.bounces += bucket.bounces ?? 0;
        return acc;
      },
      {
        impressions: 0,
        clicks: 0,
        totalViewDurationMs: 0,
        bounces: 0,
      },
    );

    const ctr = analyticsTotals.impressions > 0 ? analyticsTotals.clicks / analyticsTotals.impressions : 0;
    const avgTime =
      analyticsTotals.impressions > 0 ? analyticsTotals.totalViewDurationMs / analyticsTotals.impressions : 0;
    const bounceRate =
      analyticsTotals.impressions > 0 ? analyticsTotals.bounces / analyticsTotals.impressions : 0;

    return {
      id: slide.id,
      title: slide.title,
      subtitle: slide.subtitle,
      description: slide.description,
      imageUrl: slide.imageUrl,
      thumbnailUrl: slide.thumbnailUrl,
      thumbnailStorageKey: slide.thumbnailStorageKey ?? null,
      storageKey: slide.storageKey,
      originalFileId: slide.originalFileId,
      contentType: slide.contentType,
      fileSize: slide.fileSize,
      width: slide.width,
      height: slide.height,
      checksum: slide.checksum,
      linkUrl: slide.linkUrl,
      position: slide.position,
      accentColor: slide.accentColor,
      ctaLabel: slide.ctaLabel,
      ctaLink: slide.ctaLink,
      active: slide.active,
      startsAt: slide.startsAt ? slide.startsAt.toISOString() : null,
      endsAt: slide.endsAt ? slide.endsAt.toISOString() : null,
      abTestGroupId: slide.abTestGroupId,
      variant: slide.variant,
      views: slide.views,
      clicks: slide.clicks,
      totalViewDurationMs: Number(slide.totalViewDurationMs ?? BigInt(0)),
      bounces: slide.bounces,
      metadata: (slide.metadata as Record<string, unknown>) ?? {},
      createdBy: slide.createdBy,
      createdAt: slide.createdAt.toISOString(),
      updatedAt: slide.updatedAt.toISOString(),
      analytics: {
        impressions: analyticsTotals.impressions,
        clicks: analyticsTotals.clicks,
        ctr: Number(ctr.toFixed(4)),
        avgTimeSpent: Number((avgTime / 1000).toFixed(2)),
        bounceRate: Number(bounceRate.toFixed(4)),
      },
    };
  });
}

export async function fetchPanelBansFromDb(): Promise<string[]> {
  const bans = await withPrismaRetry(
    () =>
      prisma.panelBan.findMany({
        orderBy: {
          createdAt: "asc",
        },
      }),
    "fetchPanelBansFromDb",
  );
  return bans.map((ban) => ban.telegramId);
}

export async function listModerationActionsFromDb(
  chatId: string,
  limit = 100,
  options?: { before?: Date | string },
) {
  const group = await withPrismaRetry(
    () =>
      prisma.group.findUnique({
        where: { telegramChatId: chatId },
        select: { id: true },
      }),
    "listModerationActionsFromDb:group",
  );
  if (!group) {
    return [];
  }

  const whereClause: any = { groupId: group.id };
  if (options?.before) {
    const beforeDate = typeof options.before === "string" ? new Date(options.before) : options.before;
    whereClause.createdAt = { lt: beforeDate };
  }

  const actions = await withPrismaRetry(
    () =>
      prisma.moderationAction.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    "listModerationActionsFromDb",
  );

  return actions.map((action) => ({
    id: action.id,
    userId: action.userId,
    actorId: action.actorId,
    action: action.action,
    severity: action.severity,
    reason: action.reason,
    metadata: action.metadata,
    createdAt: action.createdAt.toISOString(),
  }));
}

export async function listMembershipEventsFromDb(chatId: string, limit = 100) {
  const group = await withPrismaRetry(
    () =>
      prisma.group.findUnique({
        where: { telegramChatId: chatId },
        select: { id: true },
      }),
    "listMembershipEventsFromDb:group",
  );
  if (!group) {
    return [];
  }

  const events = await withPrismaRetry(
    () =>
      prisma.membershipEvent.findMany({
        where: { groupId: group.id },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    "listMembershipEventsFromDb",
  );

  return events.map((event) => ({
    id: event.id,
    userId: event.userId,
    event: event.event,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  }));
}

export async function listModerationActionsSince(
  chatId: string,
  since: Date,
): Promise<ModerationActionRecord[]> {
  if (!(since instanceof Date) || Number.isNaN(since.getTime())) {
    throw new Error("Invalid 'since' date supplied to listModerationActionsSince");
  }
  const groupId = await findGroupIdByChatId(chatId);
  if (!groupId) {
    return [];
  }
  const actions = await withPrismaRetry(
    () =>
      prisma.moderationAction.findMany({
        where: {
          groupId,
          createdAt: {
            gte: since,
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      }),
    "listModerationActionsSince",
  );

  return actions.map((action) => ({
    id: action.id,
    userId: action.userId,
    actorId: action.actorId,
    action: action.action,
    severity: action.severity,
    reason: action.reason,
    metadata: action.metadata,
    createdAt: action.createdAt.toISOString(),
  }));
}

export async function listMembershipEventsSince(
  chatId: string,
  since: Date,
): Promise<MembershipEventRecord[]> {
  if (!(since instanceof Date) || Number.isNaN(since.getTime())) {
    throw new Error("Invalid 'since' date supplied to listMembershipEventsSince");
  }
  const groupId = await findGroupIdByChatId(chatId);
  if (!groupId) {
    return [];
  }
  const events = await withPrismaRetry(
    () =>
      prisma.membershipEvent.findMany({
        where: {
          groupId,
          createdAt: {
            gte: since,
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      }),
    "listMembershipEventsSince",
  );

  return events.map((event) => ({
    id: event.id,
    userId: event.userId,
    event: event.event,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  }));
}

export async function countModerationActionsSince(groupIds: string[], since: Date): Promise<number> {
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return 0;
  }
  return withPrismaRetry(
    () =>
      prisma.moderationAction.count({
        where: {
          groupId: {
            in: groupIds,
          },
          createdAt: {
            gte: since,
          },
        },
      }),
    "countModerationActionsSince",
  );
}

export async function countMembershipJoinsSince(groupIds: string[], since: Date): Promise<number> {
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return 0;
  }
  return withPrismaRetry(
    () =>
      prisma.membershipEvent.count({
        where: {
          groupId: {
            in: groupIds,
          },
          event: "join",
          createdAt: {
            gte: since,
          },
        },
      }),
    "countMembershipJoinsSince",
  );
}

export async function userManagesAnyGroup(userTelegramId: string): Promise<boolean> {
  if (!userTelegramId) {
    return false;
  }
  const record = await withPrismaRetry(
    () =>
      prisma.group.findFirst({
        where: {
          OR: [
            {
              owner: {
                telegramId: userTelegramId,
              },
            },
            {
              managers: {
                some: {
                  role: {
                    not: "viewer",
                  },
                  user: {
                    telegramId: userTelegramId,
                  },
                },
              },
            },
          ],
        },
        select: {
          id: true,
        },
      }),
    "userManagesAnyGroup",
  );
  return Boolean(record);
}

export async function userCanManageGroup(userTelegramId: string, chatId: string): Promise<boolean> {
  if (!userTelegramId || !chatId) {
    return false;
  }
  const record = await withPrismaRetry(
    () =>
      prisma.group.findUnique({
        where: {
          telegramChatId: chatId,
        },
        select: {
          owner: {
            select: {
              telegramId: true,
            },
          },
          managers: {
            where: {
              role: {
                not: "viewer",
              },
              user: {
                telegramId: userTelegramId,
              },
            },
            select: {
              user: {
                select: {
                  telegramId: true,
                },
              },
            },
          },
        },
      }),
    "userCanManageGroup",
  );
  if (!record) {
    return false;
  }
  if (record.owner?.telegramId === userTelegramId) {
    return true;
  }
  return record.managers.some((manager) => manager.user?.telegramId === userTelegramId);
}
