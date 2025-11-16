import { adjustStarsBalance, applyStarsPurchase, getStarsState, type StarsPlanRecord, type StarsPurchaseInput } from "../../bot/state.js";
import {
  createPendingStarTransaction,
  completeStarTransaction,
  findStarTransactionById,
  patchStarTransactionMetadata,
} from "../db/mutateRepository.js";
import { createInvoiceLink, refundStarsPayment } from "../utils/telegramBotApi.js";
import { logger } from "../utils/logger.js";
import { fetchOwnerWalletDetails } from "../db/stateRepository.js";
import { recordGroupCreditRenewal } from "./missionVerificationService.js";
import { prisma } from "../db/client.js";

const BOT_USERNAME = process.env.BOT_USERNAME?.replace(/^@/, "");
const STARS_CURRENCY = (process.env.STARS_CURRENCY ?? "XTR").trim() || "XTR";
const INVOICE_PAYLOAD_PREFIX = "stars:";

type GroupMetadata = NonNullable<StarsPurchaseInput["metadata"]>;

type MetadataOverrides = Partial<GroupMetadata>;

function resolvePlanById(planId: string): StarsPlanRecord {
  const stars = getStarsState();
  const plan = stars.plans.find((item) => item.id === planId);
  if (!plan) {
    throw Object.assign(new Error(`Stars plan ${planId} not found`), { statusCode: 400 });
  }
  return plan;
}

function buildInvoiceTitle(plan: StarsPlanRecord, metadata: GroupMetadata, gifted: boolean): string {
  const base = plan.label?.trim() ?? `${plan.days}-day plan`;
  const suffix = gifted ? "gift" : "top-up";
  const composite = `${base} ${suffix}`;
  if (composite.length <= 32) {
    return composite;
  }
  const short = `${plan.days}d ${suffix}`;
  return short.length <= 32 ? short : "Stars subscription";
}

function buildInvoiceDescription(plan: StarsPlanRecord, metadata: GroupMetadata, groupId: string, gifted: boolean): string {
  const groupTitle = metadata.title?.trim() || groupId;
  const action = gifted ? "Gift Stars to" : "Extend";
  return `${action} ${groupTitle} for ${plan.days} days (${plan.price} Stars).`;
}

function buildInvoicePayload(transactionId: string): string {
  return `${INVOICE_PAYLOAD_PREFIX}${transactionId}`;
}

export function extractTransactionIdFromPayload(payload: string | null | undefined): string | null {
  if (!payload || typeof payload !== "string") {
    return null;
  }
  if (payload.startsWith(INVOICE_PAYLOAD_PREFIX)) {
    return payload.slice(INVOICE_PAYLOAD_PREFIX.length);
  }
  return payload;
}

export type StarsPurchaseRequest = {
  ownerTelegramId: string;
  groupId: string;
  planId: string;
  gifted?: boolean;
  metadata?: unknown;
  managed?: boolean;
};

export type StarsPurchaseResult = {
  transactionId: string;
  status: "pending" | "completed" | "refunded";
  groupId: string | null;
  planId: string;
  daysAdded: number;
  expiresAt: string | null;
  balanceDelta: number;
  gifted: boolean;
  paymentUrl?: string | null;
  message?: string | null;
};

export type StarsTransactionDirection = "debit" | "credit";

export type StarsTransactionEntry = {
  id: string;
  status: "pending" | "completed" | "refunded";
  direction: StarsTransactionDirection;
  amount: number;
  planId: string | null;
  planLabel: string | null;
  planDays: number | null;
  planPrice: number | null;
  groupId: string | null;
  groupTitle: string | null;
  gifted: boolean;
  createdAt: string;
  completedAt: string | null;
  externalId: string | null;
  invoiceLink: string | null;
};

export type StarsWalletSummary = {
  balance: number;
  currency: string;
  totalSpent: number;
  totalRefunded: number;
  pendingCount: number;
  transactions: StarsTransactionEntry[];
};

