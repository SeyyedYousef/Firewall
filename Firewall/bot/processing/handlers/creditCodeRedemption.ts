import type { UpdateHandler } from "../types.js";
import type { GroupChatContext, ProcessingAction } from "../types.js";
import { ensureActions, isGroupChat } from "../utils.js";
import { logger } from "../../../server/utils/logger.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

function isCreditCodeCommand(ctx: GroupChatContext): boolean {
  const message = ctx.message;
  if (!message || !("text" in message) || typeof message.text !== "string") {
    return false;
  }
  
  const text = message.text.trim().toLowerCase();
  return text.startsWith("/redeem ") || text.startsWith("/credit ");
}

async function handleCreditCodeRedemption(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const message = ctx.message as any;
  const fromUserId = message.from?.id;
  const chatId = ctx.chat.id;
  
  if (!fromUserId) {
    return [];
  }

  const text = message.text.trim();
  const parts = text.split(/\s+/);
  
  if (parts.length < 2) {
    return [{
      type: "send_message",
      text: "❌ Please provide a credit code. Usage: `/redeem CODE` or `/credit CODE`",
      parseMode: "HTML",
      autoDeleteSeconds: 10,
    }];
  }

  const creditCode = parts[1].toUpperCase();
  
  try {
    // Import credit code functions
    const { findCreditCode, useCreditCode } = await import("../../state.js");
    
    const code = findCreditCode(creditCode);
    if (!code) {
      return [{
        type: "send_message",
        text: "❌ Invalid credit code. Please check the code and try again.",
        parseMode: "HTML",
        autoDeleteSeconds: 10,
      }];
    }

    if (!code.isActive) {
      return [{
        type: "send_message",
        text: "❌ This credit code has been disabled.",
        parseMode: "HTML",
        autoDeleteSeconds: 10,
      }];
    }

    if (code.expiresAt && new Date(code.expiresAt) < new Date()) {
      return [{
        type: "send_message",
        text: "❌ This credit code has expired.",
        parseMode: "HTML",
        autoDeleteSeconds: 10,
      }];
    }

    if (code.usageCount >= code.maxUses) {
      return [{
        type: "send_message",
        text: "❌ This credit code has reached its usage limit.",
        parseMode: "HTML",
        autoDeleteSeconds: 10,
      }];
    }

    // Check if user already used this code
    if (code.usedBy.includes(fromUserId.toString())) {
      return [{
        type: "send_message",
        text: "❌ You have already used this credit code.",
        parseMode: "HTML",
        autoDeleteSeconds: 10,
      }];
    }

    // Use the credit code
    const success = useCreditCode(creditCode, fromUserId.toString());
    
    if (!success) {
      return [{
        type: "send_message",
        text: "❌ Failed to redeem credit code. Please try again.",
        parseMode: "HTML",
        autoDeleteSeconds: 10,
      }];
    }

    // Apply credit to group if in group chat
    if (databaseAvailable) {
      try {
        const { upsertGroup } = await import("../../state.js");
        
        // Add days to group credit
        upsertGroup({
          chatId: chatId.toString(),
          title: ctx.chat && "title" in ctx.chat ? ctx.chat.title : undefined,
          creditDelta: code.days,
          managed: true,
        });

        logger.info("credit code redeemed successfully", {
          chatId,
          userId: fromUserId,
          creditCode,
          daysAdded: code.days,
        });

      } catch (error) {
        logger.error("failed to apply credit code to group", {
          chatId,
          userId: fromUserId,
          creditCode,
          error,
        });
      }
    }

    return [{
      type: "send_message",
      text: `✅ <b>Credit Code Redeemed!</b>\n\n🎁 You have successfully redeemed <b>${code.days} days</b> of credit.\n\nCode: <code>${creditCode}</code>\nRemaining uses: ${code.maxUses - code.usageCount}/${code.maxUses}`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];

  } catch (error) {
    logger.error("credit code redemption failed", {
      chatId,
      userId: fromUserId,
      creditCode,
      error,
    });

    return [{
      type: "send_message",
      text: "❌ An error occurred while redeeming the credit code. Please try again later.",
      parseMode: "HTML",
      autoDeleteSeconds: 10,
    }];
  }
}

export const creditCodeRedemptionHandler: UpdateHandler = {
  name: "credit-code-redemption",
  matches(ctx) {
    if (!isGroupChat(ctx)) {
      return false;
    }
    return isCreditCodeCommand(ctx);
  },
  async handle(ctx) {
    try {
      const actions = await handleCreditCodeRedemption(ctx);
      return { actions: ensureActions(actions) };
    } catch (error) {
      logger.error("credit code redemption handler failed", {
        chatId: ctx.chat?.id,
        error,
      });
      return { actions: [] };
    }
  },
};
