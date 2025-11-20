import crypto from "node:crypto";
import { Prisma } from "@prisma/client";

import { getStarsState } from "../../bot/state.js";
import { prisma } from "../db/client.js";
import { countUserInvitesSince, fetchOwnerWalletBalance } from "../db/stateRepository.js";
import { sendTelegramMessage } from "../utils/telegramBotApi.js";
import { logger } from "../utils/logger.js";
import { recordGiveawayCreation } from "./missionVerificationService.js";
import { verifyTelegramChannelMembership } from "./telegramMembershipService.js";
import { issueCreditCode, notifyUserOfCreditCode } from "./creditCodeService.js";

export type ParticipantValidation = {
  oneJoinPerUser: boolean;
  minAccountAge: number;
  blockBots: boolean;
};

export type RefundConditions = {
  minParticipants: number;
  autoRefundIfLowTurnout: boolean;
  cancelGracePeriod: number;
};

export type GiveawayAnalytics = {
  participationRate: number;
  conversionToMember: number;
  engagementScore: number;
  costPerAcquisition: number;
};

export type GiveawayPlanOption = {
  id: string;
  starsPlanId: string;
  title: string;
  days: number;
  basePrice: number;
  pricePerWinner: number;
  description?: string;
};

export type GiveawayRequirement = {
  premiumOnly: boolean;
  targetChannel: string;
  extraChannel?: string | null;
  includedChannels?: string[];
  externalLinks?: string[];
  chatBoosterOnly?: boolean;
  inviteUniqueFriend?: boolean;
  notifyStart?: boolean;
  notifyEnd?: boolean;
};

export type GiveawayWinnerCode = {
  code: string;
  message: string;
};

export type ManagedGroupSummary = {
  id: string;
  title: string;
  photoUrl?: string | null;
  membersCount: number;
  status: {
    kind: "active" | "expired" | "removed";
    expiresAt?: string;
    daysLeft?: number;
    expiredAt?: string;
    removedAt?: string;
    graceEndsAt?: string;
  };
  canManage: boolean;
  inviteLink?: string | null;
};

export type GiveawaySummary = {
  id: string;
  title: string;
  status: "scheduled" | "active" | "completed" | "cancelled";
  prize: {
    planId: string | null;
    days: number;
    winners: number;
    pricePerWinner: number;
    totalCost: number;
  };
  participants: number;
  winnersCount: number;
  startsAt: string;
  endsAt: string;
  targetGroup: ManagedGroupSummary;
  requirements: GiveawayRequirement;
  winnerCodes?: GiveawayWinnerCode[];
  validation: ParticipantValidation;
  refundPolicy: RefundConditions;
  analytics: GiveawayAnalytics;
  cancellationReason?: string | null;
};

export type GiveawayDetail = GiveawaySummary & {
  joined: boolean;
  remainingSeconds: number;
  totalCost: number;
  premiumOnly: boolean;
};

export type GiveawayDashboardData = {
  balance: number;
  currency: string;
  active: GiveawaySummary[];
  past: GiveawaySummary[];
};

export type GiveawayConfig = {
  plans: GiveawayPlanOption[];
  durationOptions: number[];
  allowCustomDuration: boolean;
  validation: ParticipantValidation;
  refundPolicy: RefundConditions;
};

export type GiveawayCreationInput = {
  ownerTelegramId: string;
  groupChatId: string;
  planId: string;
  winners: number;
  durationHours: number;
  premiumOnly?: boolean;
  chatBoosterOnly?: boolean;
  inviteUniqueFriend?: boolean;
  includedChannels?: string[];
  externalLinks?: string[];
  extraChannel?: string | null;
  title?: string | null;
  notifyStart?: boolean;
  notifyEnd?: boolean;
  validation?: Partial<ParticipantValidation>;
  refundPolicy?: Partial<RefundConditions>;
};

export type GiveawayCreationResult = {
  id: string;
  totalCost: number;
  status: GiveawaySummary["status"];
  createdAt: string;
  balance: number;
};

export type GiveawayJoinContext = {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  isPremium?: boolean;
  isBot?: boolean;
  sourceIp?: string | null;
};

const GIVEAWAY_PRICE_MULTIPLIER = Number.isFinite(Number(process.env.GIVEAWAY_PRICE_MULTIPLIER))
  ? Number(process.env.GIVEAWAY_PRICE_MULTIPLIER)
  : 1.2;
const GIVEAWAY_DURATION_OPTIONS = (process.env.GIVEAWAY_DURATION_OPTIONS ?? "")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);
const DEFAULT_DURATION_OPTIONS = GIVEAWAY_DURATION_OPTIONS.length > 0 ? GIVEAWAY_DURATION_OPTIONS : [6, 12, 24];

const MAX_JOINS_PER_USER = 1;
const MAX_JOINS_PER_IP = Number.isFinite(Number(process.env.GIVEAWAY_MAX_JOINS_PER_IP))
  ? Number(process.env.GIVEAWAY_MAX_JOINS_PER_IP)
  : 5;

