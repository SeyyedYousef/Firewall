import { Prisma } from "@prisma/client";
import { prisma } from "./client.js";
import { logger } from "../utils/logger.js";
import { withPrismaRetry } from "./utils/prismaRetry.js";

export type GroupStateSnapshot = {
  chatId: string;
  title: string;
  creditBalance: number;
  inviteLink: string | null;
  managed: boolean;
};

async function upsertGroupCore(record: GroupStateSnapshot): Promise<void> {
  const status = record.creditBalance > 0 ? "active" : "expired";
  const credit = new Prisma.Decimal(record.creditBalance || 0);

  await prisma.group.upsert({
    where: { telegramChatId: record.chatId },
    create: {
      telegramChatId: record.chatId,
      title: record.title,
      status,
      creditBalance: credit,
      inviteLink: record.inviteLink ?? undefined,
    },
    update: {
      title: record.title,
      status,
      creditBalance: credit,
      inviteLink: record.inviteLink ?? undefined,
    },
  });
}

export async function upsertGroupFromState(record: GroupStateSnapshot): Promise<void> {
  await withPrismaRetry(() => upsertGroupCore(record), "upsertGroupFromState");
}

async function ensureGroupRecord(chatId: string, title?: string): Promise<string> {
  return withPrismaRetry(async () => {
    const existing = await prisma.group.findUnique({
      where: { telegramChatId: chatId },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const created = await prisma.group.create({
      data: {
        telegramChatId: chatId,
        title: title && title.trim().length > 0 ? title : `Group ${chatId}`,
        status: "unknown",
        creditBalance: new Prisma.Decimal(0),
      },
      select: { id: true },
    });
    return created.id;
  }, "ensureGroupRecord");
}

export async function promotePanelAdmin(telegramId: string): Promise<void> {
  await withPrismaRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { telegramId } });
        if (!existing) {
          await tx.user.create({
            data: {
              telegramId,
              role: "panel_admin",
            },
          });
          return;
        }

        if (existing.role === "owner" || existing.role === "panel_admin") {
          return;
        }

        await tx.user.update({
          where: { telegramId },
          data: { role: "panel_admin" },
        });
      }),
    "promotePanelAdmin",
  );
}

export async function demotePanelAdmin(telegramId: string): Promise<void> {
  await withPrismaRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { telegramId } });
        if (!existing || existing.role === "owner" || existing.role !== "panel_admin") {
          return;
        }

        await tx.user.update({
          where: { telegramId },
          data: { role: "user" },
        });
      }),
    "demotePanelAdmin",
  );
}

async function ensureOwnerWallet(tx: Prisma.TransactionClient, ownerTelegramId: string) {
  const owner = await tx.user.upsert({
    where: { telegramId: ownerTelegramId },
    update: {},
    create: {
      telegramId: ownerTelegramId,
      role: "owner",
    },
  });

  const wallet = await tx.starsWallet.upsert({
    where: { ownerId: owner.id },
    create: {
      ownerId: owner.id,
      balance: 0,
    },
    update: {},
  });

  return { owner, wallet };
}

type OwnerClient = Prisma.TransactionClient;

async function resolveOwnerWallet(
  client: OwnerClient,
  ownerTelegramId: string,
): Promise<{ wallet: { id: string } }> {
  const { wallet } = await ensureOwnerWallet(client, ownerTelegramId);
  return { wallet };
}

type JsonRecord = Prisma.JsonObject;

function mergeMetadata(existing: Prisma.JsonValue | null | undefined, merged: JsonRecord): JsonRecord {
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return {
      ...(existing as JsonRecord),
      ...merged,
    };
  }
  return merged;
}

function extractTelemetry(source: Prisma.JsonValue | JsonRecord | null | undefined): JsonRecord[] {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return [];
  }
  const raw = (source as Record<string, unknown>).telemetry;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => {
      const eventValue = typeof entry.event === "string" ? entry.event : "unknown";
      const timestampValue = typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString();
      const payloadValue = (entry as Record<string, unknown>).payload;
      const normalizedPayload =
        payloadValue === null ||
        typeof payloadValue === "string" ||
        typeof payloadValue === "number" ||
        typeof payloadValue === "boolean" ||
        Array.isArray(payloadValue) ||
        (payloadValue && typeof payloadValue === "object")
          ? (payloadValue as Prisma.JsonValue)
          : null;
      return {
        event: eventValue,
        timestamp: timestampValue,
        payload: normalizedPayload,
      } as JsonRecord;
    });
}

