import type { UpdateHandler } from "../types.js";
import type { GroupChatContext, ProcessingAction } from "../types.js";
import { Markup } from "telegraf";
import { ensureActions, isGroupChat } from "../utils.js";
import { logger } from "../../../server/utils/logger.js";
import { loadBotContent } from "../../content.js";
import { loadGeneralSettingsByChatId } from "../../../server/db/groupSettingsRepository.js";
import { renderTemplate, resolveUserDisplayName } from "../../templating.js";

const content = loadBotContent();
const databaseAvailable = Boolean(process.env.DATABASE_URL);

type ChatMemberStatus =
  | "creator"
  | "administrator"
  | "member"
  | "restricted"
  | "left"
  | "kicked";

/**
 * Check if this is a chat_member update (for regular users, not the bot)
 */
function hasChatMemberUpdate(ctx: GroupChatContext): boolean {
  // Check for chat_member update in the context
  const update = ctx.update as any;
  if (!update || typeof update !== "object") {
    return false;
  }

  // chat_member update is for regular users joining/leaving
  // my_chat_member is for the bot itself (handled by myChatMemberHandler)
  if (!("chat_member" in update)) {
    return false;
  }

  const chatMember = update.chat_member;
  if (!chatMember) {
    return false;
  }

  // Make sure this is not about the bot itself
  const newMember = chatMember.new_chat_member;
  if (!newMember || !newMember.user) {
    return false;
  }

  // Check if the user is the bot itself
  if (ctx.botInfo && newMember.user.id === ctx.botInfo.id) {
    return false;
  }

  return true;
}

/**
 * Determine if the status transition represents a user joining
 */
function isJoinTransition(oldStatus: ChatMemberStatus | undefined, newStatus: ChatMemberStatus | undefined): boolean {
  const wasNotMember = !oldStatus || oldStatus === "left" || oldStatus === "kicked";
  const isNowMember = newStatus === "member" || newStatus === "administrator" || newStatus === "creator" || newStatus === "restricted";
  return wasNotMember && isNowMember;
}

/**
 * Determine if the status transition represents a user leaving
 */
function isLeaveTransition(oldStatus: ChatMemberStatus | undefined, newStatus: ChatMemberStatus | undefined): boolean {
  const wasMember = oldStatus === "member" || oldStatus === "administrator" || oldStatus === "creator" || oldStatus === "restricted";
  const isNotMember = newStatus === "left" || newStatus === "kicked";
  return wasMember && isNotMember;
}

/**
 * Handler for chat_member updates (regular users joining/leaving via invite links, etc.)
 * This handles the modern Telegram API way of receiving membership changes.
 */