function defaultParticipantValidation(): ParticipantValidation {
  return {
    oneJoinPerUser: true,
    minAccountAge: Number.isFinite(Number(process.env.GIVEAWAY_MIN_ACCOUNT_AGE))
      ? Math.max(0, Number(process.env.GIVEAWAY_MIN_ACCOUNT_AGE))
      : 3,
    blockBots: true,
  };
}

function defaultRefundConditions(): RefundConditions {
  return {
    minParticipants: Number.isFinite(Number(process.env.GIVEAWAY_MIN_PARTICIPANTS))
      ? Math.max(1, Number(process.env.GIVEAWAY_MIN_PARTICIPANTS))
      : 10,
    autoRefundIfLowTurnout: (process.env.GIVEAWAY_AUTO_REFUND ?? "true").toLowerCase() !== "false",
    cancelGracePeriod: Number.isFinite(Number(process.env.GIVEAWAY_CANCEL_GRACE_HOURS))
      ? Math.max(0, Number(process.env.GIVEAWAY_CANCEL_GRACE_HOURS))
      : 6,
  };
}

function defaultAnalytics(): GiveawayAnalytics {
  return {
    participationRate: 0,
    conversionToMember: 0,
    engagementScore: 0,
    costPerAcquisition: 0,
  };
}

function normalizeValidation(value: Prisma.JsonValue | null | undefined): ParticipantValidation {
  const defaults = defaultParticipantValidation();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const raw = value as Record<string, unknown>;
  return {
    oneJoinPerUser: raw.oneJoinPerUser !== false,
    minAccountAge: Number.isFinite(Number(raw.minAccountAge))
      ? Math.max(0, Number(raw.minAccountAge))
      : defaults.minAccountAge,
    blockBots: raw.blockBots !== false,
  };
}

function normalizeRefundPolicy(value: Prisma.JsonValue | null | undefined): RefundConditions {
  const defaults = defaultRefundConditions();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const raw = value as Record<string, unknown>;
  return {
    minParticipants: Number.isFinite(Number(raw.minParticipants))
      ? Math.max(1, Number(raw.minParticipants))
      : defaults.minParticipants,
    autoRefundIfLowTurnout: raw.autoRefundIfLowTurnout !== false,
    cancelGracePeriod: Number.isFinite(Number(raw.cancelGracePeriod))
      ? Math.max(0, Number(raw.cancelGracePeriod))
      : defaults.cancelGracePeriod,
  };
}

function normalizeAnalytics(value: Prisma.JsonValue | null | undefined): GiveawayAnalytics {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultAnalytics();
  }
  const raw = value as Record<string, unknown>;
  return {
    participationRate: Number.isFinite(Number(raw.participationRate)) ? Number(raw.participationRate) : 0,
    conversionToMember: Number.isFinite(Number(raw.conversionToMember)) ? Number(raw.conversionToMember) : 0,
    engagementScore: Number.isFinite(Number(raw.engagementScore)) ? Number(raw.engagementScore) : 0,
    costPerAcquisition: Number.isFinite(Number(raw.costPerAcquisition)) ? Number(raw.costPerAcquisition) : 0,
  };
}

function mapGroupToManagedSummary(group: {
  id: string;
  telegramChatId: string;
  title: string;
  inviteLink: string | null;
  creditBalance: Prisma.Decimal;
}): ManagedGroupSummary {
  const credit = Number(group.creditBalance ?? 0);
  let status: ManagedGroupSummary["status"];
  if (credit > 0) {
    const daysLeft = Math.ceil(credit);
    const expiresAt = new Date(Date.now() + daysLeft * 86_400_000).toISOString();
    status = {
      kind: "active",
      daysLeft,
      expiresAt,
    };
  } else {
    status = {
      kind: "expired",
      expiredAt: new Date().toISOString(),
      graceEndsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    };
  }

  return {
    id: group.telegramChatId,
    title: group.title,
    photoUrl: null,
    membersCount: 0,
    status,
    canManage: true,
    inviteLink: group.inviteLink,
  };
}

function buildGiveawayPlans(): GiveawayPlanOption[] {
  const starsPlans = getStarsState().plans;
  return starsPlans.map((plan) => ({
    id: `giveaway-${plan.id}`,
    starsPlanId: plan.id,
    title: `${plan.days}-day access`,
    days: plan.days,
    basePrice: plan.price,
    pricePerWinner: Math.round(plan.price * GIVEAWAY_PRICE_MULTIPLIER),
  }));
}