function isAutoCaptureEnabled(): boolean {
  const value = (process.env.STARS_AUTO_CAPTURE ?? "false").toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

export function normalizeGroupMetadata(
  input: unknown,
  overrides?: MetadataOverrides,
): GroupMetadata {
  if (!input || typeof input !== "object") {
    return {
      title: overrides?.title ?? undefined,
      membersCount: overrides?.membersCount ?? undefined,
      inviteLink: overrides?.inviteLink ?? null,
      photoUrl: overrides?.photoUrl ?? null,
      managed: overrides?.managed,
    };
  }

  const raw = input as Record<string, unknown>;
  return {
    title: typeof raw.title === "string" ? raw.title : overrides?.title ?? undefined,
    membersCount:
      typeof raw.membersCount === "number" && Number.isFinite(raw.membersCount)
        ? raw.membersCount
        : overrides?.membersCount ?? undefined,
    inviteLink: typeof raw.inviteLink === "string" ? raw.inviteLink : overrides?.inviteLink ?? null,
    photoUrl: typeof raw.photoUrl === "string" ? raw.photoUrl : overrides?.photoUrl ?? null,
    managed:
      raw.managed !== undefined
        ? Boolean(raw.managed)
        : overrides?.managed,
  };
}

function buildPaymentUrl(transactionId: string, groupId: string, planId: string): string | null {
  const configured = process.env.STARS_PAYMENT_URL?.trim();
  if (configured) {
    const url = new URL(configured, configured.startsWith("http") ? undefined : "https://t.me");
    url.searchParams.set("transaction_id", transactionId);
    url.searchParams.set("group_id", groupId);
    url.searchParams.set("plan_id", planId);
    return url.toString();
  }
  if (BOT_USERNAME) {
    return `https://t.me/${BOT_USERNAME}?start=stars_${transactionId}`;
  }
  return null;
}

export async function purchaseStars(input: StarsPurchaseRequest): Promise<StarsPurchaseResult> {
  const groupId = typeof input.groupId === "string" ? input.groupId.trim() : "";
  if (groupId.length === 0) {
    throw Object.assign(new Error("groupId is required"), { statusCode: 400 });
  }

  const planId = typeof input.planId === "string" ? input.planId.trim() : "";
  if (planId.length === 0) {
    throw Object.assign(new Error("planId is required"), { statusCode: 400 });
  }

  const plan = resolvePlanById(planId);
  const metadata = normalizeGroupMetadata(input.metadata, { managed: input.managed ?? true });

  const pending = await createPendingStarTransaction({
    ownerTelegramId: input.ownerTelegramId,
    groupChatId: groupId,
    planId,
    gifted: Boolean(input.gifted),
    metadata: {
      title: metadata.title,
      membersCount: metadata.membersCount,
      inviteLink: metadata.inviteLink,
      photoUrl: metadata.photoUrl,
      managed: metadata.managed,
      planDays: plan.days,
      planPrice: plan.price,
      planLabel: plan.label ?? null,
    },
  });

  const invoicePayload = buildInvoicePayload(pending.transactionId);

  await patchStarTransactionMetadata(pending.transactionId, {
    planDays: plan.days,
    planPrice: plan.price,
    planLabel: plan.label ?? null,
    groupTitle: metadata.title ?? null,
    membersCount: metadata.membersCount ?? null,
    inviteLink: metadata.inviteLink ?? null,
    photoUrl: metadata.photoUrl ?? null,
    invoicePayload,
  });

  if (!isAutoCaptureEnabled()) {
    let paymentUrl = buildPaymentUrl(pending.transactionId, groupId, planId);

    try {
      const invoiceLink = await createInvoiceLink({
        title: buildInvoiceTitle(plan, metadata, Boolean(input.gifted)),
        description: buildInvoiceDescription(plan, metadata, groupId, Boolean(input.gifted)),
        payload: invoicePayload,
        currency: STARS_CURRENCY,
        prices: [
          {
            label: plan.label ?? `${plan.days} days`,
            amount: plan.price,
          },
        ],
        photoUrl: metadata.photoUrl ?? undefined,
        providerData: {
          transactionId: pending.transactionId,
          planId,
          groupId,
          gifted: Boolean(input.gifted),
        },
      });
      paymentUrl = invoiceLink;
      await patchStarTransactionMetadata(pending.transactionId, {
        invoiceLink,
      });
    } catch (error) {
      logger.error("[stars] Failed to create Telegram invoice link", error);
    }

    return {
      transactionId: pending.transactionId,
      status: "pending",
      groupId,
      planId,
      daysAdded: 0,
      expiresAt: null,
      balanceDelta: 0,
      gifted: Boolean(input.gifted),
      paymentUrl,
      message: "Awaiting Telegram payment confirmation.",
    };
  }

  return finalizeStarsPurchase(pending.transactionId, {
    metadataOverride: metadata,
  });
}

export async function finalizeStarsPurchase(
  transactionId: string,
  options: {
    metadataOverride?: GroupMetadata;
    externalId?: string | null;
    status?: "completed" | "refunded";
  } = {},
): Promise<StarsPurchaseResult> {
  const record = await findStarTransactionById(transactionId);
  if (!record) {
    throw Object.assign(new Error("Transaction not found"), { statusCode: 404 });
  }

  if (record.status === "completed" && options.status !== "refunded") {
    return {
      transactionId,
      status: "completed",
      groupId: (record.metadata as Record<string, unknown> | null)?.groupChatId?.toString?.() ?? record.group?.telegramChatId ?? null,
      planId: (record.metadata as Record<string, unknown> | null)?.planId?.toString?.() ?? "",
      daysAdded: 0,
      expiresAt: null,
      balanceDelta: 0,
      gifted: Boolean((record.metadata as Record<string, unknown> | null)?.gifted),
      paymentUrl: null,
      message: "Transaction already completed.",
    };
  }

  const metadata = options.metadataOverride ?? normalizeGroupMetadata(record.metadata ?? {});
  const metaObject = (record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata))
    ? record.metadata as Record<string, unknown>
    : {};

  const groupChatId = typeof metaObject.groupChatId === "string"
    ? metaObject.groupChatId
    : typeof metaObject.groupChatId === "number"
      ? metaObject.groupChatId.toString()
      : record.group?.telegramChatId;

  if (!groupChatId) {
    throw new Error("Transaction metadata missing group identifier");
  }

  const planId = typeof metaObject.planId === "string"
    ? metaObject.planId
    : typeof metaObject.planId === "number"
      ? metaObject.planId.toString()
      : undefined;

  if (!planId) {
    throw new Error("Transaction metadata missing plan identifier");
  }

  const gifted = Boolean(metaObject.gifted);

  await patchStarTransactionMetadata(transactionId, {
    groupTitle: metadata.title ?? null,
    membersCount: metadata.membersCount ?? null,
    inviteLink: metadata.inviteLink ?? null,
    photoUrl: metadata.photoUrl ?? null,
  });

  const plan = resolvePlanById(planId);
  if (getStarsState().balance < plan.price) {
    adjustStarsBalance(plan.price);
  }

  const outcome = applyStarsPurchase({
    transactionId,
    groupId: groupChatId,
    planId,
    gifted,
    metadata,
  });

  await completeStarTransaction({
    transactionId,
    amountDelta: -outcome.plan.price,
    planId: outcome.plan.id,
    planDays: outcome.plan.days,
    expiresAt: outcome.expiresAt,
    gifted,
    status: options.status ?? "completed",
    externalId: options.externalId ?? null,
  });

  const ownerTelegramId =
    typeof metaObject.ownerTelegramId === "string"
      ? metaObject.ownerTelegramId
      : typeof metaObject.ownerTelegramId === "number"
        ? metaObject.ownerTelegramId.toString()
        : undefined;

  if (ownerTelegramId) {
    try {
      await recordGroupCreditRenewal(ownerTelegramId, {
        transactionId,
        groupId: groupChatId,
        planId: plan.id,
        gifted,
        daysAdded: outcome.daysAdded,
      });
    } catch (error) {
      logger.warn("failed to record mission for credit renewal", { ownerTelegramId, transactionId, error });
    }

    // Check and activate referral if this is user's first purchase
    try {
      const existingTransactions = await prisma.starTransaction.count({
        where: {
          wallet: {
            user: {
              telegramId: ownerTelegramId,
            },
          },
          status: "completed",
        },
      });

      // If this is the first completed transaction, activate referral
      if (existingTransactions === 1) {
        const referral = await prisma.referral.findFirst({
          where: {
            referredUserId: ownerTelegramId,
            activatedAt: null,
          },
        });

        if (referral) {
          await prisma.referral.update({
            where: { id: referral.id },
            data: {
              activatedAt: new Date(),
              purchaseAmount: outcome.plan.price,
            },
          });

          // Import and call recordReferralActivation
          const { recordReferralActivation } = await import("./missionVerificationService.js");
          
          // Count total activated referrals for the referrer
          const totalActivated = await prisma.referral.count({
            where: {
              referrerId: referral.referrerId,
              activatedAt: { not: null },
            },
          });

          // Count activated this week and month
          const now = new Date();
          const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

          const activatedThisWeek = await prisma.referral.count({
            where: {
              referrerId: referral.referrerId,
              activatedAt: { 
                not: null,
                gte: startOfWeek,
              },
            },
          });

          const activatedThisMonth = await prisma.referral.count({
            where: {
              referrerId: referral.referrerId,
              activatedAt: { 
                not: null,
                gte: startOfMonth,
              },
            },
          });

          await recordReferralActivation({
            telegramUserId: referral.referrerId,
            activatedTotal: totalActivated,
            activatedThisWeek,
            activatedThisMonth,
          });

          logger.info("referral activated for first purchase", {
            referralId: referral.id,
            referrerId: referral.referrerId,
            referredUserId: ownerTelegramId,
            totalActivated,
          });
        }
      }
    } catch (error) {
      logger.warn("failed to process referral activation", { ownerTelegramId, transactionId, error });
    }
  }

  return {
    transactionId,
    status: options.status ?? "completed",
    groupId: outcome.group.chatId,
    planId: outcome.plan.id,
    daysAdded: outcome.daysAdded,
    expiresAt: outcome.expiresAt,
    balanceDelta: -outcome.plan.price,
    gifted,
    paymentUrl: null,
  };
}

