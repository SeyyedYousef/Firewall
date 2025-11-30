import type { UpdateHandler } from "../types.js";
import type { GroupChatContext, ProcessingAction } from "../types.js";
import { Markup } from "telegraf";
import { ensureActions, isGroupChat } from "../utils.js";
import { logger } from "../../../server/utils/logger.js";
import { loadBotContent } from "../../content.js";
import { loadGeneralSettingsByChatId } from "../../../server/db/groupSettingsRepository.js";
import { renderTemplate, resolveUserDisplayName } from "../../templating.js";
import {
  DEFAULT_ONBOARDING_MESSAGES,
  getPanelSettings,
  grantTrialForGroup,
  markAdminPermission,
  upsertGroup,
  addUserFreeGroup,
  getUserFreeGroupCount,
  recordGroupActivity,
} from "../../state.js";
import { recordInvite } from "./mandatoryMembership.js";

const content = loadBotContent();
const databaseAvailable = Boolean(process.env.DATABASE_URL);

function hasMembershipEvent(ctx: GroupChatContext): boolean {
  const message = ctx.message;
  if (!message) {
    return false;
  }

  const hasNewMembers =
    'new_chat_members' in message &&
    Array.isArray((message as any).new_chat_members) &&
    (message as any).new_chat_members.length > 0;

  const hasLeftMember = 'left_chat_member' in message && Boolean((message as any).left_chat_member);

  return hasNewMembers || hasLeftMember;
}

async function buildWelcomeActions(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const members = (((ctx.message as any)?.new_chat_members ?? []) as any[]).filter(
    (member) => !ctx.botInfo || member.id !== ctx.botInfo.id,
  );
  if (members.length === 0) {
    return [];
  }

  // Record membership events to database for statistics
  if (databaseAvailable) {
    try {
      const { recordMembershipEvent } = await import("../../../server/db/mutateRepository.js");
      const groupTitle = ctx.chat && "title" in ctx.chat ? ctx.chat.title : undefined;
      
      // Determine inviter: if message.from is different from the member and not a bot, they're the inviter
      const messageFrom = (ctx.message as any)?.from;
      const inviterUserId = messageFrom?.id;
      const inviterIsBot = messageFrom?.is_bot;
      
      for (const member of members) {
        // If the inviter is different from the member being added, record them as inviter
        const effectiveInviter = inviterUserId && !inviterIsBot && inviterUserId !== member.id
          ? inviterUserId.toString()
          : null;
        
        await recordMembershipEvent({
          chatId: ctx.chat.id.toString(),
          userId: member.id.toString(),
          event: "join",
          payload: {
            username: member.username ?? null,
            firstName: member.first_name ?? null,
            lastName: member.last_name ?? null,
            isBot: member.is_bot ?? false,
            invitedBy: effectiveInviter,
            joinMethod: "new_chat_members",
          },
          groupTitle,
        });
      }
      logger.debug("recorded membership join events", { 
        chatId: ctx.chat.id, 
        count: members.length 
      });
    } catch (error) {
      logger.warn("failed to record membership events", { 
        chatId: ctx.chat.id, 
        error 
      });
    }
  }

  // Check if welcome messages are enabled in group settings
  if (databaseAvailable) {
    try {
      const generalSettings = await loadGeneralSettingsByChatId(ctx.chat.id.toString());
      if (!generalSettings.welcomeEnabled) {
        logger.debug("welcome messages disabled for group", { chatId: ctx.chat.id });
        return [];
      }
    } catch (error) {
      logger.debug("failed to load general settings, proceeding with welcome", { 
        chatId: ctx.chat.id, 
        error 
      });
    }
  }

  const names = members
    .map((member) => resolveUserDisplayName(member))
    .join(", ");

  const replacements = {
    user: names,
    name: names,
    group:
      ctx.chat && "title" in ctx.chat
        ? (ctx.chat.title ?? "")
        : ctx.chat && "username" in ctx.chat
        ? (ctx.chat.username ?? String(ctx.chat.id))
        : String(ctx.chat?.id ?? ""),
    count: members.length.toString(),
  };

  // Try to load custom welcome message from database
  let welcomeTemplate = content.messages.welcome ?? "Welcome to the group.";
  
  if (databaseAvailable) {
    try {
      const customTexts = await import("../../../server/db/groupSettingsRepository.js").then(
        module => module.loadCustomTextSettingsByChatId(ctx.chat.id.toString())
      );
      if (customTexts.welcomeMessage && customTexts.welcomeMessage.trim()) {
        welcomeTemplate = customTexts.welcomeMessage;
      }
    } catch (error) {
      // Fall back to default template if custom text loading fails
      logger.debug("failed to load custom welcome message, using default", { 
        chatId: ctx.chat.id, 
        error 
      });
    }
  }

  const welcomeText = renderTemplate(welcomeTemplate, replacements).trim();
  const messageBody = welcomeText.length > 0 ? welcomeText : `Welcome ${names}!`;

  const actions: ProcessingAction[] = [
    {
      type: "log",
      level: "info",
      message: "new members joined",
      details: {
        chatId: ctx.chat.id,
        members: members.map((member) => member.id),
      },
    },
    {
      type: "log",
      level: "debug",
      message: "welcome message dispatched",
      details: {
        chatId: ctx.chat.id,
      },
    },
    {
      type: "send_message",
      text: messageBody,
      parseMode: "HTML",
      autoDeleteSeconds: 60,
    },
  ];

  // Record bot action for welcome message sent
  if (databaseAvailable) {
    for (const member of members) {
      if (!member.is_bot) {
        actions.push({
          type: "record_moderation",
          ruleId: "system:welcome_message",
          userId: member.id,
          actions: ["welcome_message_sent"],
          reason: "New member joined group",
          metadata: {
            eventType: "new_chat_members",
            username: member.username ?? null,
            firstName: member.first_name ?? null,
            membersCount: members.length,
          },
        });
      }
    }
  }

  return actions;
}