function computeAnalytics({
  giveaway,
  participantCount,
}: {
  giveaway: { totalCost: number; winnersCount: number; startsAt: Date; endsAt: Date; minParticipants: number };
  participantCount: number;
}): GiveawayAnalytics {
  const durationMs = Math.max(1, giveaway.endsAt.getTime() - giveaway.startsAt.getTime());
  const durationHours = durationMs / 3_600_000;
  const participationRate = giveaway.minParticipants > 0 ? participantCount / giveaway.minParticipants : participantCount;
  const engagementScore = participantCount / durationHours;
  const costPerAcquisition = participantCount > 0 ? giveaway.totalCost / participantCount : giveaway.totalCost;
  const conversionToMember = giveaway.winnersCount > 0 ? Math.min(1, participantCount / giveaway.winnersCount) : 0;
  return {
    participationRate: Number(participationRate.toFixed(4)),
    conversionToMember: Number(conversionToMember.toFixed(4)),
    engagementScore: Number(engagementScore.toFixed(4)),
    costPerAcquisition: Number(costPerAcquisition.toFixed(2)),
  };
}

function normalizeRequirements(value: Prisma.JsonValue | null | undefined): GiveawayRequirement & {
  includedChannels: string[];
  externalLinks: string[];
  chatBoosterOnly: boolean;
  inviteUniqueFriend: boolean;
  notifyStart: boolean;
  notifyEnd: boolean;
} {
  const base: GiveawayRequirement & {
    includedChannels: string[];
    externalLinks: string[];
    chatBoosterOnly: boolean;
    inviteUniqueFriend: boolean;
    notifyStart: boolean;
    notifyEnd: boolean;
  } = {
    premiumOnly: false,
    targetChannel: "",
    extraChannel: null,
    includedChannels: [],
    externalLinks: [],
    chatBoosterOnly: false,
    inviteUniqueFriend: false,
    notifyStart: false,
    notifyEnd: false,
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return base;
  }

  const raw = value as Record<string, unknown>;
  const includedChannels = Array.isArray(raw.includedChannels)
    ? raw.includedChannels
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : [];
  const externalLinks = Array.isArray(raw.externalLinks)
    ? raw.externalLinks
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : [];

  return {
    premiumOnly: raw.premiumOnly === true,
    targetChannel: typeof raw.targetChannel === "string" ? raw.targetChannel : "",
    extraChannel:
      typeof raw.extraChannel === "string" && raw.extraChannel.trim().length > 0
        ? raw.extraChannel
        : null,
    includedChannels,
    externalLinks,
    chatBoosterOnly: raw.chatBoosterOnly === true,
    inviteUniqueFriend: raw.inviteUniqueFriend === true,
    notifyStart: raw.notifyStart === true,
    notifyEnd: raw.notifyEnd === true,
  };
}

function deriveStatus(giveaway: { status: string; startsAt: Date; endsAt: Date }): GiveawaySummary["status"] {
  const now = Date.now();
  if (giveaway.status === "cancelled") {
    return "cancelled";
  }
  if (giveaway.status === "completed") {
    return "completed";
  }
  if (giveaway.startsAt.getTime() > now) {
    return "scheduled";
  }
  if (giveaway.endsAt.getTime() <= now) {
    return "completed";
  }
  return "active";
}

function buildWinnerCodes(
  giveawayId: string,
  targetTitle: string,
  winners: Array<{ telegramId: string; code: string }>,
  prizeDays: number,
): GiveawayWinnerCode[] {
  const sanitized = targetTitle.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const prefix = sanitized.slice(0, 6) || "WINNER";
  return winners.map((winner, index) => {
    const normalizedCode = winner.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || crypto.randomBytes(12).toString("hex").toUpperCase();
    const formattedCode = `${prefix}-${String(index + 1).padStart(2, "0")}-${normalizedCode.slice(0, 12)}`;
    const message = `You won the giveaway ${giveawayId}! Use code ${formattedCode} to claim your ${prizeDays}-day reward.`;
    return { code: formattedCode, message };
  });
}

function seededWinners(
  participants: Array<{ id: string; telegramId: string }>,
  count: number,
  seed: string,
): Array<{ id: string; telegramId: string }> {
  if (participants.length <= count) {
    return participants;
  }

  return [...participants]
    .map((participant) => {
      const hash = crypto.createHash("sha256").update(seed + participant.id).digest("hex");
      return {
        ...participant,
        weight: BigInt(`0x${hash}`),
      };
    })
    .sort((a, b) => (a.weight < b.weight ? -1 : a.weight > b.weight ? 1 : 0))
    .slice(0, count)
    .map(({ id, telegramId }) => ({ id, telegramId }));
}

async function ensureOwnerWallet(tx: Prisma.TransactionClient, ownerTelegramId: string) {
  const owner = await tx.user.upsert({
    where: { telegramId: ownerTelegramId },
    update: {},
    create: {
      telegramId: ownerTelegramId,
      role: "owner",
    },
    select: {
      id: true,
    },
  });

  const wallet = await tx.starsWallet.upsert({
    where: { ownerId: owner.id },
    update: {},
    create: {
      ownerId: owner.id,
      balance: 0,
    },
    select: {
      id: true,
      balance: true,
    },
  });

  return { ownerId: owner.id, walletId: wallet.id };
}