export async function getStarsWalletSummary(
  ownerTelegramId: string | null,
  options: { limit?: number } = {},
): Promise<StarsWalletSummary> {
  const fallback: StarsWalletSummary = {
    balance: getStarsState().balance,
    currency: STARS_CURRENCY,
    totalSpent: 0,
    totalRefunded: 0,
    pendingCount: 0,
    transactions: [],
  };

  if (!ownerTelegramId) {
    return fallback;
  }

  try {
    const limit = options.limit ?? 50;
    const details = await fetchOwnerWalletDetails(ownerTelegramId, limit);
    if (!details) {
      return fallback;
    }

    const transactions: StarsTransactionEntry[] = details.transactions.map((entry) => {
      const amount = Number(entry.amount);
      const direction: StarsTransactionDirection = amount >= 0 ? "credit" : "debit";
      const planIdRaw = entry.planId;
      const planId =
        typeof planIdRaw === "string"
          ? planIdRaw
          : typeof planIdRaw === "number" && Number.isFinite(planIdRaw)
            ? planIdRaw.toString()
            : null;

      const planDays =
        typeof entry.planDays === "number" && Number.isFinite(entry.planDays) ? entry.planDays : null;
      const planPrice =
        typeof entry.planPrice === "number" && Number.isFinite(entry.planPrice) ? entry.planPrice : null;
      const planLabel =
        typeof entry.planLabel === "string" && entry.planLabel.length > 0 ? entry.planLabel : null;

      return {
        id: entry.id,
        status: entry.status as StarsTransactionEntry["status"],
        direction,
        amount,
        planId,
        planLabel,
        planDays,
        planPrice,
        groupId: entry.groupId ?? null,
        groupTitle: entry.groupTitle ?? null,
        gifted: Boolean(entry.gifted),
        createdAt: entry.createdAt,
        completedAt: entry.completedAt,
        externalId: entry.externalId ?? null,
        invoiceLink: entry.invoiceLink ?? null,
      };
    });

    let totalSpent = 0;
    let totalRefunded = 0;
    let pendingCount = 0;

    for (const transaction of transactions) {
      if (transaction.status === "pending") {
        pendingCount += 1;
      }
      if (transaction.status === "completed" && transaction.amount < 0) {
        totalSpent += Math.abs(transaction.amount);
      }
      if (transaction.status === "refunded" || transaction.amount > 0) {
        totalRefunded += transaction.amount;
      }
    }

    return {
      balance: details.balance,
      currency: details.currency ?? STARS_CURRENCY,
      totalSpent,
      totalRefunded,
      pendingCount,
      transactions,
    };
  } catch (error) {
    logger.error("[stars] Failed to load wallet summary", error);
    return fallback;
  }
}

