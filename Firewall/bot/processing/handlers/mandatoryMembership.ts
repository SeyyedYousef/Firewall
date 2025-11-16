import type { UpdateHandler } from "../types.js";
import type { GroupChatContext, ProcessingAction } from "../types.js";
import { ensureActions, isGroupChat } from "../utils.js";
import { logger } from "../../../server/utils/logger.js";
import { loadMandatoryMembershipSettingsByChatId, loadCustomTextSettingsByChatId } from "../../../server/db/groupSettingsRepository.js";
import { renderTemplate, resolveUserDisplayName } from "../../templating.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

// In-memory storage for invite counts and verification status
const inviteCounts = new Map<string, number>(); // chatId:userId -> count
const lastInviteReset = new Map<string, number>(); // chatId:userId -> timestamp
const channelMembershipCache = new Map<string, { isVerified: boolean; lastCheck: number }>(); // chatId:userId -> status

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache for channel membership

function makeInviteKey(chatId: number | string, userId: number | string): string {
  return `${chatId}:${userId}`;
}

function makeChannelKey(chatId: number | string, userId: number | string): string {
  return `${chatId}:${userId}`;
}

async function checkChannelMembership(
  ctx: GroupChatContext,
  userId: number,
  requiredChannels: string[]
): Promise<boolean> {
  if (requiredChannels.length === 0) {
    return true; // No requirements = always pass
  }

  const cacheKey = makeChannelKey(ctx.chat.id, userId);
  const cached = channelMembershipCache.get(cacheKey);
  const now = Date.now();

  // Use cached result if recent
  if (cached && (now - cached.lastCheck) < CACHE_TTL_MS) {
    return cached.isVerified;
  }

  // Check membership in all required channels
  let isVerified = true;
  for (const channel of requiredChannels) {
    try {
      await ctx.telegram.getChatMember(channel, userId);
      // If no error, user is a member
    } catch (error) {
      // User is not a member of this channel
      isVerified = false;
      break;
    }
  }

  // Cache the result
  channelMembershipCache.set(cacheKey, { isVerified, lastCheck: now });
  return isVerified;
}

function checkInviteRequirements(
  chatId: number,
  userId: number,
  requiredCount: number,
  resetDays: number
): { hasMetRequirement: boolean; currentCount: number } {
  if (requiredCount <= 0) {
    return { hasMetRequirement: true, currentCount: 0 };
  }

  const inviteKey = makeInviteKey(chatId, userId);
  const currentCount = inviteCounts.get(inviteKey) ?? 0;
  const lastReset = lastInviteReset.get(inviteKey) ?? 0;
  const now = Date.now();

  // Check if reset period has passed
  if (resetDays > 0 && lastReset > 0) {
    const resetInterval = resetDays * 24 * 60 * 60 * 1000;
    if (now - lastReset > resetInterval) {
      // Reset the counter
      inviteCounts.set(inviteKey, 0);
      lastInviteReset.set(inviteKey, now);
      return { hasMetRequirement: false, currentCount: 0 };
    }
  }

  const hasMetRequirement = currentCount >= requiredCount;
  return { hasMetRequirement, currentCount };
}

export function recordInvite(chatId: number, inviterUserId: number): void {
  const inviteKey = makeInviteKey(chatId, inviterUserId);
  const currentCount = inviteCounts.get(inviteKey) ?? 0;
  inviteCounts.set(inviteKey, currentCount + 1);

  // Set initial reset timestamp if not exists
  const resetKey = makeInviteKey(chatId, inviterUserId);
  if (!lastInviteReset.has(resetKey)) {
    lastInviteReset.set(resetKey, Date.now());
  }

  logger.info("invite recorded", { chatId, inviterUserId, newCount: currentCount + 1 });
}