async function buildLeaveActions(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const leftMember = (ctx.message as any)?.left_chat_member;
  if (!leftMember) {
    return [];
  }

  // Record membership leave event to database for statistics
  if (databaseAvailable && !leftMember.is_bot) {
    try {
      const { recordMembershipEvent } = await import("../../../server/db/mutateRepository.js");
      const groupTitle = ctx.chat && "title" in ctx.chat ? ctx.chat.title : undefined;
      
      await recordMembershipEvent({
        chatId: ctx.chat.id.toString(),
        userId: leftMember.id.toString(),
        event: "leave",
        payload: {
          username: leftMember.username ?? null,
          firstName: leftMember.first_name ?? null,
          lastName: leftMember.last_name ?? null,
        },
        groupTitle,
      });
      logger.debug("recorded membership leave event", { 
        chatId: ctx.chat.id, 
        userId: leftMember.id 
      });
    } catch (error) {
      logger.warn("failed to record membership leave event", { 
        chatId: ctx.chat.id, 
        error 
      });
    }
  }

  return [
    {
      type: "log",
      level: "info",
      message: "member left group",
      details: {
        chatId: ctx.chat.id,
        userId: leftMember.id,
      },
    },
  ];
}

function buildOnboardingActions(ctx: GroupChatContext): ProcessingAction[] {
  const settings = getPanelSettings();
  const onboarding =
    Array.isArray(settings.onboardingMessages) && settings.onboardingMessages.length > 0
      ? settings.onboardingMessages
      : Array.from(DEFAULT_ONBOARDING_MESSAGES);

  const replacements = {
    group:
      ctx.chat && "title" in ctx.chat
        ? (ctx.chat.title ?? String(ctx.chat.id))
        : ctx.chat && "username" in ctx.chat
        ? (ctx.chat.username ?? String(ctx.chat.id))
        : String(ctx.chat?.id ?? ""),
    trial_days: settings.freeTrialDays,
  };
  const threadId = typeof ctx.message?.message_thread_id === "number" ? ctx.message.message_thread_id : undefined;

  return onboarding.map((message) => ({
    type: "send_message" as const,
    text: renderTemplate(message, replacements),
    parseMode: "HTML",
    threadId,
    rescheduleOnPromotion: true,
  }));
}