export const chatMemberHandler: UpdateHandler = {
  name: "chat-member-updates",
  matches(ctx) {
    return isGroupChat(ctx) && hasChatMemberUpdate(ctx);
  },
  async handle(ctx) {
    const update = ctx.update as any;
    const chatMember = update.chat_member;

    if (!chatMember) {
      return { actions: ensureActions([]) };
    }

    const oldStatus = chatMember.old_chat_member?.status as ChatMemberStatus | undefined;
    const newStatus = chatMember.new_chat_member?.status as ChatMemberStatus | undefined;
    const user = chatMember.new_chat_member?.user;

    if (!user) {
      return { actions: ensureActions([]) };
    }

    const chatId = ctx.chat.id.toString();
    const actions: ProcessingAction[] = [];

    // Handle user joining
    if (isJoinTransition(oldStatus, newStatus)) {
      logger.info("chat_member: user joined group", {
        chatId,
        userId: user.id,
        username: user.username,
        oldStatus,
        newStatus,
      });

      // Record membership event to database
      if (databaseAvailable && !user.is_bot) {
        try {
          const { recordMembershipEvent } = await import("../../../server/db/mutateRepository.js");
          const groupTitle = ctx.chat && "title" in ctx.chat ? ctx.chat.title : undefined;
          const inviterUserId = chatMember.from?.id;
          const inviterIsBot = chatMember.from?.is_bot;

          await recordMembershipEvent({
            chatId,
            userId: user.id.toString(),
            event: "join",
            payload: {
              username: user.username ?? null,
              firstName: user.first_name ?? null,
              lastName: user.last_name ?? null,
              isBot: user.is_bot ?? false,
              invitedBy: inviterUserId && !inviterIsBot ? inviterUserId.toString() : null,
              joinMethod: "chat_member_update",
            },
            groupTitle,
          });
          logger.debug("recorded chat_member join event", { chatId, userId: user.id });
        } catch (error) {
          logger.warn("failed to record chat_member join event", { chatId, error });
        }
      }

      // Send welcome message if enabled
      if (databaseAvailable && !user.is_bot) {
        try {
          const generalSettings = await loadGeneralSettingsByChatId(chatId);

          if (!generalSettings.welcomeEnabled) {
            logger.debug("welcome messages disabled for group (chat_member)", { chatId });
          } else {
            // Build welcome message
            const userDisplayName = resolveUserDisplayName(user);
            const groupTitle = ctx.chat && "title" in ctx.chat ? ctx.chat.title : String(ctx.chat.id);

            const replacements = {
              user: userDisplayName,
              name: userDisplayName,
              group: groupTitle,
              count: "1",
            };

            // Try to load custom welcome message
            let welcomeTemplate = content.messages.welcome ?? "Welcome to the group.";
            try {
              const { loadCustomTextSettingsByChatId } = await import("../../../server/db/groupSettingsRepository.js");
              const customTexts = await loadCustomTextSettingsByChatId(chatId);
              if (customTexts.welcomeMessage && customTexts.welcomeMessage.trim()) {
                welcomeTemplate = customTexts.welcomeMessage;
              }
            } catch (error) {
              logger.debug("failed to load custom welcome message (chat_member), using default", { chatId, error });
            }

            const welcomeText = renderTemplate(welcomeTemplate, replacements).trim();
            const messageBody = welcomeText.length > 0 ? welcomeText : `Welcome ${userDisplayName}!`;

            actions.push({
              type: "send_message",
              text: messageBody,
              parseMode: "HTML",
              autoDeleteSeconds: 60,
            });

            // Record the welcome message as a bot action
            actions.push({
              type: "record_moderation",
              ruleId: "system:welcome_message",
              userId: user.id,
              actions: ["welcome_message_sent"],
              reason: "New member joined via invite link",
              metadata: {
                eventType: "chat_member_join",
                username: user.username ?? null,
                firstName: user.first_name ?? null,
              },
            });

            logger.info("sending welcome message for chat_member join", { chatId, userId: user.id });
          }
        } catch (error) {
          logger.debug("failed to check welcome settings (chat_member)", { chatId, error });
        }
      }

      // Apply user verification if mode is "all" (verify existing group members)
      if (databaseAvailable && !user.is_bot) {
        try {
          const generalSettings = await loadGeneralSettingsByChatId(chatId);
          const rawSettings = generalSettings as Record<string, unknown>;
          const verificationMode = (rawSettings.userVerificationMode as string) ?? "disabled";

          // Only apply in-group verification for "all" mode
          if (verificationMode === "all") {
            // Restrict the user until they verify
            await ctx.telegram.restrictChatMember(
              ctx.chat.id,
              user.id,
              {
                permissions: {
                  can_send_messages: false,
                  can_send_audios: false,
                  can_send_documents: false,
                  can_send_photos: false,
                  can_send_videos: false,
                  can_send_video_notes: false,
                  can_send_voice_notes: false,
                  can_send_polls: false,
                  can_invite_users: false,
                  can_pin_messages: false,
                  can_manage_topics: false,
                  can_change_info: false,
                  can_add_web_page_previews: false,
                },
              } as any,
            );

            const callbackData = `fw_verify_member:${ctx.chat.id}:${user.id}`;
            const userDisplayName = resolveUserDisplayName(user);
            const verificationText =
              `🔒 <b>Verification Required</b>\n\n` +
              `Hello <b>${userDisplayName}</b>, to send messages in this group you must confirm you're not a bot.\n\n` +
              `<i>Verification type (captcha) is a simple question.\nBots usually cannot answer it accurately.</i>`;

            await ctx.telegram.sendMessage(
              ctx.chat.id,
              verificationText,
              {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("🤖 I am not a robot", callbackData)]]),
              },
            );

            logger.info("user verification applied for chat_member join", {
              chatId,
              userId: user.id,
            });

            // Record this as a bot action
            actions.push({
              type: "record_moderation",
              ruleId: "system:user_verification",
              userId: user.id,
              actions: ["user_verification_applied"],
              reason: "New member requires verification",
              metadata: {
                eventType: "chat_member_join",
                username: user.username ?? null,
              },
            });
          }
        } catch (error) {
          logger.warn("failed to apply user verification (chat_member)", {
            chatId,
            userId: user.id,
            error,
          });
        }
      }

      actions.push({
        type: "log",
        level: "info",
        message: "new member joined via chat_member update",
        details: {
          chatId,
          userId: user.id,
          username: user.username,
        },
      });
    }

    // Handle user leaving
    if (isLeaveTransition(oldStatus, newStatus)) {
      logger.info("chat_member: user left group", {
        chatId,
        userId: user.id,
        username: user.username,
        oldStatus,
        newStatus,
      });

      // Record membership event to database
      if (databaseAvailable && !user.is_bot) {
        try {
          const { recordMembershipEvent } = await import("../../../server/db/mutateRepository.js");
          const groupTitle = ctx.chat && "title" in ctx.chat ? ctx.chat.title : undefined;

          await recordMembershipEvent({
            chatId,
            userId: user.id.toString(),
            event: "leave",
            payload: {
              username: user.username ?? null,
              firstName: user.first_name ?? null,
              lastName: user.last_name ?? null,
              leaveMethod: newStatus === "kicked" ? "kicked" : "left",
            },
            groupTitle,
          });
          logger.debug("recorded chat_member leave event", { chatId, userId: user.id });
        } catch (error) {
          logger.warn("failed to record chat_member leave event", { chatId, error });
        }
      }

      actions.push({
        type: "log",
        level: "info",
        message: "member left via chat_member update",
        details: {
          chatId,
          userId: user.id,
          leaveType: newStatus,
        },
      });
    }

    if (actions.length === 0) {
      return {
        actions: ensureActions([
          {
            type: "log",
            level: "debug",
            message: "chat_member update processed (no action)",
            details: { chatId, oldStatus, newStatus },
          },
        ]),
      };
    }

    return { actions: ensureActions(actions) };
  },
};
