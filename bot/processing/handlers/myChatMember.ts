import type { UpdateHandler } from "../types.js";
import type { GroupChatContext, ProcessingAction } from "../types.js";
import { ensureActions, isGroupChat } from "../utils.js";
import {
  drainPendingOnboardingMessages,
  markAdminPermission,
  upsertGroup,
} from "../../state.js";
import { logger } from "../../../server/utils/logger.js";

type ChatMemberStatus =
  | "creator"
  | "administrator"
  | "member"
  | "restricted"
  | "left"
  | "kicked";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

function isActivationStatus(status: ChatMemberStatus | undefined): boolean {
  return status === "member" || status === "administrator" || status === "creator";
}

function isRemovalStatus(status: ChatMemberStatus | undefined): boolean {
  return status === "left" || status === "kicked";
}

export const myChatMemberHandler: UpdateHandler = {
  name: "bot-chat-member-updates",
  matches(ctx) {
    return isGroupChat(ctx) && (Boolean(ctx.myChatMember) || (ctx.update && typeof ctx.update === "object" && "my_chat_member" in ctx.update));
  },
  async handle(ctx) {
    if (!isGroupChat(ctx)) {
      return { actions: ensureActions([]) };
    }

    function hasMyChatMember(u: unknown): u is { my_chat_member: any } {
      return !!u && typeof u === "object" && "my_chat_member" in (u as Record<string, unknown>);
    }

    const update = ctx.myChatMember ?? (hasMyChatMember(ctx.update) ? (ctx.update as any).my_chat_member : undefined);
    if (!update) {
      return { actions: ensureActions([{ type: "log", level: "debug", message: "my_chat_member update missing payload" }]) };
    }

    const newStatus = update.new_chat_member?.status as ChatMemberStatus | undefined;
    const oldStatus = update.old_chat_member?.status as ChatMemberStatus | undefined;
    const chatId = ctx.chat.id.toString();
    const fromUserId = update.from?.id?.toString() ?? null;

    if (isRemovalStatus(newStatus)) {
      upsertGroup({
        chatId,
        title: "title" in ctx.chat ? ctx.chat.title : undefined,
        managed: false,
        adminRestricted: true,
        adminWarningSentAt: new Date().toISOString(),
      });
      markAdminPermission(chatId, false, { warningDate: new Date() });
      if (databaseAvailable) {
        try {
          const { setGroupStatus } = await import("../../../server/db/mutateRepository.js");
          const title = "title" in ctx.chat ? (ctx.chat.title ?? null) : null;
          await setGroupStatus(chatId, "removed", { title });
        } catch (error) {
          logger.warn("failed to persist removed group status", { chatId, error });
        }
      }
      return {
        actions: ensureActions([
          {
            type: "log",
            level: "info",
            message: "bot removed from group",
            details: { chatId, oldStatus, newStatus },
          },
        ]),
      };
    }

    if (!isActivationStatus(newStatus)) {
      return {
        actions: ensureActions([
          {
            type: "log",
            level: "debug",
            message: "my_chat_member update ignored",
            details: { chatId, oldStatus, newStatus },
          },
        ]),
      };
    }

    const alreadyMember = isActivationStatus(oldStatus);

    // Get current member count
    let membersCount: number | undefined;
    if (typeof ctx.telegram?.getChatMembersCount === "function") {
      try {
        membersCount = await ctx.telegram.getChatMembersCount(ctx.chat.id);
      } catch (error) {
        logger.debug("unable to fetch members count on status change", {
          chatId,
          error,
        });
      }
    }

    upsertGroup({
      chatId,
      title: "title" in ctx.chat ? ctx.chat.title : undefined,
      managed: true,
      adminRestricted: newStatus !== "administrator" && newStatus !== "creator",
      adminWarningSentAt: null,
      membersCount: membersCount && membersCount > 0 ? membersCount : undefined,
      ownerId: !alreadyMember && fromUserId ? fromUserId : undefined,
    });

    markAdminPermission(chatId, newStatus === "administrator" || newStatus === "creator", {
      warningDate: newStatus === "administrator" || newStatus === "creator" ? null : new Date(),
    });

    if (databaseAvailable) {
      try {
        const { setGroupStatus, setGroupOwner } = await import("../../../server/db/mutateRepository.js");
        const title = "title" in ctx.chat ? (ctx.chat.title ?? null) : null;
        await setGroupStatus(chatId, "active", { title });
        
        // Set group owner if this is a new addition (not already a member)
        if (!alreadyMember && fromUserId) {
          try {
            await setGroupOwner(chatId, fromUserId, { title });
            logger.info("group owner set successfully", { chatId, ownerId: fromUserId });
          } catch (ownerError) {
            logger.warn("failed to set group owner", { chatId, ownerId: fromUserId, error: ownerError });
          }
        }
      } catch (error) {
        logger.warn("failed to persist active group status", { chatId, error });
      }
    }

    const actions: ProcessingAction[] = [
      {
        type: "log",
        level: "info",
        message: "bot membership updated",
        details: { chatId, oldStatus, newStatus },
      },
    ];

    if (!alreadyMember && (newStatus === "administrator" || newStatus === "creator")) {
      actions.push({
        type: "log",
        level: "info",
        message: "bot promoted with admin rights",
        details: { chatId },
      });
    }

    if (newStatus === "administrator" || newStatus === "creator") {
      const queued = drainPendingOnboardingMessages(chatId);
      if (queued.length > 0) {
        actions.push({
          type: "log",
          level: "info",
          message: "sending queued onboarding messages after promotion",
          details: { chatId, count: queued.length },
        });
        queued.forEach((entry) => {
          actions.push({
            type: "send_message",
            text: entry.text,
            parseMode: entry.parseMode,
            threadId: entry.threadId,
          });
        });
      }
    }

    return { actions: ensureActions(actions) };
  },
};