async function ensureGroup(tx: Prisma.TransactionClient, chatId: string, title?: string) {
  const existing = await tx.group.findUnique({
    where: {
      telegramChatId: chatId,
    },
    select: { id: true, title: true, inviteLink: true, creditBalance: true },
  });
  if (existing) {
    return existing;
  }
  const created = await tx.group.create({
    data: {
      telegramChatId: chatId,
      title: title && title.trim().length > 0 ? title : `Group ${chatId}`,
      status: "unknown",
      creditBalance: new Prisma.Decimal(0),
    },
    select: { id: true, title: true, inviteLink: true, creditBalance: true },
  });
  return created;
}

async function updateGiveawayAnalytics(tx: Prisma.TransactionClient, giveawayId: string): Promise<GiveawayAnalytics> {
  const giveaway = await tx.giveaway.findUnique({
    where: { id: giveawayId },
    select: {
      id: true,
      totalCost: true,
      winnersCount: true,
      startsAt: true,
      endsAt: true,
      minParticipants: true,
      analytics: true,
    },
  });
  if (!giveaway) {
    throw new Error(`Giveaway ${giveawayId} not found while updating analytics`);
  }

  const participantCount = await tx.giveawayParticipant.count({
    where: {
      giveawayId,
      status: "validated",
    },
  });

  const analytics = computeAnalytics({ giveaway, participantCount });

  await tx.giveaway.update({
    where: { id: giveawayId },
    data: {
      analytics,
    },
  });

  return analytics;
}

async function finalizeGiveawayIfNeeded(tx: Prisma.TransactionClient, giveawayId: string): Promise<void> {
  const giveaway = await tx.giveaway.findUnique({
    where: { id: giveawayId },
    include: {
      group: {
        select: {
          telegramChatId: true,
          title: true,
        },
      },
      winners: true,
    },
  });
  if (!giveaway) {
    return;
  }

  const now = new Date();
  if (giveaway.status === "completed" || giveaway.status === "cancelled") {
    return;
  }

  if (giveaway.endsAt.getTime() > now.getTime()) {
    return;
  }

  const validation = normalizeValidation(giveaway.validation);
  const refundPolicy = normalizeRefundPolicy(giveaway.refundPolicy);
  const requirements = normalizeRequirements(giveaway.requirements);

  const participants = await tx.giveawayParticipant.findMany({
    where: {
      giveawayId,
      status: "validated",
    },
    select: {
      id: true,
      telegramId: true,
    },
  });

  if (participants.length < refundPolicy.minParticipants) {
    if (refundPolicy.autoRefundIfLowTurnout) {
      await refundGiveaway(tx, giveaway, "Not enough participants to select winners");
    } else {
      await tx.giveaway.update({
        where: { id: giveawayId },
        data: {
          status: "cancelled",
          cancellationReason: "Minimum participant threshold not reached",
          cancelledAt: new Date(),
        },
      });
    }
    await updateGiveawayAnalytics(tx, giveawayId);
    return;
  }

  if (giveaway.winners.length >= giveaway.winnersCount) {
    await tx.giveaway.update({
      where: { id: giveawayId },
      data: {
        status: "completed",
      },
    });
    await updateGiveawayAnalytics(tx, giveawayId);
    return;
  }

  const winners = seededWinners(participants, giveaway.winnersCount, giveaway.seed);
  if (winners.length === 0) {
    await refundGiveaway(tx, giveaway, "No eligible winners could be selected");
    await updateGiveawayAnalytics(tx, giveawayId);
    return;
  }

  const createdWinners = await Promise.all(
    winners.map((winner) =>
      tx.giveawayWinner.create({
        data: {
          giveawayId,
          participantId: winner.id,
          telegramId: winner.telegramId,
          code: crypto.randomBytes(16).toString("hex").toUpperCase(),
          metadata: {
            seed: giveaway.seed,
          },
        },
      }),
    ),
  );

  await tx.giveaway.update({
    where: { id: giveaway.id },
    data: {
      status: "completed",
    },
  });

  await updateGiveawayAnalytics(tx, giveawayId);
  logger.info("giveaway winners selected", {
    giveawayId,
    winners: winners.map((winner) => winner.telegramId),
    validation,
  });

  // Notify winners privately with their credit codes & optionally send a safe summary in the host group.
  try {
    if (giveaway.ownerId) {
      const owner = await tx.user.findUnique({
        where: { id: giveaway.ownerId },
        select: {
          telegramId: true,
        },
      });

      if (owner?.telegramId) {
        const winnerTelegramIds = createdWinners.map((entry) => entry.telegramId);

        // Commit-time side effects must not block the transaction; we only prepare context here.
        queueGiveawayWinnerNotifications({
          giveawayId: giveaway.id,
          ownerTelegramId: owner.telegramId,
          winnerTelegramIds,
          prizeDays: giveaway.prizeDays,
          requirements,
          groupChatId: giveaway.group?.telegramChatId ?? null,
          groupTitle: giveaway.group?.title ?? "",
        });
      }
    }
  } catch (error) {
    logger.warn("failed to schedule giveaway winner notifications", {
      giveawayId: giveaway.id,
      error,
    });
  }
}