async function buildBotJoinActions(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const members = ((ctx.message as any)?.new_chat_members ?? []) as any[];
  if (members.length === 0 || !ctx.botInfo) {
    return [];
  }

  const botJoined = members.some((member) => member.id === ctx.botInfo?.id);
  if (!botJoined) {
    return [];
  }

  let hasAdminPermissions = false;
  if (typeof ctx.telegram?.getChatMember === "function") {
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
      hasAdminPermissions = member.status === "administrator" || member.status === "creator";
    } catch (error) {
      logger.debug("unable to determine bot admin status on join", {
        chatId: ctx.chat.id,
        error,
      });
    }
  }

  const chatId = ctx.chat.id.toString();
  const userId = ctx.from?.id?.toString() ?? null;
  const groupTitle = (ctx.chat && "title" in ctx.chat ? ctx.chat.title : undefined) ?? `Group ${chatId}`;

  // Get current member count
  let membersCount = 0;
  if (typeof ctx.telegram?.getChatMembersCount === "function") {
    try {
      membersCount = await ctx.telegram.getChatMembersCount(ctx.chat.id);
    } catch (error) {
      logger.debug("unable to fetch members count on bot join", {
        chatId: ctx.chat.id,
        error,
      });
    }
  }

  // AUTO-ACTIVATE as FREE by default (no choice needed)
  // Update group info and activate immediately
  upsertGroup({
    chatId,
    title: groupTitle,
    managed: true, // Immediately active as FREE
    adminRestricted: !hasAdminPermissions,
    adminWarningSentAt: hasAdminPermissions ? null : new Date().toISOString(),
    membersCount: membersCount > 0 ? membersCount : undefined,
    ownerId: userId,
  });

  // Register as free group for this user
  if (userId) {
    addUserFreeGroup(userId, chatId);
  }

  markAdminPermission(chatId, hasAdminPermissions, {
    warningDate: hasAdminPermissions ? null : new Date(),
  });

  if (ctx.processing) {
    ctx.processing.onboardingSent = true;
  }

  const actions: ProcessingAction[] = [
    {
      type: "log",
      level: "info",
      message: "bot added to group - auto-activated as FREE",
      details: { chatId, userId, groupTitle },
    },
  ];

  // Send onboarding messages to the group
  const onboardingActions = buildOnboardingActions(ctx);
  actions.push(...onboardingActions);

  // Send a single comprehensive private message to the user who added the bot
  if (userId) {
    const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return char;
      }
    });

    const freeGroupCount = getUserFreeGroupCount(userId);

    const privateMessage = [
      `✅ <b>Successfully Added!</b>`,
      ``,
      `Firewall Bot is now protecting <b>${escapeHtml(groupTitle)}</b>`,
      ``,
      `━━━━━━━━━━━━━━━━━`,
      `📋 <b>Current Status:</b> 🆓 Free Plan`,
      `━━━━━━━━━━━━━━━━━`,
      ``,
      `<b>🆓 Free Plan Features:</b>`,
      `• Anti-spam protection`,
      `• User warnings & bans`,
      `• Welcome messages`,
      `• Basic moderation tools`,
      `• Occasional promotional messages`,
      ``,
      `<b>⭐ Premium Plan Features:</b>`,
      `• Everything in Free, plus:`,
      `• Vote mute system`,
      `• Auto-warning penalties`,
      `• Multiple silence windows`,
      `• Up to 3 mandatory channels`,
      `• Advanced analytics`,
      `• <b>No advertisements</b>`,
      ``,
      `━━━━━━━━━━━━━━━━━`,
      `💎 Want to unlock all features?`,
      `Go to <b>Get Premium</b> in the Mini App`,
      `to upgrade your group!`,
      `━━━━━━━━━━━━━━━━━`,
      ``,
      `📊 Your free groups: ${freeGroupCount}/3`,
    ].join('\n');

    try {
      const miniAppUrl = process.env.MINI_APP_URL;
      const keyboard = miniAppUrl 
        ? {
            inline_keyboard: [
              [{ text: '🚀 Open Mini App', url: miniAppUrl }],
              [{ text: '⭐ Get Premium', url: miniAppUrl }],
            ],
          }
        : undefined;

      await ctx.telegram.sendMessage(userId, privateMessage, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      actions.push({
        type: "log",
        level: "info",
        message: "welcome message sent to user",
        details: { userId, chatId },
      });
    } catch (error) {
      logger.warn("failed to send welcome message to user (they may not have started the bot)", {
        userId,
        chatId,
        error,
      });
    }
  }

  // Persist to database
  if (databaseAvailable && userId) {
    try {
      const { setGroupStatus, setGroupOwner } = await import("../../../server/db/mutateRepository.js");
      await setGroupStatus(chatId, "active", { title: groupTitle });
      await setGroupOwner(chatId, userId, { title: groupTitle });
      logger.info("group auto-activated as free in database", { chatId, userId });
    } catch (error) {
      logger.warn("failed to persist free group to database", { chatId, error });
    }
  }

  return ensureActions(actions);
}

