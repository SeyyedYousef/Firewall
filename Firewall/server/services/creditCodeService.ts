import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "../db/client.js";
import { sendTelegramMessage } from "../utils/telegramBotApi.js";
import { logger } from "../utils/logger.js";

const DEFAULT_CODE_LENGTH = 12;
const CODE_PREFIX = (process.env.CREDIT_CODE_PREFIX ?? "FW").toUpperCase();
const CODE_SEGMENT_LENGTH = 4;

const UPPER_ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ"; // avoid easily-confused chars
const DIGITS = "23456789";
const CODE_ALPHABET = `${UPPER_ALPHA}${DIGITS}`;
const CODE_REGEX = new RegExp(`${CODE_PREFIX}-[A-Z0-9]{${CODE_SEGMENT_LENGTH}}(?:-[A-Z0-9]{${CODE_SEGMENT_LENGTH}})+`, "i");

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generatePlainCode(length = DEFAULT_CODE_LENGTH): string {
  const chars: string[] = [];
  const bytes = randomBytes(length);
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[index]!;
    const symbol = CODE_ALPHABET[byte % CODE_ALPHABET.length]!;
    chars.push(symbol);
  }
  const segmented = [];
  for (let start = 0; start < chars.length; start += CODE_SEGMENT_LENGTH) {
    segmented.push(chars.slice(start, start + CODE_SEGMENT_LENGTH).join(""));
  }
  return `${CODE_PREFIX}-${segmented.join("-")}`;
}

export type CreditCodeIssueInput = {
  profileId: string;
  telegramUserId: string;
  valueDays: number;
  metadata?: Record<string, unknown>;
};

export type CreditCodeIssueResult = {
  code: string;
  redeemed: boolean;
};

type PrismaClientOrTx = Prisma.TransactionClient | typeof prisma;

export async function issueCreditCode(
  input: CreditCodeIssueInput,
  prismaClient: PrismaClientOrTx = prisma,
): Promise<CreditCodeIssueResult> {
  if (!Number.isFinite(input.valueDays) || input.valueDays <= 0) {
    throw new Error("Credit code value must be a positive number of days");
  }

  const metadata = input.metadata ?? {};
  let attempts = 0;
  while (attempts < 5) {
    attempts += 1;
    const plainCode = generatePlainCode();
    const codeHash = hashCode(plainCode);
    try {
      await prismaClient.creditRedemptionCode.create({
        data: {
          codeHash,
          valueDays: Math.trunc(input.valueDays),
          issuedToProfileId: input.profileId,
          status: "active",
          metadata: (metadata as Prisma.JsonValue) ?? Prisma.JsonNull,
        },
      });

      return {
        code: plainCode,
        redeemed: false,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" /* unique constraint */
      ) {
        logger.warn("credit code collision detected, regenerating", { attempt: attempts });
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unable to generate unique credit code after multiple attempts");
}

type CreditCodeNotification = {
  telegramUserId: string;
  code: string;
  valueDays: number;
};

export async function notifyUserOfCreditCode(payload: CreditCodeNotification): Promise<void> {
  const numericId = Number(payload.telegramUserId);
  if (!Number.isFinite(numericId)) {
    throw new Error("Telegram user id must be numeric to deliver credit code DM");
  }

  const message =
    `🎁 <b>Your Firewall credit code is ready!</b>\n\n` +
    `Code: <code>${payload.code}</code>\n` +
    `Value: ${payload.valueDays} day${payload.valueDays === 1 ? "" : "s"} of uptime.\n\n` +
    `Send this code in a group where Firewall is an admin to apply the credit immediately. ` +
    `The code becomes invalid once redeemed.`;

  await sendTelegramMessage({
    chatId: numericId,
    text: message,
    parseMode: "HTML",
  });
}

export type CreditCodeRedemptionResult = {
  redeemed: boolean;
  valueDays: number;
  groupId: string;
};

export async function redeemCreditCode(options: {
  code: string;
  groupTelegramId: string;
  actorTelegramId: string;
}): Promise<CreditCodeRedemptionResult> {
  const normalizedCode = options.code.trim().toUpperCase();
  const hashed = hashCode(normalizedCode);
  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.creditRedemptionCode.findUnique({
      where: { codeHash: hashed },
      include: {
        redeemedGroup: true,
      },
      lock: { mode: "ForUpdate" },
    });
    if (!record) {
      throw assignStatus(new Error("Code not found"), 404);
    }
    if (record.status !== "active") {
      throw assignStatus(new Error("Code has already been used or expired"), 409);
    }

    const actorProfile = await tx.userProfile.findUnique({
      where: { telegramUserId: options.actorTelegramId },
      select: { id: true },
    });
    if (!actorProfile) {
      throw assignStatus(new Error("You need to open the Mini App before redeeming codes."), 403);
    }
    if (actorProfile.id !== record.issuedToProfileId) {
      throw assignStatus(new Error("This code belongs to a different user."), 403);
    }

    const group = await tx.group.upsert({
      where: { telegramChatId: options.groupTelegramId },
      create: {
        telegramChatId: options.groupTelegramId,
        title: options.groupTelegramId,
        status: "active",
        creditBalance: new Prisma.Decimal(record.valueDays),
      },
      update: {
        creditBalance: { increment: new Prisma.Decimal(record.valueDays) },
        status: "active",
      },
      select: { id: true },
    });

    await tx.creditRedemptionCode.update({
      where: { codeHash: hashed },
      data: {
        status: "redeemed",
        redeemedAt: new Date(),
        redeemedGroupId: group.id,
        metadata: mergeRedemptionMetadata(record.metadata, {
          redeemedBy: options.actorTelegramId,
          redeemedGroup: options.groupTelegramId,
        }),
      },
    });

    return {
      valueDays: record.valueDays,
      groupId: group.id,
    };
  });

  return {
    redeemed: true,
    valueDays: result.valueDays,
    groupId: result.groupId,
  };
}

function mergeRedemptionMetadata(
  existing: Prisma.JsonValue | null | undefined,
  append: Record<string, unknown>,
): Prisma.JsonValue {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return append as Prisma.JsonValue;
  }
  return {
    ...(existing as Record<string, unknown>),
    ...append,
  } as Prisma.JsonValue;
}

export function maskCreditCode(code: string): string {
  const trimmed = code.replace(/\s+/g, "");
  if (trimmed.length <= 4) {
    return "****";
  }
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

export const CREDIT_CODE_PREFIX = CODE_PREFIX;
export const CREDIT_CODE_PATTERN = CODE_REGEX;

export function extractCreditCode(text: string): string | null {
  const match = text.toUpperCase().match(CODE_REGEX);
  if (!match) {
    return null;
  }
  return match[0]!.toUpperCase();
}

function assignStatus<T extends Error>(error: T, statusCode: number): T & { statusCode: number } {
  return Object.assign(error, { statusCode });
}