type WinnerNotificationContext = {
  giveawayId: string;
  ownerTelegramId: string;
  winnerTelegramIds: string[];
  prizeDays: number;
  requirements: ReturnType<typeof normalizeRequirements>;
  groupChatId: string | null;
  groupTitle: string;
};

// In-process queue placeholder; current implementation runs notifications synchronously.
async function queueGiveawayWinnerNotifications(context: WinnerNotificationContext): Promise<void> {
  const uniqueWinners = Array.from(new Set(context.winnerTelegramIds));

  for (const telegramId of uniqueWinners) {
    try {
      const profile = await prisma.userProfile.findUnique({
        where: { telegramUserId: telegramId },
        select: { id: true },
      });
      if (!profile) {
        // Winners must have opened the Mini App at least once to receive codes.
        continue;
      }

      const codeResult = await issueCreditCode({
        profileId: profile.id,
        telegramUserId: telegramId,
        valueDays: context.prizeDays,
        metadata: {
          giveawayId: context.giveawayId,
          source: "giveaway-winner",
        },
      });

      await notifyUserOfCreditCode({
        telegramUserId: telegramId,
        code: codeResult.code,
        valueDays: context.prizeDays,
      });
    } catch (error) {
      logger.warn("failed to issue or deliver giveaway winner credit code", {
        giveawayId: context.giveawayId,
        winnerTelegramId: telegramId,
        error,
      });
    }
  }

  if (context.requirements.notifyEnd && context.groupChatId) {
    try {
      const winnerCount = uniqueWinners.length;
      const title = context.groupTitle || context.groupChatId;
      const summary =
        `🎉 Giveaway finished in ${title}!
Winners: ${winnerCount}

Each winner has received a private DM with their redemption code. Codes are never posted in the group.`;

      await sendTelegramMessage({
        chatId: context.groupChatId,
        text: summary,
      });
    } catch (error) {
      logger.warn("failed to send giveaway end notification", {
        giveawayId: context.giveawayId,
        chatId: context.groupChatId,
        error,
      });
    }
  }
}

async function refundGiveaway(
  tx: Prisma.TransactionClient,
  giveaway: {
    id: string;
    ownerId: string | null;
    fundingTransactionId: string | null;
    totalCost: number;
  },
  reason: string,
): Promise<void> {
  if (!giveaway.ownerId || giveaway.totalCost <= 0) {
    await tx.giveaway.update({
      where: { id: giveaway.id },
      data: {
        status: "cancelled",
        cancellationReason: reason,
        cancelledAt: new Date(),
      },
    });
    return;
  }

  const wallet = await tx.starsWallet.findUnique({
    where: { ownerId: giveaway.ownerId },
    select: { id: true },
  });

  if (!wallet) {
    logger.warn("giveaway refund skipped, wallet missing", { giveawayId: giveaway.id });
    return;
  }

  await tx.starsWallet.update({
    where: { id: wallet.id },
    data: {
      balance: {
        increment: giveaway.totalCost,
      },
    },
  });

  await tx.starTransaction.create({
    data: {
      walletId: wallet.id,
      type: "giveaway_refund",
      amount: giveaway.totalCost,
      status: "completed",
      metadata: {
        giveawayId: giveaway.id,
        reason,
      },
    },
  });

  if (giveaway.fundingTransactionId) {
    await tx.starTransaction.update({
      where: { id: giveaway.fundingTransactionId },
      data: {
        status: "refunded",
        metadata: {
          refundReason: reason,
        },
      },
    });
  }

  await tx.giveaway.update({
    where: { id: giveaway.id },
    data: {
      status: "cancelled",
      cancellationReason: reason,
      cancelledAt: new Date(),
    },
  });

  logger.warn("giveaway refunded", { giveawayId: giveaway.id, reason });
}

