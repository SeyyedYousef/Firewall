import { logger } from "../utils/logger.js";

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN must be defined to verify Telegram memberships");
}

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

type TelegramChatMemberResponse = {
  ok: boolean;
  result?: {
    status: string;
  };
  description?: string;
};

const MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);

export async function verifyTelegramChannelMembership(userId: string, channelUsername: string): Promise<boolean> {
  const trimmedChannel = channelUsername.replace(/^@+/, "").trim();
  if (!trimmedChannel) {
    throw new Error("Channel username is required");
  }

  const numericUserId = Number.parseInt(userId, 10);
  if (!Number.isFinite(numericUserId)) {
    throw new Error("Invalid Telegram user id");
  }

  const url = new URL(`${TELEGRAM_API_BASE}/getChatMember`);
  url.searchParams.set("chat_id", `@${trimmedChannel}`);
  url.searchParams.set("user_id", numericUserId.toString(10));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    logger.warn("telegram membership lookup failed", {
      channel: trimmedChannel,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error("Unable to reach Telegram API");
  }

  const payload = (await response.json().catch(() => null)) as TelegramChatMemberResponse | null;
  if (!payload || !payload.ok || !payload.result) {
    logger.debug("telegram membership negative response", {
      channel: trimmedChannel,
      userId,
      status: response.status,
      body: payload,
    });
    return false;
  }

  const status = payload.result.status;
  return MEMBER_STATUSES.has(status);
}