function appendTelemetryEntry(
  existing: Prisma.JsonValue | null | undefined,
  merged: JsonRecord,
  event: string,
  payload?: JsonRecord,
): JsonRecord {
  const baseline = extractTelemetry(merged);
  const fallback = baseline.length > 0 ? baseline : extractTelemetry(existing);
  const telemetry = [...fallback, { event, timestamp: new Date().toISOString(), payload: payload ?? null } as JsonRecord];
  return {
    ...merged,
    telemetry,
  };
}

export type StarsTransactionPendingInput = {
  ownerTelegramId: string;
  groupChatId?: string | null;
  planId: string;
  gifted: boolean;
  metadata?: JsonRecord;
};

export async function createPendingStarTransaction(input: StarsTransactionPendingInput): Promise<{ transactionId: string }> {
  return withPrismaRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const { wallet } = await resolveOwnerWallet(tx, input.ownerTelegramId);
        const group = input.groupChatId
          ? await tx.group.findUnique({ where: { telegramChatId: input.groupChatId } })
          : null;

        const baseMetadata = mergeMetadata(input.metadata, {
          planId: input.planId,
          gifted: input.gifted,
          groupChatId: input.groupChatId ?? null,
          ownerTelegramId: input.ownerTelegramId,
        });
        const metadataWithTelemetry = appendTelemetryEntry(
          input.metadata ?? null,
          baseMetadata,
          "transaction.created",
          {
            planId: input.planId,
            gifted: input.gifted,
            groupChatId: input.groupChatId ?? null,
            ownerTelegramId: input.ownerTelegramId,
          } as Prisma.JsonObject,
        );

        const record = await tx.starTransaction.create({
          data: {
            walletId: wallet.id,
            groupId: group?.id ?? null,
            type: input.gifted ? "gift" : "purchase",
            amount: 0,
            status: "pending",
              metadata: metadataWithTelemetry as unknown as Prisma.InputJsonValue,
          },
        });

        return { transactionId: record.id };
      }),
    "createPendingStarTransaction",
  );
}

export async function patchStarTransactionMetadata(transactionId: string, metadata: Record<string, unknown>): Promise<void> {
  await withPrismaRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.starTransaction.findUnique({
          where: { id: transactionId },
          select: { metadata: true },
        });
        if (!existing) {
          throw new Error(`Star transaction ${transactionId} not found`);
        }

        const merged = mergeMetadata(existing.metadata, metadata as JsonRecord);
        const metadataWithTelemetry = appendTelemetryEntry(
          existing.metadata,
          merged,
          "metadata.append",
          metadata as Prisma.JsonObject,
        );
        await tx.starTransaction.update({
          where: { id: transactionId },
          data: {
              metadata: metadataWithTelemetry as unknown as Prisma.InputJsonValue,
          },
        });
      }),
    "patchStarTransactionMetadata",
  );
}

export type StarsTransactionCompletionInput = {
  transactionId: string;
  amountDelta: number;
  planId: string;
  expiresAt: string;
  gifted: boolean;
  status?: "completed" | "refunded";
  externalId?: string | null;
  planDays?: number;
};

export async function completeStarTransaction(input: StarsTransactionCompletionInput): Promise<void> {
  await withPrismaRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.starTransaction.findUnique({
          where: { id: input.transactionId },
        });

        if (!existing) {
          throw new Error(`Star transaction ${input.transactionId} not found`);
        }

        if (existing.status === "completed" && input.status !== "refunded") {
          return;
        }

        if (existing.status === "refunded") {
          throw new Error(`Star transaction ${input.transactionId} already refunded`);
        }

        const wallet = await tx.starsWallet.update({
          where: { id: existing.walletId },
          data: {
            balance: {
              increment: input.amountDelta,
            },
          },
          select: { balance: true },
        });

        const status = input.status ?? "completed";
        const planDetails: JsonRecord = {
          planId: input.planId,
          expiresAt: input.expiresAt,
          gifted: input.gifted,
          planPrice: Math.abs(input.amountDelta),
        };
        if (typeof input.planDays === "number" && Number.isFinite(input.planDays)) {
          planDetails.planDays = input.planDays;
        }
        const mergedMetadata = mergeMetadata(existing.metadata, planDetails);
        const telemetryPayload = {
          amountDelta: input.amountDelta,
          planId: input.planId,
          planDays: typeof input.planDays === "number" ? input.planDays : null,
          expiresAt: input.expiresAt,
          gifted: input.gifted,
          status,
          externalId: input.externalId ?? existing.externalId ?? null,
          walletBalance: wallet.balance,
        } as Prisma.JsonObject;
        const metadataWithTelemetry = appendTelemetryEntry(
          existing.metadata,
          mergedMetadata,
          status === "refunded" ? "transaction.refunded" : "transaction.completed",
          telemetryPayload,
        );

        await tx.starTransaction.update({
          where: { id: input.transactionId },
          data: {
            amount: input.amountDelta,
            status,
            externalId: input.externalId ?? existing.externalId,
            completedAt: new Date(),
            metadata: metadataWithTelemetry,
          },
        });
      }),
    "completeStarTransaction",
  );
}