async function buildGiveawaySummaryById(id: string, viewerTelegramId?: string | null): Promise<GiveawayDetail> {
  const giveaway = await prisma.giveaway.findUnique({
    where: { id },
    include: {
      group: true,
      participants: {
        where: { status: "validated" },
        select: {
          telegramId: true,
          joinedAt: true,
        },
      },
      winners: true,
    },
  });

  if (!giveaway) {
    throw Object.assign(new Error("Giveaway not found"), { statusCode: 404 });
  }

  const validation = normalizeValidation(giveaway.validation);
  const refundPolicy = normalizeRefundPolicy(giveaway.refundPolicy);

  const groupSummary = giveaway.group
    ? mapGroupToManagedSummary(giveaway.group)
    : {
        id: "unknown",
        title: "Unknown group",
        membersCount: 0,
        photoUrl: null,
        status: {
          kind: "expired" as const,
          expiredAt: new Date().toISOString(),
          graceEndsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        },
        canManage: false,
      };

  const participantCount = giveaway.participants.length;
  const analytics = normalizeAnalytics(giveaway.analytics);
  const status = deriveStatus(giveaway);

  const winnerCodes =
    giveaway.winners.length > 0
      ? buildWinnerCodes(
          giveaway.id,
          groupSummary.title,
          giveaway.winners.map((winner) => ({ telegramId: winner.telegramId, code: winner.code })),
          giveaway.prizeDays,
        )
      : undefined;

  const joined =
    viewerTelegramId != null && giveaway.participants.some((participant) => participant.telegramId === viewerTelegramId);

  const remainingSeconds = Math.max(0, Math.floor((giveaway.endsAt.getTime() - Date.now()) / 1000));

  const requirements = normalizeRequirements(giveaway.requirements);

  return {
    id: giveaway.id,
    title: giveaway.title,
    status,
    prize: {
      planId: giveaway.planId,
      days: giveaway.prizeDays,
      winners: giveaway.winnersCount,
      pricePerWinner: giveaway.pricePerWinner,
      totalCost: giveaway.totalCost,
    },
    participants: participantCount,
    winnersCount: giveaway.winnersCount,
    startsAt: giveaway.startsAt.toISOString(),
    endsAt: giveaway.endsAt.toISOString(),
    targetGroup: groupSummary,
    requirements,
    winnerCodes,
    validation,
    refundPolicy,
    analytics,
    joined,
    remainingSeconds,
    totalCost: giveaway.totalCost,
    premiumOnly: Boolean(requirements.premiumOnly),
    cancellationReason: giveaway.cancellationReason,
  };
}

export async function getGiveawayConfig(): Promise<GiveawayConfig> {
  return {
    plans: buildGiveawayPlans(),
    durationOptions: DEFAULT_DURATION_OPTIONS,
    allowCustomDuration: true,
    validation: defaultParticipantValidation(),
    refundPolicy: defaultRefundConditions(),
  };
}

export async function getGiveawayDashboard(ownerTelegramId: string | null): Promise<GiveawayDashboardData> {
  const balance =
    ownerTelegramId != null ? await fetchOwnerWalletBalance(ownerTelegramId).then((value) => value ?? 0) : 0;

  await prisma.$transaction(async (tx) => {
    const due = await tx.giveaway.findMany({
      where: {
        status: {
          notIn: ["completed", "cancelled"],
        },
        endsAt: {
          lte: new Date(),
        },
      },
      select: { id: true },
    });
    for (const entry of due) {
      await finalizeGiveawayIfNeeded(tx, entry.id);
    }
  });

  const giveaways = await prisma.giveaway.findMany({
    orderBy: {
      startsAt: "desc",
    },
    include: {
      group: true,
      participants: {
        where: { status: "validated" },
        select: { telegramId: true },
      },
      winners: true,
    },
  });

  const summaries = giveaways.map((giveaway) => {
    const validation = normalizeValidation(giveaway.validation);
    const refundPolicy = normalizeRefundPolicy(giveaway.refundPolicy);
    const analytics = normalizeAnalytics(giveaway.analytics);
    const participants = giveaway.participants.length;
    const status = deriveStatus(giveaway);
    const requirements = normalizeRequirements(giveaway.requirements);

    const groupSummary = giveaway.group
      ? mapGroupToManagedSummary(giveaway.group)
      : {
          id: "unknown",
          title: "Unknown group",
          membersCount: 0,
          photoUrl: null,
          status: {
            kind: "expired" as const,
            expiredAt: new Date().toISOString(),
            graceEndsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          },
          canManage: false,
        };

    return {
      id: giveaway.id,
      title: giveaway.title,
      status,
      prize: {
        planId: giveaway.planId,
        days: giveaway.prizeDays,
        winners: giveaway.winnersCount,
        pricePerWinner: giveaway.pricePerWinner,
        totalCost: giveaway.totalCost,
      },
      participants,
      winnersCount: giveaway.winnersCount,
      startsAt: giveaway.startsAt.toISOString(),
      endsAt: giveaway.endsAt.toISOString(),
      targetGroup: groupSummary,
      requirements,
      winnerCodes:
        giveaway.winners.length > 0
          ? buildWinnerCodes(
              giveaway.id,
              groupSummary.title,
              giveaway.winners.map((winner) => ({
                telegramId: winner.telegramId,
                code: winner.code,
              })),
              giveaway.prizeDays,
            )
          : undefined,
      validation,
      refundPolicy,
      analytics,
      cancellationReason: giveaway.cancellationReason,
    } satisfies GiveawaySummary;
  });

  const active = summaries.filter((summary) => summary.status === "active" || summary.status === "scheduled");
  const past = summaries.filter((summary) => summary.status === "completed" || summary.status === "cancelled");

  return {
    balance,
    currency: "stars",
    active,
    past,
  };
}