async function enforceUserVerificationForNewMembers(ctx: GroupChatContext): Promise<void> {
  if (!databaseAvailable) {
    return;
  }

  const message = ctx.message as any;
  const newMembers = ((message?.new_chat_members ?? []) as any[]).filter((member) => !member?.is_bot);
  if (newMembers.length === 0) {
    return;
  }

  try {
    const general = await loadGeneralSettingsByChatId(ctx.chat.id.toString());
    if (!general.userVerificationEnabled) {
      return;
    }
  } catch (error) {
    logger.debug("user verification settings unavailable for new members", { chatId: ctx.chat.id, error });
    return;
  }

  for (const member of newMembers) {
    const rawId = (member as { id?: number | string }).id;
    const numericId = typeof rawId === "number" ? rawId : Number.parseInt(String(rawId), 10);
    if (!Number.isFinite(numericId)) {
      continue;
    }

    try {
      await ctx.telegram.restrictChatMember(
        ctx.chat.id,
        numericId,
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

      const callbackData = `fw_verify_member:${ctx.chat.id}:${numericId}`;
      const text =
        "To send messages in this group, please confirm that you are not a bot.\n\nTap the button below to verify.";

      await ctx.telegram.sendMessage(
        ctx.chat.id,
        text,
        Markup.inlineKeyboard([[Markup.button.callback("I am not a bot", callbackData)]]),
      );
    } catch (error) {
      logger.warn("failed to apply user verification restrictions", {
        chatId: ctx.chat.id,
        userId: numericId,
        error,
      });
    }
  }
}

export const membershipHandler: UpdateHandler = {
  name: "group-membership-events",
  matches(ctx) {
    return isGroupChat(ctx) && hasMembershipEvent(ctx);
  },
  async handle(ctx) {
    const actions: ProcessingAction[] = [];
    const welcomeActions = await buildWelcomeActions(ctx);
    actions.push(...welcomeActions);
    const leaveActions = await buildLeaveActions(ctx);
    actions.push(...leaveActions);

    // Remove join/leave service messages if configured in general settings
    try {
      const general = await loadGeneralSettingsByChatId(ctx.chat.id.toString());
      if (general.removeJoinLeaveMessages) {
        const message = ctx.message as any;
        const hasNewMembers = Boolean(message?.new_chat_members?.length);
        const hasLeft = Boolean(message?.left_chat_member);
        if (hasNewMembers || hasLeft) {
          actions.push({ type: "delete_message", messageId: message.message_id });
        }
      }
    } catch (error) {
      logger.debug("general settings unavailable for join/leave removal", { chatId: ctx.chat.id, error });
    }
    const joinActions = await buildBotJoinActions(ctx);
    actions.push(...joinActions);

    await enforceUserVerificationForNewMembers(ctx);

    if (databaseAvailable) {
      await persistMembershipEvents(ctx);
      await recordInviteCredits(ctx);
    }

    if (actions.length === 0) {
      return { actions: ensureActions([{ type: "log", level: "debug", message: "membership handler no-op" }]) };
    }
    return { actions: ensureActions(actions) };
  },
};

async function persistMembershipEvents(ctx: GroupChatContext): Promise<void> {
  try {
    const { recordMembershipEvent } = await import("../../../server/db/mutateRepository.js");
    const chatId = ctx.chat.id.toString();

    const newMembers = ((ctx.message as any)?.new_chat_members ?? []) as any[];
    const inviterUserId = (ctx.message as any)?.from?.id;
    const inviterIsBot = (ctx.message as any)?.from?.is_bot;
    const inviterIsBotSelf = ctx.botInfo && inviterUserId === ctx.botInfo.id;
    const inviterValid = inviterUserId && !inviterIsBot && !inviterIsBotSelf;
    for (const member of newMembers) {
      await recordMembershipEvent({
        chatId,
        userId: member.id.toString(),
        event: "join",
        groupTitle: "title" in ctx.chat ? ctx.chat.title : null,
        payload: {
          username: member.username ?? null,
          firstName: member.first_name ?? null,
          lastName: member.last_name ?? null,
          isBot: member.is_bot ?? false,
          invitedBy:
            inviterValid && !member.is_bot
              ? (typeof inviterUserId === "number" ? inviterUserId.toString() : String(inviterUserId))
              : null,
        },
      });
    }

    const leftMember = (ctx.message as any)?.left_chat_member;
    if (leftMember) {
      await recordMembershipEvent({
        chatId,
        userId: leftMember.id.toString(),
        event: "leave",
        groupTitle: "title" in ctx.chat ? ctx.chat.title : null,
        payload: {
          username: leftMember.username ?? null,
          firstName: leftMember.first_name ?? null,
          lastName: leftMember.last_name ?? null,
          isBot: leftMember.is_bot ?? false,
        },
      });
    }
  } catch (error) {
    logger.warn("failed to persist membership events", { chatId: ctx.chat?.id, error });
  }
}

async function recordInviteCredits(ctx: GroupChatContext): Promise<void> {
  try {
    // Check if this is a new member join event
    const newMembers = ((ctx.message as any)?.new_chat_members ?? []) as any[];
    if (newMembers.length === 0) {
      return;
    }

    // We need to find who invited these members
    // In Telegram, the "from" field of the new_chat_members message is typically the person who added them
    const inviterUserId = (ctx.message as any)?.from?.id;
    if (!inviterUserId) {
      return;
    }

    // Don't credit the bot itself or bots
    if (ctx.botInfo && inviterUserId === ctx.botInfo.id) {
      return;
    }

    const inviterIsBot = (ctx.message as any)?.from?.is_bot;
    if (inviterIsBot) {
      return;
    }

    // Record invite credit for each new non-bot member
    const realNewMembers = newMembers.filter(member => !member.is_bot);
    for (const member of realNewMembers) {
      recordInvite(ctx.chat.id, inviterUserId);
    }

    logger.info("invite credits recorded", { 
      chatId: ctx.chat.id, 
      inviterUserId, 
      newMembersCount: realNewMembers.length 
    });

  } catch (error) {
    logger.warn("failed to record invite credits", { chatId: ctx.chat?.id, error });
  }
}