export async function recordStarsPurchaseInDb(
  input: StarsTransactionCompletionInput & { groupChatId: string; ownerTelegramId: string },
): Promise<void> {
  await withPrismaRetry(
    async () => {
      const existing = await prisma.starTransaction.findUnique({
        where: { id: input.transactionId },
      });

      if (!existing) {
        const pending = await createPendingStarTransaction({
          ownerTelegramId: input.ownerTelegramId,
          groupChatId: input.groupChatId,
          planId: input.planId,
          gifted: input.gifted,
          metadata: {
            legacy: true,
          },
        });
        await completeStarTransaction({
          transactionId: pending.transactionId,
          amountDelta: input.amountDelta,
          planId: input.planId,
          planDays: input.planDays,
          expiresAt: input.expiresAt,
          gifted: input.gifted,
          status: input.status,
          externalId: input.externalId,
        });
        return;
      }

      await completeStarTransaction(input);
    },
    "recordStarsPurchaseInDb",
  );
}

export type PromoSlideSnapshot = {
  id: string;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  imageUrl: string;
  thumbnailUrl?: string | null;
  thumbnailStorageKey?: string | null;
  storageKey?: string | null;
  originalFileId?: string | null;
  contentType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  checksum?: string | null;
  accentColor?: string | null;
  linkUrl?: string | null;
  ctaLabel?: string | null;
  ctaLink?: string | null;
  position?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  active?: boolean;
  abTestGroupId?: string | null;
  variant?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
};

export async function upsertPromoSlide(snapshot: PromoSlideSnapshot): Promise<void> {
  logger.info("promo slide upsert", { id: snapshot.id, variant: snapshot.variant, active: snapshot.active });
  await withPrismaRetry(
    () =>
      prisma.promoSlide.upsert({
        where: {
          id: snapshot.id,
        },
        create: {
          id: snapshot.id,
      title: snapshot.title,
      subtitle: snapshot.subtitle,
      description: snapshot.description,
      imageUrl: snapshot.imageUrl,
      thumbnailUrl: snapshot.thumbnailUrl,
      thumbnailStorageKey: snapshot.thumbnailStorageKey ?? null,
      storageKey: snapshot.storageKey,
      originalFileId: snapshot.originalFileId,
      contentType: snapshot.contentType,
      fileSize: snapshot.fileSize ?? null,
      width: snapshot.width ?? null,
      height: snapshot.height ?? null,
      checksum: snapshot.checksum,
      accentColor: snapshot.accentColor ?? "#0f172a",
      linkUrl: snapshot.linkUrl,
      ctaLabel: snapshot.ctaLabel,
      ctaLink: snapshot.ctaLink,
      position: snapshot.position ?? 0,
      startsAt: snapshot.startsAt ?? null,
      endsAt: snapshot.endsAt ?? null,
      active: snapshot.active ?? true,
      abTestGroupId: snapshot.abTestGroupId,
      variant: snapshot.variant,
      createdBy: snapshot.createdBy,
            metadata: (snapshot.metadata ?? {}) as unknown as Prisma.InputJsonValue,
    },
    update: {
      title: snapshot.title,
      subtitle: snapshot.subtitle,
      description: snapshot.description,
      imageUrl: snapshot.imageUrl,
      thumbnailUrl: snapshot.thumbnailUrl,
      thumbnailStorageKey: snapshot.thumbnailStorageKey ?? null,
      storageKey: snapshot.storageKey,
      originalFileId: snapshot.originalFileId,
      contentType: snapshot.contentType,
      fileSize: snapshot.fileSize ?? null,
      width: snapshot.width ?? null,
      height: snapshot.height ?? null,
      checksum: snapshot.checksum,
      accentColor: snapshot.accentColor ?? "#0f172a",
      linkUrl: snapshot.linkUrl,
      ctaLabel: snapshot.ctaLabel,
      ctaLink: snapshot.ctaLink,
      position: snapshot.position ?? 0,
      startsAt: snapshot.startsAt ?? null,
      endsAt: snapshot.endsAt ?? null,
      active: snapshot.active ?? true,
      abTestGroupId: snapshot.abTestGroupId,
          variant: snapshot.variant,
            metadata: (snapshot.metadata ?? {}) as unknown as Prisma.InputJsonValue,
        },
      }),
    "upsertPromoSlide",
  );
}