export async function refundStarsTransaction(
  transactionId: string,
  options: { operatorTelegramId?: string; reason?: string } = {},
): Promise<StarsPurchaseResult> {
  const record = await findStarTransactionById(transactionId);
  if (!record) {
    throw Object.assign(new Error("Transaction not found"), { statusCode: 404 });
  }

  if (record.status === "refunded") {
    return {
      transactionId,
      status: "refunded",
      groupId: record.group?.telegramChatId ?? null,
      planId: (record.metadata as Record<string, unknown> | null)?.planId?.toString?.() ?? "",
      daysAdded:
        typeof (record.metadata as Record<string, unknown> | null)?.planDays === "number"
          ? ((record.metadata as Record<string, unknown>).planDays as number)
          : 0,
      expiresAt:
        typeof (record.metadata as Record<string, unknown> | null)?.expiresAt === "string"
          ? ((record.metadata as Record<string, unknown>).expiresAt as string)
          : null,
      balanceDelta:
        typeof record.amount === "number" && Number.isFinite(record.amount) ? Math.abs(record.amount) : 0,
      gifted: Boolean((record.metadata as Record<string, unknown> | null)?.gifted),
      paymentUrl: null,
      message: "Transaction already refunded.",
    };
  }

  if (record.status !== "completed") {
    throw Object.assign(new Error("Only completed transactions can be refunded"), { statusCode: 400 });
  }

  const metaObject =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {};

  const groupChatId =
    typeof metaObject.groupChatId === "string"
      ? metaObject.groupChatId
      : typeof metaObject.groupChatId === "number"
        ? metaObject.groupChatId.toString()
        : record.group?.telegramChatId;

  const planId =
    typeof metaObject.planId === "string"
      ? metaObject.planId
      : typeof metaObject.planId === "number"
        ? metaObject.planId.toString()
        : undefined;

  if (!planId) {
    throw new Error("Transaction metadata missing plan identifier");
  }

  const plan = resolvePlanById(planId);
  const gifted = Boolean(metaObject.gifted);
  const expiresAt =
    typeof metaObject.expiresAt === "string" ? metaObject.expiresAt : new Date().toISOString();

  const ownerTelegramId = record.wallet?.owner?.telegramId;
  if (!ownerTelegramId) {
    throw new Error("Transaction owner unavailable for refund");
  }

  const externalId = record.externalId;
  if (externalId) {
    const userId = Number(ownerTelegramId);
    if (!Number.isFinite(userId)) {
      throw new Error("Owner telegram id is not numeric; cannot issue refund via Telegram");
    }

    try {
      await refundStarsPayment({
        userId,
        telegramPaymentChargeId: externalId,
      });
    } catch (error) {
      logger.error("[stars] Telegram refund request failed", error);
      throw Object.assign(new Error("Unable to refund payment via Telegram"), { statusCode: 502 });
    }
  } else {
    logger.warn("[stars] Skipping Telegram refund because transaction external id is missing", { transactionId });
  }

  await completeStarTransaction({
    transactionId,
    amountDelta: plan.price,
    planId: plan.id,
    planDays: plan.days,
    expiresAt,
    gifted,
    status: "refunded",
    externalId: externalId ?? null,
  });

  adjustStarsBalance(plan.price);

  await patchStarTransactionMetadata(transactionId, {
    refundedAt: new Date().toISOString(),
    refundOperator: options.operatorTelegramId ?? null,
    refundReason: options.reason ?? null,
  });

  return {
    transactionId,
    status: "refunded",
    groupId: groupChatId ?? null,
    planId: plan.id,
    daysAdded: plan.days,
    expiresAt,
    balanceDelta: plan.price,
    gifted,
    paymentUrl: null,
    message: "Transaction refunded.",
  };
}

export async function appendStarsTransactionMetadata(
  transactionId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await patchStarTransactionMetadata(transactionId, metadata);
}
