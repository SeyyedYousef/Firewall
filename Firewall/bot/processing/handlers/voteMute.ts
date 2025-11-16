import type { UpdateHandler } from "../types.js";
import type { GroupChatContext, ProcessingAction } from "../types.js";
import { ensureActions, isGroupChat } from "../utils.js";
import { logger } from "../../../server/utils/logger.js";
import { loadGeneralSettingsByChatId } from "../../../server/db/groupSettingsRepository.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

// In-memory storage for vote mute tracking
const voteMuteData = new Map<string, {
  targetUserId: number;
  votes: Set<number>; // User IDs who voted
  requiredVotes: number;
  expiresAt: number;
  initiatedBy: number;
}>();

const VOTE_MUTE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const VOTE_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes to collect votes

function makeVoteKey(chatId: number | string, targetUserId: number): string {
  return `${chatId}:${targetUserId}`;
}

function isVoteMuteCommand(ctx: GroupChatContext): boolean {
  const message = ctx.message;
  if (!message || !("text" in message) || typeof message.text !== "string") {
    return false;
  }
  
  const text = message.text.trim().toLowerCase();
  return text === "/votemute" || text.startsWith("/votemute ");
}

function isVoteMuteReply(ctx: GroupChatContext): boolean {
  const message = ctx.message;
  if (!message || !("text" in message) || typeof message.text !== "string") {
    return false;
  }
  
  const text = message.text.trim().toLowerCase();
  return text === "mute" && Boolean(message.reply_to_message);
}

async function handleVoteMuteCommand(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const message = ctx.message as any;
  const fromUserId = message.from?.id;
  const chatId = ctx.chat.id;
  
  if (!fromUserId) {
    return [];
  }

  // Check if vote mute is enabled
  if (databaseAvailable) {
    try {
      const generalSettings = await loadGeneralSettingsByChatId(chatId.toString());
      if (!generalSettings.voteMuteEnabled) {
        return [{
          type: "send_message",
          text: "❌ Vote mute is disabled in this group.",
          parseMode: "HTML",
          autoDeleteSeconds: 10,
        }];
      }
    } catch (error) {
      logger.debug("failed to load general settings for vote mute", { chatId, error });
      return [];
    }
  }

  let targetUserId: number | undefined;
  
  // Check if replying to a message
  if (message.reply_to_message?.from?.id) {
    targetUserId = message.reply_to_message.from.id;
  } else {
    // Try to extract user ID from command
    const text = message.text.trim();
    const parts = text.split(/\s+/);
    if (parts.length > 1) {
      const userIdStr = parts[1];
      const parsedId = parseInt(userIdStr, 10);
      if (!isNaN(parsedId)) {
        targetUserId = parsedId;
      }
    }
  }

  if (!targetUserId) {
    return [{
      type: "send_message",
      text: "❌ Reply to a message or provide a user ID to start a vote mute.",
      parseMode: "HTML",
      autoDeleteSeconds: 10,
    }];
  }

  // Don't allow self-mute
  if (targetUserId === fromUserId) {
    return [{
      type: "send_message",
      text: "❌ You cannot vote to mute yourself.",
      parseMode: "HTML",
      autoDeleteSeconds: 10,
    }];
  }

  const voteKey = makeVoteKey(chatId, targetUserId);
  const now = Date.now();
  
  // Check if there's already an active vote for this user
  const existingVote = voteMuteData.get(voteKey);
  if (existingVote && existingVote.expiresAt > now) {
    return [{
      type: "send_message",
      text: `⏳ A vote to mute this user is already in progress. ${existingVote.votes.size}/${existingVote.requiredVotes} votes collected.`,
      parseMode: "HTML",
      autoDeleteSeconds: 10,
    }];
  }

  // Calculate required votes (minimum 3, or 1/3 of active members)
  const requiredVotes = Math.max(3, Math.ceil(10 / 3)); // Simplified for now
  
  // Start new vote
  voteMuteData.set(voteKey, {
    targetUserId,
    votes: new Set([fromUserId]),
    requiredVotes,
    expiresAt: now + VOTE_EXPIRY_MS,
    initiatedBy: fromUserId,
  });

  return [{
    type: "send_message",
    text: `🗳️ <b>Vote Mute Started</b>\n\nTarget: User ${targetUserId}\nVotes needed: ${requiredVotes}\nCurrent votes: 1/${requiredVotes}\n\nReply with "mute" to vote. Expires in 2 minutes.`,
    parseMode: "HTML",
    autoDeleteSeconds: 120,
  }];
}