export async function deletePromoSlide(id: string): Promise<void> {
  logger.info("promo slide delete", { id });
  await withPrismaRetry(async () => {
    try {
      await prisma.promoSlide.delete({
        where: { id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return;
      }
      throw error;
    }
  }, "deletePromoSlide");
}

export async function addPanelBan(telegramId: string, reason?: string, createdBy?: string): Promise<void> {
  await withPrismaRetry(
    () =>
      prisma.panelBan.upsert({
        where: {
          telegramId,
        },
        create: {
          telegramId,
          reason,
          createdBy,
        },
        update: {
          reason,
          createdBy,
        },
      }),
    "addPanelBan",
  );
}

export async function removePanelBan(telegramId: string): Promise<void> {
  await withPrismaRetry(async () => {
    try {
      await prisma.panelBan.delete({
        where: { telegramId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return;
      }
      throw error;
    }
  }, "removePanelBan");
}

export type ModerationActionDbInput = {
  chatId: string;
  userId?: string | null;
  actorId?: string | null;
  action: string;
  severity?: string | null;
  reason?: string | null;
  metadata?: Prisma.JsonValue;
  groupTitle?: string | null;
};

export async function recordModerationAction(input: ModerationActionDbInput): Promise<void> {
  await withPrismaRetry(async () => {
    const groupId = await ensureGroupRecord(input.chatId, input.groupTitle ?? undefined);
    await prisma.moderationAction.create({
      data: {
        groupId,
        userId: input.userId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        severity: input.severity ?? null,
        reason: input.reason ?? null,
  metadata: input.metadata as unknown as Prisma.InputJsonValue,
      },
    });
  }, "recordModerationAction");
}

export type MembershipEventDbInput = {
  chatId: string;
  userId: string;
  event: "join" | "leave";
  payload?: Prisma.JsonValue;
  groupTitle?: string | null;
};

export async function recordMembershipEvent(input: MembershipEventDbInput): Promise<void> {
  await withPrismaRetry(async () => {
    const groupId = await ensureGroupRecord(input.chatId, input.groupTitle ?? undefined);
    await prisma.membershipEvent.create({
      data: {
        groupId,
        userId: input.userId,
        event: input.event,
  payload: input.payload as unknown as Prisma.InputJsonValue,
      },
    });
  }, "recordMembershipEvent");
}

export async function setGroupStatus(chatId: string, status: string, options: { title?: string | null } = {}): Promise<void> {
  await withPrismaRetry(async () => {
    const groupId = await ensureGroupRecord(chatId, options.title ?? undefined);
    await prisma.group.update({
      where: { id: groupId },
      data: {
        status,
      },
    });
  }, "setGroupStatus");
}

export async function setGroupOwner(chatId: string, ownerTelegramId: string, options: { title?: string | null } = {}): Promise<void> {
  await withPrismaRetry(async () => {
    const groupId = await ensureGroupRecord(chatId, options.title ?? undefined);
    
    // Ensure user exists
    const user = await prisma.user.upsert({
      where: { telegramId: ownerTelegramId },
      update: {},
      create: {
        telegramId: ownerTelegramId,
        role: "user",
      },
    });

    // Update group owner
    await prisma.group.update({
      where: { id: groupId },
      data: {
        ownerId: user.id,
      },
    });
  }, "setGroupOwner");
}
export async function findStarTransactionById(id: string) {
  return withPrismaRetry(
    () =>
      prisma.starTransaction.findUnique({
        where: { id },
        include: {
          group: {
            select: {
              telegramChatId: true,
              title: true,
            },
          },
          wallet: {
            include: {
              owner: {
                select: {
                  telegramId: true,
                },
              },
            },
          },
        },
      }),
    "findStarTransactionById",
  );
}
