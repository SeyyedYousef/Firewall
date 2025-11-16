import type { UpdateHandler } from "../types.js";
import type { GroupChatContext, ProcessingAction } from "../types.js";
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

  return [
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
}

function buildLeaveActions(ctx: GroupChatContext): ProcessingAction[] {
  const leftMember = (ctx.message as any)?.left_chat_member;
  if (!leftMember) {
    return [];
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
  const settings = getPanelSettings();
  const freeTrialDays = Number.isFinite(settings.freeTrialDays) && settings.freeTrialDays > 0 ? settings.freeTrialDays : 15;

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

  upsertGroup({
    chatId,
    title: (ctx.chat && "title" in ctx.chat ? ctx.chat.title : undefined) ?? undefined,
    managed: true,
    adminRestricted: !hasAdminPermissions,
    adminWarningSentAt: hasAdminPermissions ? null : new Date().toISOString(),
    creditDelta: freeTrialDays,
    membersCount: membersCount > 0 ? membersCount : undefined,
    ownerId: ctx.from?.id?.toString() ?? null,
  });

  const trial = grantTrialForGroup({
    groupId: chatId,
    days: freeTrialDays,
    title: (ctx.chat && "title" in ctx.chat ? ctx.chat.title : undefined) ?? undefined,
    managed: true,
    membersCount: membersCount > 0 ? membersCount : undefined,
  });

  markAdminPermission(chatId, hasAdminPermissions, {
    warningDate: hasAdminPermissions ? null : new Date(),
  });

  if (ctx.processing) {
    ctx.processing.onboardingSent = true;
  }

  const threadId = typeof ctx.message?.message_thread_id === "number" ? ctx.message.message_thread_id : undefined;

  const actions: ProcessingAction[] = [
    {
      type: "log",
      level: "info",
      message: "bot added to group",
      details: { chatId, trialExpiresAt: trial.expiresAt, trialDays: trial.appliedDays },
    },
    ...buildOnboardingActions(ctx),
  ];

  return ensureActions(actions);
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
    actions.push(...buildLeaveActions(ctx));

    // Remove join/leave service messages if configured in general settings
    try {
      const general = await loadGeneralSettingsByChatId(ctx.chat.id.toString());
      if (general.removeJoinLeaveMessages) {
        const message = ctx.message as any;
        const hasNewMembers = Boolean(message?.new_chat_members?.length);
        const hasLeft = Boolean(message?.left_chat_member);
        if (hasNewMembers || hasLeft) {
          actions.push({ type: "delete_message", messageId: message.message_id, reason: "remove join/leave" });
        }
      }
    } catch (error) {
      logger.debug("general settings unavailable for join/leave removal", { chatId: ctx.chat.id, error });
    }
    const joinActions = await buildBotJoinActions(ctx);
    actions.push(...joinActions);

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