export async function createGiveaway(input: GiveawayCreationInput): Promise<GiveawayCreationResult> {
  const plans = buildGiveawayPlans();
  const plan = plans.find((item) => item.id === input.planId || item.starsPlanId === input.planId);
  if (!plan) {
    throw Object.assign(new Error("Selected giveaway plan not found"), { statusCode: 400 });
  }

  const winners = Math.max(1, Math.trunc(input.winners));
  const durationHours = Math.max(1, Math.trunc(input.durationHours));
  const totalCost = plan.pricePerWinner * winners;
  const validation = { ...defaultParticipantValidation(), ...input.validation };
  const refundPolicy = { ...defaultRefundConditions(), ...input.refundPolicy };

  const now = new Date();
  const startsAt = now;
  const endsAt = new Date(startsAt.getTime() + durationHours * 3_600_000);
  const status: GiveawaySummary["status"] = endsAt.getTime() <= startsAt.getTime() ? "completed" : "active";

  const result = await prisma.$transaction(async (tx) => {
    const { ownerId, walletId } = await ensureOwnerWallet(tx, input.ownerTelegramId);

    const wallet = await tx.starsWallet.findUnique({
      where: { id: walletId },
      select: { balance: true },
    });
    if (!wallet) {
      throw Object.assign(new Error("Owner wallet not found"), { statusCode: 400 });
    }
    if (wallet.balance < totalCost) {
      throw Object.assign(new Error("Insufficient Stars balance"), { statusCode: 400 });
    }

    const group = await ensureGroup(tx, input.groupChatId);

    await tx.starsWallet.update({
      where: { id: walletId },
      data: {
        balance: {
          decrement: totalCost,
        },
      },
    });

    const fundingTxn = await tx.starTransaction.create({
      data: {
        walletId,
        groupId: group.id,
        type: "giveaway_debit",
        amount: -totalCost,
        status: "completed",
        metadata: {
          giveawayPlanId: plan.id,
          giveawayWinners: winners,
          giveawayEndsAt: endsAt.toISOString(),
        },
      },
    });

    const giveaway = await tx.giveaway.create({
      data: {
        ownerId,
        groupId: group.id,
        fundingTransactionId: fundingTxn.id,
        title: input.title?.trim().length ? input.title.trim() : `${plan.days}-day giveaway`,
        status,
        seed: crypto.randomBytes(32).toString("hex"),
        planId: plan.starsPlanId,
        prizeDays: plan.days,
        winnersCount: winners,
        pricePerWinner: plan.pricePerWinner,
        totalCost,
        startsAt,
        endsAt,
        validation,
        refundPolicy,
        requirements: {
          premiumOnly: Boolean(input.premiumOnly),
          targetChannel: group.inviteLink ?? input.groupChatId,
          extraChannel: input.extraChannel ?? null,
          includedChannels: Array.isArray(input.includedChannels)
            ? input.includedChannels
            : [],
          externalLinks: Array.isArray(input.externalLinks)
            ? input.externalLinks
            : [],
          chatBoosterOnly: Boolean(input.chatBoosterOnly),
          inviteUniqueFriend: Boolean(input.inviteUniqueFriend),
          notifyStart: Boolean(input.notifyStart),
          notifyEnd: Boolean(input.notifyEnd),
        } satisfies GiveawayRequirement & {
          includedChannels: string[];
          externalLinks: string[];
          chatBoosterOnly: boolean;
          inviteUniqueFriend: boolean;
          notifyStart: boolean;
          notifyEnd: boolean;
        },
        analytics: defaultAnalytics(),
        minParticipants: refundPolicy.minParticipants,
      },
    });

    const updatedWallet = await tx.starsWallet.findUnique({
      where: { id: walletId },
      select: { balance: true },
    });

    return {
      giveaway,
      balance: updatedWallet?.balance ?? wallet.balance - totalCost,
    };
  });

  logger.info("giveaway created", {
    giveawayId: result.giveaway.id,
    owner: input.ownerTelegramId,
    groupId: input.groupChatId,
    totalCost,
  });

  try {
    await recordGiveawayCreation(input.ownerTelegramId, {
      giveawayId: result.giveaway.id,
      groupId: input.groupChatId,
      totalCost,
      planId: plan.id,
      winners: winners,
    });
  } catch (error) {
    logger.warn("failed to record giveaway mission", {
      owner: input.ownerTelegramId,
      giveawayId: result.giveaway.id,
      error,
    });
  }

  const summary: GiveawayCreationResult = {
    id: result.giveaway.id,
    totalCost,
    status: deriveStatus(result.giveaway),
    createdAt: result.giveaway.createdAt.toISOString(),
    balance: result.balance,
  };

  try {
    const requirements = normalizeRequirements(result.giveaway.requirements as Prisma.JsonValue | null | undefined);
    if (requirements.notifyStart) {
      await sendTelegramMessage({
        chatId: input.groupChatId,
        text: `A new giveaway has started: ${result.giveaway.title}`,
      });
    }
  } catch (error) {
    logger.warn("failed to send giveaway start notification", {
      giveawayId: result.giveaway.id,
      chatId: input.groupChatId,
      error,
    });
  }

  return summary;
}

export async function getGiveawayDetail(giveawayId: string, viewerTelegramId?: string | null): Promise<GiveawayDetail> {
  await prisma.$transaction(async (tx) => finalizeGiveawayIfNeeded(tx, giveawayId));
  return buildGiveawaySummaryById(giveawayId, viewerTelegramId);
}