async function handleVoteMuteReply(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const message = ctx.message as any;
  const fromUserId = message.from?.id;
  const chatId = ctx.chat.id;
  const replyToMessage = message.reply_to_message;
  
  if (!fromUserId || !replyToMessage) {
    return [];
  }

  // Check if vote mute is enabled
  if (databaseAvailable) {
    try {
      const generalSettings = await loadGeneralSettingsByChatId(chatId.toString());
      if (!generalSettings.voteMuteEnabled) {
        return [];
      }
    } catch (error) {
      logger.debug("failed to load general settings for vote mute", { chatId, error });
      return [];
    }
  }

  // Find active vote for any user
  const now = Date.now();
  let activeVote: { key: string; data: any } | null = null;
  
  for (const [key, data] of voteMuteData.entries()) {
    if (key.startsWith(`${chatId}:`) && data.expiresAt > now) {
      activeVote = { key, data };
      break;
    }
  }

  if (!activeVote) {
    return [{
      type: "send_message",
      text: "❌ No active vote mute found.",
      parseMode: "HTML",
      autoDeleteSeconds: 5,
    }];
  }

  const { key, data } = activeVote;
  
  // Don't allow voting for yourself
  if (data.targetUserId === fromUserId) {
    return [{
      type: "send_message",
      text: "❌ You cannot vote to mute yourself.",
      parseMode: "HTML",
      autoDeleteSeconds: 5,
    }];
  }

  // Check if user already voted
  if (data.votes.has(fromUserId)) {
    return [{
      type: "send_message",
      text: "❌ You have already voted.",
      parseMode: "HTML",
      autoDeleteSeconds: 5,
    }];
  }

  // Add vote
  data.votes.add(fromUserId);
  
  const actions: ProcessingAction[] = [];
  
  // Check if enough votes collected
  if (data.votes.size >= data.requiredVotes) {
    // Execute mute
    actions.push({
      type: "restrict_member",
      userId: data.targetUserId,
      permissions: {
        can_send_messages: false,
        can_send_media_messages: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      },
      untilDate: Math.floor((now + VOTE_MUTE_DURATION_MS) / 1000),
    });
    
    actions.push({
      type: "send_message",
      text: `✅ <b>Vote Mute Executed</b>\n\nUser ${data.targetUserId} has been muted for 10 minutes.\nVotes: ${data.votes.size}/${data.requiredVotes}`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    });
    
    // Clean up vote data
    voteMuteData.delete(key);
  } else {
    // Update vote count
    actions.push({
      type: "send_message",
      text: `🗳️ Vote recorded! ${data.votes.size}/${data.requiredVotes} votes collected.`,
      parseMode: "HTML",
      autoDeleteSeconds: 10,
    });
  }

  return actions;
}

export const voteMuteHandler: UpdateHandler = {
  name: "vote-mute-handler",
  matches(ctx) {
    if (!isGroupChat(ctx)) {
      return false;
    }
    return isVoteMuteCommand(ctx) || isVoteMuteReply(ctx);
  },
  async handle(ctx) {
    try {
      let actions: ProcessingAction[] = [];
      
      if (isVoteMuteCommand(ctx)) {
        actions = await handleVoteMuteCommand(ctx);
      } else if (isVoteMuteReply(ctx)) {
        actions = await handleVoteMuteReply(ctx);
      }

      return { actions: ensureActions(actions) };
    } catch (error) {
      logger.error("vote mute handler failed", {
        chatId: ctx.chat?.id,
        error,
      });
      return { actions: [] };
    }
  },
};

// Cleanup expired votes periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of voteMuteData.entries()) {
    if (data.expiresAt <= now) {
      voteMuteData.delete(key);
    }
  }
}, 30000); // Clean up every 30 seconds