async function buildMandatoryMembershipViolationActions(
  ctx: GroupChatContext,
  violationType: 'channel' | 'invite',
  settings: any,
  customTexts: any,
  userInfo: { currentCount?: number; requiredCount?: number; requiredChannels?: string[] }
): Promise<ProcessingAction[]> {
  const userId = (ctx.message as any)?.from?.id;
  const userName = resolveUserDisplayName((ctx.message as any)?.from);
  
  if (!userId) return [];

  const actions: ProcessingAction[] = [];

  // Delete the message
  if (ctx.message?.message_id) {
    actions.push({
      type: "delete_message",
      messageId: ctx.message.message_id,
      reason: `mandatory ${violationType} requirement not met`
    });
  }

  // Send appropriate warning message
  let messageTemplate = "";
  const replacements: Record<string, string> = {
    user: userName,
    group: ctx.chat && "title" in ctx.chat ? (ctx.chat.title ?? "") : String(ctx.chat?.id ?? ""),
  };

  if (violationType === 'invite') {
    messageTemplate = customTexts.forcedInviteMessage || 
      "{user}\nYou need to invite {number} new member(s) before you can send messages.\nYou have invited {added} so far.";
    
    replacements.number = String(userInfo.requiredCount ?? 0);
    replacements.added = String(userInfo.currentCount ?? 0);
  } else {
    messageTemplate = customTexts.mandatoryChannelMessage || 
      "Please join the required channel(s) below before sending messages:\n{channel_names}";
    
    replacements.channel_names = (userInfo.requiredChannels ?? []).join("\n");
  }

  const warningText = renderTemplate(messageTemplate, replacements);

  actions.push({
    type: "send_message",
    text: warningText,
    parseMode: "HTML",
    replyToMessageId: ctx.message?.message_id,
    autoDeleteSeconds: 30
  });

  // Log the violation
  actions.push({
    type: "log",
    level: "info",
    message: `mandatory ${violationType} requirement violation`,
    details: {
      chatId: ctx.chat.id,
      userId,
      violationType,
      ...userInfo
    }
  });

  return actions;
}

function hasUserMessage(ctx: GroupChatContext): boolean {
  const message = ctx.message;
  if (!message) return false;
  
  // Check if message has a user (not service message)
  const from = (message as any)?.from;
  if (!from || from.is_bot) return false;

  // Check if it's an actual content message
  const text = (message as any)?.text;
  const hasMedia = Boolean(
    (message as any)?.photo || 
    (message as any)?.video || 
    (message as any)?.document || 
    (message as any)?.sticker || 
    (message as any)?.voice || 
    (message as any)?.audio
  );

  return Boolean(text) || hasMedia;
}

export const mandatoryMembershipHandler: UpdateHandler = {
  name: "mandatory-membership-enforcement",
  matches(ctx) {
    return isGroupChat(ctx) && hasUserMessage(ctx);
  },
  async handle(ctx) {
    if (!databaseAvailable) {
      return { actions: ensureActions([]) };
    }

    const userId = (ctx.message as any)?.from?.id as number | undefined;
    if (!userId) {
      return { actions: ensureActions([]) };
    }

    const chatId = ctx.chat.id.toString();

    try {
      // Load mandatory membership settings
      const [mandatorySettings, customTexts] = await Promise.all([
        loadMandatoryMembershipSettingsByChatId(chatId),
        loadCustomTextSettingsByChatId(chatId)
      ]);

      const actions: ProcessingAction[] = [];

      // Check invite requirements
      if (mandatorySettings.forcedInviteCount > 0) {
        const { hasMetRequirement, currentCount } = checkInviteRequirements(
          ctx.chat.id,
          userId,
          mandatorySettings.forcedInviteCount,
          mandatorySettings.forcedInviteResetDays
        );

        if (!hasMetRequirement) {
          const violationActions = await buildMandatoryMembershipViolationActions(
            ctx,
            'invite',
            mandatorySettings,
            customTexts,
            {
              currentCount,
              requiredCount: mandatorySettings.forcedInviteCount
            }
          );
          actions.push(...violationActions);
        }
      }

      // Check channel membership requirements
      if (mandatorySettings.mandatoryChannels.length > 0 && actions.length === 0) {
        const isChannelMembershipValid = await checkChannelMembership(
          ctx,
          userId,
          mandatorySettings.mandatoryChannels
        );

        if (!isChannelMembershipValid) {
          const violationActions = await buildMandatoryMembershipViolationActions(
            ctx,
            'channel',
            mandatorySettings,
            customTexts,
            {
              requiredChannels: mandatorySettings.mandatoryChannels
            }
          );
          actions.push(...violationActions);
        }
      }

      return { actions: ensureActions(actions) };

    } catch (error) {
      logger.error("mandatory membership enforcement failed", { 
        chatId, 
        userId, 
        error 
      });
      return { actions: ensureActions([]) };
    }
  },
};