export async function joinGiveaway(
  giveawayId: string,
  context: GiveawayJoinContext,
): Promise<GiveawayDetail> {
  if (!context.telegramId) {
    throw Object.assign(new Error("Telegram ID is required to join giveaway"), { statusCode: 400 });
  }

  await prisma.$transaction(async (tx) => {
    const giveaway = await tx.giveaway.findUnique({
      where: { id: giveawayId },
      include: {
        group: {
          select: {
            telegramChatId: true,
          },
        },
        participants: true,
      },
    });

    if (!giveaway) {
      throw Object.assign(new Error("Giveaway not found"), { statusCode: 404 });
    }

    const now = new Date();
    if (giveaway.startsAt.getTime() > now.getTime()) {
      throw Object.assign(new Error("Giveaway has not started yet"), { statusCode: 400 });
    }
    if (giveaway.endsAt.getTime() <= now.getTime()) {
      throw Object.assign(new Error("Giveaway has already ended"), { statusCode: 400 });
    }
    if (giveaway.status === "cancelled") {
      throw Object.assign(new Error("Giveaway has been cancelled"), { statusCode: 400 });
    }

    const validation = normalizeValidation(giveaway.validation);
    const requirements = normalizeRequirements(giveaway.requirements);

    if (validation.blockBots && context.isBot) {
      throw Object.assign(new Error("Bot accounts are not eligible for this giveaway"), { statusCode: 403 });
    }

    const existingParticipant = await tx.giveawayParticipant.findUnique({
      where: {
        giveawayId_telegramId: {
          giveawayId,
          telegramId: context.telegramId,
        },
      },
    });

    if (existingParticipant) {
      if (validation.oneJoinPerUser || MAX_JOINS_PER_USER === 1) {
        throw Object.assign(new Error("You have already joined this giveaway"), { statusCode: 409 });
      }
    }

    const displayName =
      context.firstName && context.lastName
        ? `${context.firstName} ${context.lastName}`
        : context.firstName ?? context.lastName ?? context.username ?? context.telegramId;

    const user = await tx.user.upsert({
      where: { telegramId: context.telegramId },
      update: {
        displayName,
      },
      create: {
        telegramId: context.telegramId,
        displayName,
        role: "user",
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    const accountAgeMs = Date.now() - user.createdAt.getTime();
    const accountAgeDays = Math.floor(accountAgeMs / 86_400_000);
    if (accountAgeDays < validation.minAccountAge) {
      throw Object.assign(new Error("Account does not meet minimum age requirement"), { statusCode: 403 });
    }

    if (context.sourceIp && MAX_JOINS_PER_IP > 0) {
      const joinsFromIp = await tx.giveawayParticipant.count({
        where: {
          giveawayId,
          sourceIp: context.sourceIp,
        },
      });
      if (joinsFromIp >= MAX_JOINS_PER_IP) {
        throw Object.assign(new Error("Too many join attempts from this network"), { statusCode: 429 });
      }
    }

    if (requirements.premiumOnly && !context.isPremium) {
      throw Object.assign(new Error("Telegram Premium is required to join this giveaway"), {
        statusCode: 403,
      });
    }

    if (requirements.includedChannels.length > 0) {
      for (const rawChannel of requirements.includedChannels) {
        const trimmed = typeof rawChannel === "string" ? rawChannel.trim() : "";
        if (!trimmed) {
          continue;
        }
        const normalizedChannel = trimmed.replace(/^@+/, "").trim();
        if (!normalizedChannel) {
          continue;
        }
        const ok = await verifyTelegramChannelMembership(context.telegramId, normalizedChannel);
        if (!ok) {
          throw Object.assign(new Error("You must join all required channels to enter this giveaway"), {
            statusCode: 403,
          });
        }
      }
    }

    if (requirements.inviteUniqueFriend) {
      const hostChatId = giveaway.group?.telegramChatId;
      if (!hostChatId) {
        throw Object.assign(new Error("Giveaway host group is not available"), { statusCode: 500 });
      }
      const inviteCount = await countUserInvitesSince(hostChatId, context.telegramId, null);
      if (inviteCount <= 0) {
        throw Object.assign(new Error("You must invite at least one friend to join this giveaway"), {
          statusCode: 403,
        });
      }
    }

    await tx.giveawayParticipant.create({
      data: {
        giveawayId,
        userId: user.id,
        telegramId: context.telegramId,
        username: context.username,
        displayName,
        status: "validated",
        accountAgeDays,
        isBot: Boolean(context.isBot),
        sourceIp: context.sourceIp ?? null,
        metadata: {
          isPremium: context.isPremium ?? false,
          joinedAt: new Date().toISOString(),
        },
      },
    });

    await updateGiveawayAnalytics(tx, giveawayId);
  });

  await prisma.$transaction(async (tx) => finalizeGiveawayIfNeeded(tx, giveawayId));

  return buildGiveawaySummaryById(giveawayId, context.telegramId);
}
