import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../../utils/logger.js";
import { resolveBooleanEnv } from "../../utils/env.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const MAX_AGE_SECONDS = Number.parseInt(process.env.API_INITDATA_MAX_AGE ?? "3600", 10);
const NODE_ENV = (process.env.NODE_ENV ?? "production").toLowerCase();
const IS_PRODUCTION = NODE_ENV === "production";
const SKIP_TELEGRAM_AUTH = resolveBooleanEnv("SKIP_TELEGRAM_AUTH", !IS_PRODUCTION);

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable must be set before using Telegram authentication middleware");
}

logger.info("telegram init middleware configured", {
  botTokenPreview: BOT_TOKEN.slice(0, 10),
  maxAgeSeconds: MAX_AGE_SECONDS,
});

class VerifySignatureError extends Error {
  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "VerifySignatureError";
  }
}

type TelegramUserPayload = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  is_premium?: boolean;
  is_bot?: boolean;
};

type TelegramInitContext = {
  userId: string;
  user: TelegramUserPayload;
  rawInitData: string;
  chat?: {
    id: number;
    type?: string;
    title?: string;
  };
};

declare module "express-serve-static-core" {
  interface Request {
    telegramAuth?: TelegramInitContext;
  }
}

function getRawInitData(req: Request): string | null {
  const headerValue = req.header("x-telegram-init-data") ?? req.header("X-Telegram-Init-Data");
  if (headerValue && typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  const queryValue = typeof req.query.initData === "string" ? req.query.initData.trim() : null;
  if (queryValue && queryValue.length > 0) {
    return queryValue;
  }
  return null;
}

function computeSecretKey(): Buffer {
  return crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN!).digest();
}

function verifySignature(
  rawInitData: string,
): { params: URLSearchParams; receivedHash: string; computedHash: string } {
  const params = new URLSearchParams(rawInitData);
  const receivedHash = params.get("hash");
  if (!receivedHash) {
    throw new VerifySignatureError("InitData missing hash parameter");
  }
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secretKey = computeSecretKey();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computedHash !== receivedHash) {
    throw new VerifySignatureError("InitData signature mismatch", {
      receivedHash: receivedHash.slice(0, 12),
      computedHash: computedHash.slice(0, 12),
    });
  }

  logger.debug("telegram init signature verified", {
    receivedHash: receivedHash.slice(0, 12),
    computedHash: computedHash.slice(0, 12),
  });

  return { params, receivedHash, computedHash };
}

function parseInitData(params: URLSearchParams): TelegramInitContext {
  const userRaw = params.get("user");
  if (!userRaw) {
    throw new Error("InitData missing user payload");
  }

  let user: TelegramUserPayload;
  try {
    user = JSON.parse(userRaw) as TelegramUserPayload;
  } catch {
    throw new Error("Failed to parse user payload");
  }

  if (!user.id) {
    throw new Error("InitData user payload missing id");
  }

  const authDate = Number.parseInt(params.get("auth_date") ?? "0", 10);
  if (Number.isNaN(authDate) || authDate <= 0) {
    throw new Error("InitData contains invalid auth_date");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  logger.debug("telegram init auth_date parsed", {
    authDate,
    ageSeconds: nowSeconds - authDate,
    maxAgeAllowed: MAX_AGE_SECONDS,
  });
  if (nowSeconds - authDate > MAX_AGE_SECONDS) {
    throw new Error("InitData has expired");
  }

  const chatPayload = params.get("chat_instance") && params.get("chat")
    ? safeParseChat(params.get("chat")!)
    : undefined;

  return {
    user,
    userId: user.id.toString(),
    rawInitData: params.toString(),
    chat: chatPayload,
  };
}

function safeParseChat(rawChat: string): TelegramInitContext["chat"] {
  try {
    const parsed = JSON.parse(rawChat) as { id: number; type?: string; title?: string };
    if (!parsed || typeof parsed.id !== "number") {
      return undefined;
    }
    return {
      id: parsed.id,
      type: parsed.type,
      title: parsed.title,
    };
  } catch {
    return undefined;
  }
}

export function requireTelegramInitData() {
  return (req: Request, res: Response, next: NextFunction) => {
    const rawInitData = getRawInitData(req);
    logger.debug("telegram init request received", {
      hasInitData: Boolean(rawInitData),
      source: rawInitData
        ? req.header("x-telegram-init-data") || req.header("X-Telegram-Init-Data")
          ? "header"
          : typeof req.query.initData === "string"
            ? "query"
            : "unknown"
        : "none",
    });
    if (!rawInitData) {
      if (SKIP_TELEGRAM_AUTH) {
        const fallbackUserId = Number.parseInt(process.env.BOT_OWNER_ID ?? "1", 10) || 1;
        const mockContext: TelegramInitContext = {
          userId: fallbackUserId.toString(),
          user: {
            id: fallbackUserId,
            first_name: process.env.MOCK_TELEGRAM_FIRST_NAME ?? "Development User",
            username: process.env.MOCK_TELEGRAM_USERNAME ?? undefined,
          },
          rawInitData: "skipped-auth-missing-initdata",
        };
        logger.warn("telegram init auth bypassed due to missing init data", {
          mode: NODE_ENV,
          userId: mockContext.userId,
        });
        req.telegramAuth = mockContext;
        next();
        return;
      }
      res.status(401).json({ error: "Missing Telegram init data" });
      return;
    }

    try {
      const verification = verifySignature(rawInitData);
      const context = parseInitData(verification.params);
      req.telegramAuth = {
        ...context,
        rawInitData,
      };
      next();
    } catch (error) {
      const details =
        error instanceof VerifySignatureError
          ? error.details
          : undefined;
      if (SKIP_TELEGRAM_AUTH) {
        const fallbackUserId = Number.parseInt(process.env.BOT_OWNER_ID ?? "1", 10) || 1;
        const mockContext: TelegramInitContext = {
          userId: fallbackUserId.toString(),
          user: {
            id: fallbackUserId,
            first_name: process.env.MOCK_TELEGRAM_FIRST_NAME ?? "Development User",
            username: process.env.MOCK_TELEGRAM_USERNAME ?? undefined,
          },
          rawInitData: rawInitData ?? "skipped-auth-invalid",
        };
        logger.warn("telegram init validation failed but was bypassed", {
          error: error instanceof Error ? error.message : String(error),
          details,
          mode: NODE_ENV,
          userId: mockContext.userId,
        });
        req.telegramAuth = mockContext;
        next();
        return;
      }
      logger.warn("telegram init validation failed", {
        error: error instanceof Error ? error.message : String(error),
        details,
      });
      res.status(401).json({ error: "Invalid Telegram init data" });
    }
  };
}
