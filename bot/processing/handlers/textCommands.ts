/**
 * Text Commands Handler
 * 
 * Handles admin text commands in groups (prefixed with ! or .)
 * Commands are in English for international use.
 */

import type { Message } from "typegram";
import type { UpdateHandler, ProcessingAction, GroupChatContext } from "../types.js";
import { ensureActions, isGroupChat } from "../utils.js";
import { logger } from "../../../server/utils/logger.js";
import { isGroupPremium } from "../../state.js";
import {
  saveBanSettingsByChatId,
  loadBanSettingsByChatId,
  saveGeneralSettingsByChatId,
  loadGeneralSettingsByChatId,
  saveSilenceSettingsByChatId,
  loadSilenceSettingsByChatId,
  saveMandatoryMembershipSettingsByChatId,
  loadMandatoryMembershipSettingsByChatId,
  saveGroupCountLimitSettingsByChatId,
  loadLimitSettingsByChatId,
  saveCustomTextSettingsByChatId,
  loadCustomTextSettingsByChatId,
  type BanRuleKey,
  type GroupBanSettingsRecord,
  type GroupGeneralSettingsRecord,
  type SilenceSettingsRecord,
  type MandatoryMembershipSettingsRecord,
  type GroupCountLimitSettingsRecord,
  type CustomTextSettingsRecord,
} from "../../../server/db/groupSettingsRepository.js";

const COMMAND_PREFIX = /^[!.]/;
const databaseAvailable = Boolean(process.env.DATABASE_URL);

// Command response messages

const RESPONSES = {
  notAdmin: "⚠️ Only group admins can use this command.",
  success: "✅ Setting updated successfully.",
  error: "❌ Failed to update setting. Please try again.",
  invalidFormat: "❌ Invalid command format.",
  replyRequired: "❌ Please reply to a user's message to use this command.",
  userBanned: "✅ User has been banned for {duration}.",
  userMuted: "✅ User has been muted for {duration}.",
  userUnmuted: "✅ User restrictions have been removed.",
  warningsReset: "✅ User warnings have been reset.",
  whitelistAdded: "✅ User added to whitelist.",
  whitelistRemoved: "✅ User removed from whitelist.",
  whitelistCleared: "✅ Whitelist has been cleared.",
  lockEnabled: "🔒 {feature} is now locked.",
  lockDisabled: "🔓 {feature} is now unlocked.",
  silenceEnabled: "🌙 Quiet hours enabled: {start} to {end}",
  silenceDisabled: "☀️ Quiet hours disabled.",
  groupLocked: "🔒 Group is now locked. Only admins can send messages.",
  groupUnlocked: "🔓 Group is now unlocked.",
  creditInfo: "💳 Group credit: {days} days remaining.",
  renewLink: "💳 To renew your subscription, use the bot's panel.",
  filterAdded: "✅ Word '{word}' added to filter list.",
  filterRemoved: "✅ Word '{word}' removed from filter list.",
  filterList: "📋 Filtered words:\n{words}",
  filterEmpty: "📋 No words in filter list.",
  purgeStarted: "🗑️ Purging {count} messages...",
  purgeComplete: "✅ Purged {count} messages.",
  configReloaded: "✅ Admin list reloaded.",
  statsHeader: "📊 Top inviters:",
  noStats: "📊 No invitation statistics available.",
  featureDisabled: "⚠️ This feature is disabled.",
  permanentDuration: "permanently",
  // Force Join responses
  forceJoinEnabled: "✅ Force Join enabled. Users must join {channel} before chatting.",
  forceJoinDisabled: "❌ Force Join has been disabled.",
  forceJoinNoChannel: "⚠️ No channel configured.\n\nUsage: !ForceJoin @channelname",
  forceJoinInvalidChannel: "❌ Invalid format.\n\nUsage: !ForceJoin @channelname\n\nExamples:\n• !ForceJoin @mychannel\n• !ForceJoin on (if channel already set)\n• !ForceJoin off (disable)",
  forceJoinTextUpdated: "✅ Force Join message has been updated.",
  forceJoinTextReset: "✅ Force Join message has been reset to default.",
  forceJoinPromptText: "📝 <b>Set Force Join Message</b>\n\n<b>Current message:</b>\n{text}\n\n<b>Available variables:</b>\n• <code>{user}</code> - User's name\n• <code>{channel_names}</code> - Channel list\n\n⌨️ Reply to this message with your new text.",
  forceJoinStatus: "📊 <b>Force Join Status</b>\n\n• <b>Status:</b> {status}\n• <b>Channel(s):</b> {channels}\n• <b>Custom Text:</b> {has_custom_text}\n\n📢 <b>Current Message:</b>\n{message}",
  // Force Add responses
  premiumRequired: "⭐ <b>Premium Feature</b>\n\nThis feature is only available for Premium groups.\n\n<i>Upgrade to Premium to unlock all features.</i>",
  forceAddEnabled: "✅ Force Add has been enabled.\n\nUsers must add <b>{count}</b> members before chatting.",
  forceAddDisabled: "❌ Force Add has been disabled.",
  forceAddCountSet: "✅ Force Add count set to <b>{count}</b> members.",
  forceAddTimeSet: "✅ Force Add message auto-delete time set to <b>{time}</b> minutes.",
  forceAddTimeDisabled: "❌ Force Add message auto-delete has been disabled.",
  forceAddTextPrompt: "📝 <b>Set Force Add Message</b>\n\n<b>Current message:</b>\n{text}\n\n<b>Available variables:</b>\n• <code>{user}</code> - User's name\n• <code>{needadd}</code> or <code>{number}</code> - Required count\n• <code>{remainadd}</code> - Remaining count\n• <code>{useradd}</code> or <code>{added}</code> - Current adds\n\n⌨️ Reply to this message with your new text.\nSend <code>default</code> to reset.",
  forceAddTextUpdated: "✅ Force Add message has been updated.",
  forceAddTextReset: "✅ Force Add message has been reset to default.",
  forceAddStatusAll: "✅ Force Add now applies to <b>ALL</b> members.",
  forceAddStatusNew: "✅ Force Add now applies to <b>NEW</b> members only.",
  forceAddHistoryCleared: "✅ Force Add history has been cleared.\n\nAll members will need to add members again.",
  forceAddStatus: "📊 <b>Force Add Status</b>\n\n• <b>Status:</b> {status}\n• <b>Required adds:</b> {count}\n• <b>Delete time:</b> {time}\n• <b>Apply to:</b> {mode}\n• <b>Custom Text:</b> {has_custom_text}\n\n📝 <b>Current Message:</b>\n{message}",
};

// Lock command mappings
const LOCK_COMMANDS: Record<string, { key: BanRuleKey; label: string }> = {
  // Links and URLs
  "link": { key: "banLinks", label: "Telegram links" },
  "links": { key: "banLinks", label: "Telegram links" },
  "url": { key: "banDomains", label: "External URLs" },
  "urls": { key: "banDomains", label: "External URLs" },
  "site": { key: "banDomains", label: "External URLs" },
  "domain": { key: "banDomains", label: "External URLs" },

  // Usernames and mentions
  "id": { key: "banUsernames", label: "Usernames/mentions" },
  "mention": { key: "banUsernames", label: "Usernames/mentions" },
  "username": { key: "banUsernames", label: "Usernames/mentions" },

  // Hashtags
  "hashtag": { key: "banHashtags", label: "Hashtags" },
  "tag": { key: "banHashtags", label: "Hashtags" },

  // Text
  "text": { key: "banTextPatterns", label: "Text messages" },

  // Forwards
  "forward": { key: "banForward", label: "Forwarded messages" },
  "fwd": { key: "banForward", label: "Forwarded messages" },
  "channelforward": { key: "banForwardChannels", label: "Channel forwards" },
  "forwardchannel": { key: "banForwardChannels", label: "Channel forwards" },

  // Media types
  "photo": { key: "banPhotos", label: "Photos" },
  "image": { key: "banPhotos", label: "Photos" },
  "video": { key: "banVideos", label: "Videos" },
  "sticker": { key: "banStickers", label: "Stickers" },
  "location": { key: "banLocation", label: "Locations" },
  "phone": { key: "banPhones", label: "Phone numbers" },
  "contact": { key: "banPhones", label: "Phone numbers" },
  "voice": { key: "banVoice", label: "Voice messages" },
  "audio": { key: "banAudio", label: "Audio files" },
  "file": { key: "banFiles", label: "Files" },
  "document": { key: "banFiles", label: "Files" },
  "app": { key: "banApps", label: "Apps/Software" },
  "software": { key: "banApps", label: "Apps/Software" },
  "gif": { key: "banGif", label: "GIFs/Animations" },
  "animation": { key: "banGif", label: "GIFs/Animations" },
  "poll": { key: "banPolls", label: "Polls" },
  "game": { key: "banGames", label: "Games" },
  "slash": { key: "banSlashCommands", label: "Slash commands" },
  "command": { key: "banSlashCommands", label: "Slash commands" },

  // Content restrictions
  "nocaption": { key: "banCaptionless", label: "Media without caption" },
  "captionless": { key: "banCaptionless", label: "Media without caption" },
  "emojionly": { key: "banEmojiOnly", label: "Emoji-only messages" },
  "emoji": { key: "banEmojis", label: "Messages with emojis" },

  // Language restrictions
  "english": { key: "banLatin", label: "English/Latin text" },
  "latin": { key: "banLatin", label: "English/Latin text" },
  "persian": { key: "banPersian", label: "Persian/Arabic text" },
  "arabic": { key: "banPersian", label: "Persian/Arabic text" },
  "farsi": { key: "banPersian", label: "Persian/Arabic text" },
  "cyrillic": { key: "banCyrillic", label: "Cyrillic text" },
  "russian": { key: "banCyrillic", label: "Cyrillic text" },
  "chinese": { key: "banChinese", label: "Chinese text" },

  // Reply restrictions
  "reply": { key: "banUserReplies", label: "User replies" },
  "crossreply": { key: "banCrossReplies", label: "Cross-chat replies" },

  // Bot restrictions
  "bot": { key: "banBots", label: "Bots" },
  "botinviter": { key: "banBotInviters", label: "Bot inviters" },
  "inline": { key: "banInlineKeyboards", label: "Inline keyboards" },

  // Tabchi/Spam Protection
  "tabchi": { key: "banTabchi", label: "Tabchi (Spam Bots)" },
  "spambot": { key: "banTabchi", label: "Tabchi (Spam Bots)" },
  "advertiser": { key: "banAdvertiser", label: "Advertisers" },
  "promo": { key: "banAdvertiser", label: "Advertisers" },
  "bio": { key: "banSuspiciousBio", label: "Suspicious Bio" },
  "suspiciousbio": { key: "banSuspiciousBio", label: "Suspicious Bio" },
};

// Penalty types
type PenaltyType = "delete" | "mute" | "kick" | "ban";

interface ParsedCommand {
  prefix: string;
  command: string;
  args: string[];
  rawArgs: string;
}

function parseCommand(text: string): ParsedCommand | null {
  if (!COMMAND_PREFIX.test(text)) {
    return null;
  }

  const prefix = text[0];
  const rest = text.slice(1).trim();
  const parts = rest.split(/\s+/);
  const command = (parts[0] || "").toLowerCase();
  const args = parts.slice(1);
  const rawArgs = rest.slice(command.length).trim();

  return { prefix, command, args, rawArgs };
}

async function isAdmin(ctx: GroupChatContext, userId: number): Promise<boolean> {
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}

async function isCreator(ctx: GroupChatContext, userId: number): Promise<boolean> {
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return member.status === "creator";
  } catch {
    return false;
  }
}

function getReplyUserId(ctx: GroupChatContext): number | null {
  const reply = (ctx.message as any)?.reply_to_message;
  return reply?.from?.id ?? null;
}

function parseDuration(arg: string): number {
  const num = parseInt(arg, 10);
  if (isNaN(num) || num <= 0) return 1;
  if (num >= 1000) return 0; // permanent
  return num;
}

function formatDuration(hours: number): string {
  if (hours === 0) return RESPONSES.permanentDuration;
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""}`;
}

// Command handlers
async function handleBanCommand(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const targetUserId = getReplyUserId(ctx);
  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  const hours = parseDuration(args[0] || "1");
  const untilDate = hours === 0 ? undefined : Math.floor(Date.now() / 1000) + hours * 3600;

  return [
    { type: "ban_member", userId: targetUserId, untilDate, reason: "Admin command: ban" },
    {
      type: "send_message",
      text: RESPONSES.userBanned.replace("{duration}", formatDuration(hours)),
      parseMode: "HTML",
      autoDeleteSeconds: 30
    },
  ];
}

async function handleMuteCommand(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const targetUserId = getReplyUserId(ctx);
  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  const hours = parseDuration(args[0] || "1");
  const durationSeconds = hours === 0 ? 366 * 24 * 3600 : hours * 3600;

  return [
    { type: "restrict_member", userId: targetUserId, durationSeconds, reason: "Admin command: mute" },
    {
      type: "send_message",
      text: RESPONSES.userMuted.replace("{duration}", formatDuration(hours)),
      parseMode: "HTML",
      autoDeleteSeconds: 30
    },
  ];
}

async function handleUnmuteCommand(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const targetUserId = getReplyUserId(ctx);
  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  // Unrestrict by giving back all permissions
  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, targetUserId, {
      permissions: {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_invite_users: true,
        can_pin_messages: false,
        can_manage_topics: false,
        can_change_info: false,
        can_add_web_page_previews: true,
      },
    } as any);
  } catch (error) {
    logger.error("Failed to unmute user", { chatId: ctx.chat.id, userId: targetUserId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }

  return [{ type: "send_message", text: RESPONSES.userUnmuted, parseMode: "HTML", autoDeleteSeconds: 30 }];
}

async function handleResetWarningsCommand(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const targetUserId = getReplyUserId(ctx);
  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  if (databaseAvailable) {
    try {
      const { prisma } = await import("../../../server/db/client.js");
      await prisma.userWarning.deleteMany({
        where: {
          group: { telegramChatId: ctx.chat.id.toString() },
          telegramUserId: targetUserId.toString(),
        },
      });
    } catch (error) {
      logger.error("Failed to reset warnings", { chatId: ctx.chat.id, userId: targetUserId, error });
    }
  }

  return [{ type: "send_message", text: RESPONSES.warningsReset, parseMode: "HTML", autoDeleteSeconds: 30 }];
}

async function handleLockCommand(
  ctx: GroupChatContext,
  feature: string,
  lock: boolean
): Promise<ProcessingAction[]> {
  const mapping = LOCK_COMMANDS[feature.toLowerCase()];
  if (!mapping) {
    return [{ type: "send_message", text: RESPONSES.invalidFormat, parseMode: "HTML" }];
  }

  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    settings.rules[mapping.key].enabled = lock;
    await saveBanSettingsByChatId(chatId, settings);

    const msg = lock
      ? RESPONSES.lockEnabled.replace("{feature}", mapping.label)
      : RESPONSES.lockDisabled.replace("{feature}", mapping.label);

    return [{ type: "send_message", text: msg, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to update lock setting", { chatId, feature, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleWhitelistAdd(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const targetUserId = getReplyUserId(ctx);
  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const userIdStr = targetUserId.toString();
    if (!settings.whitelist.includes(userIdStr)) {
      settings.whitelist.push(userIdStr);
      await saveBanSettingsByChatId(chatId, settings);
    }
    return [{ type: "send_message", text: RESPONSES.whitelistAdded, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to add to whitelist", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleWhitelistRemove(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const targetUserId = getReplyUserId(ctx);
  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const userIdStr = targetUserId.toString();
    settings.whitelist = settings.whitelist.filter(id => id !== userIdStr);
    await saveBanSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.whitelistRemoved, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to remove from whitelist", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleWhitelistClear(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    settings.whitelist = [];
    await saveBanSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.whitelistCleared, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to clear whitelist", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleSilenceCommand(
  ctx: GroupChatContext,
  windowNum: number,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  // Check for disable command
  if (args[0]?.toLowerCase() === "off" || args[0]?.toLowerCase() === "disable") {
    try {
      const settings = await loadSilenceSettingsByChatId(chatId);
      const windowKey = windowNum === 1 ? "window1" : windowNum === 2 ? "window2" : "window3";
      settings[windowKey].enabled = false;
      await saveSilenceSettingsByChatId(chatId, settings);
      return [{ type: "send_message", text: RESPONSES.silenceDisabled, parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      logger.error("Failed to disable silence", { chatId, error });
      return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
    }
  }

  // Parse time range: "from HH:MM to HH:MM"
  const timeMatch = args.join(" ").match(/from\s+(\d{1,2}(?::\d{2})?)\s+to\s+(\d{1,2}(?::\d{2})?)/i);
  if (!timeMatch) {
    return [{
      type: "send_message",
      text: "❌ Invalid format. Use: !silence1 from 23:00 to 08:00",
      parseMode: "HTML"
    }];
  }

  const formatTime = (t: string): string => {
    if (t.includes(":")) return t.padStart(5, "0");
    return `${t.padStart(2, "0")}:00`;
  };

  const start = formatTime(timeMatch[1]);
  const end = formatTime(timeMatch[2]);

  try {
    const settings = await loadSilenceSettingsByChatId(chatId);
    const windowKey = windowNum === 1 ? "window1" : windowNum === 2 ? "window2" : "window3";
    settings[windowKey] = { enabled: true, start, end };
    await saveSilenceSettingsByChatId(chatId, settings);

    const msg = RESPONSES.silenceEnabled.replace("{start}", start).replace("{end}", end);
    return [{ type: "send_message", text: msg, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to set silence", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleGroupLock(ctx: GroupChatContext, lock: boolean): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadSilenceSettingsByChatId(chatId);
    settings.emergencyLock.enabled = lock;
    await saveSilenceSettingsByChatId(chatId, settings);

    const msg = lock ? RESPONSES.groupLocked : RESPONSES.groupUnlocked;
    return [{ type: "send_message", text: msg, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to toggle group lock", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleFilterAdd(ctx: GroupChatContext, word: string): Promise<ProcessingAction[]> {
  if (!word) {
    return [{ type: "send_message", text: RESPONSES.invalidFormat, parseMode: "HTML" }];
  }

  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    if (!settings.blacklist.includes(word.toLowerCase())) {
      settings.blacklist.push(word.toLowerCase());
      await saveBanSettingsByChatId(chatId, settings);
    }

    const msg = RESPONSES.filterAdded.replace("{word}", word);
    return [{ type: "send_message", text: msg, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to add filter", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleFilterRemove(ctx: GroupChatContext, word: string): Promise<ProcessingAction[]> {
  if (!word) {
    return [{ type: "send_message", text: RESPONSES.invalidFormat, parseMode: "HTML" }];
  }

  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    settings.blacklist = settings.blacklist.filter(w => w.toLowerCase() !== word.toLowerCase());
    await saveBanSettingsByChatId(chatId, settings);

    const msg = RESPONSES.filterRemoved.replace("{word}", word);
    return [{ type: "send_message", text: msg, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to remove filter", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleFilterList(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    if (settings.blacklist.length === 0) {
      return [{ type: "send_message", text: RESPONSES.filterEmpty, parseMode: "HTML" }];
    }

    const words = settings.blacklist.map(w => `• ${w}`).join("\n");
    const msg = RESPONSES.filterList.replace("{words}", words);
    return [{ type: "send_message", text: msg, parseMode: "HTML" }];
  } catch (error) {
    logger.error("Failed to list filters", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handlePurgeMessages(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id;
  const currentMessageId = ctx.message?.message_id;
  if (!currentMessageId) return [];

  let count = 100;
  const arg = args[0]?.toLowerCase();

  if (arg) {
    const num = parseInt(arg, 10);
    if (!isNaN(num) && num > 0) {
      count = Math.min(num, 1000);
    }
  }

  // Delete messages in batches
  const actions: ProcessingAction[] = [];
  let deleted = 0;

  for (let i = 0; i < count && i < 100; i++) {
    const msgId = currentMessageId - i - 1;
    if (msgId <= 0) break;

    try {
      await ctx.telegram.deleteMessage(chatId, msgId);
      deleted++;
    } catch {
      // Message might not exist or already deleted
    }
  }

  // Delete the command message itself
  actions.push({ type: "delete_message", messageId: currentMessageId, reason: "purge command" });

  const msg = RESPONSES.purgeComplete.replace("{count}", deleted.toString());
  actions.push({ type: "send_message", text: msg, parseMode: "HTML", autoDeleteSeconds: 10 });

  return actions;
}

async function handleLimitCommand(
  ctx: GroupChatContext,
  limitType: string,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const value = parseInt(args[0], 10);
  const isDisable = args[0]?.toLowerCase() === "off" || args[0]?.toLowerCase() === "disable";

  try {
    const settings = await loadLimitSettingsByChatId(chatId);

    switch (limitType) {
      case "msglimit":
      case "messagelimit":
        settings.messagesPerWindow = isDisable ? 0 : (isNaN(value) ? 5 : value);
        break;
      case "msgwindow":
      case "messagewindow":
        settings.windowMinutes = isDisable ? 0 : (isNaN(value) ? 60 : value);
        break;
      case "duplicate":
      case "dup":
        settings.duplicateMessages = isDisable ? 0 : (isNaN(value) ? 3 : value);
        break;
      case "dupwindow":
        settings.duplicateWindowMinutes = isDisable ? 0 : (isNaN(value) ? 10 : value);
        break;
      case "minwords":
        settings.minWordsPerMessage = isDisable ? 0 : (isNaN(value) ? 0 : value);
        break;
      case "maxwords":
        settings.maxWordsPerMessage = isDisable ? 0 : (isNaN(value) ? 250 : value);
        break;
    }

    await saveGroupCountLimitSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to update limit", { chatId, limitType, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleMandatoryInvite(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const value = parseInt(args[0], 10);
  const isDisable = args[0]?.toLowerCase() === "off" || args[0]?.toLowerCase() === "disable";

  try {
    const settings = await loadMandatoryMembershipSettingsByChatId(chatId);
    settings.forcedInviteCount = isDisable ? 0 : (isNaN(value) ? 0 : value);
    await saveMandatoryMembershipSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to update mandatory invite", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleMandatoryChannel(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const channel = args[0];
  const isDisable = channel?.toLowerCase() === "off" || channel?.toLowerCase() === "disable";

  try {
    const settings = await loadMandatoryMembershipSettingsByChatId(chatId);

    if (isDisable) {
      settings.mandatoryChannels = [];
    } else if (channel && channel.startsWith("@")) {
      if (!settings.mandatoryChannels.includes(channel)) {
        settings.mandatoryChannels.push(channel);
      }
    } else {
      return [{
        type: "send_message",
        text: "❌ Invalid format. Use: !join @channelname",
        parseMode: "HTML"
      }];
    }

    await saveMandatoryMembershipSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to update mandatory channel", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

// ============================================
// Force Join Commands
// ============================================

// Default Force Join message (used when custom is not set)
const DEFAULT_FORCE_JOIN_MESSAGE =
  "📢 <b>Subscription Required</b>\n\n" +
  "Hi {user}, to chat in this group, you must join our channel(s):\n\n" +
  "{channel_names}\n\n" +
  "<i>Once you've joined, you can start chatting!</i>";

/**
 * Handle !ForceJoin command
 * Usage:
 *   !ForceJoin on - Enable force join (if channel already set)
 *   !ForceJoin off - Disable force join
 *   !ForceJoin @channelname - Enable and set the channel
 */
async function handleForceJoin(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const arg = args[0] ?? "";
  const lowerArg = arg.toLowerCase();

  try {
    const settings = await loadMandatoryMembershipSettingsByChatId(chatId);

    // Handle "off" - disable force join
    if (lowerArg === "off" || lowerArg === "disable") {
      settings.mandatoryChannels = [];
      await saveMandatoryMembershipSettingsByChatId(chatId, settings);
      return [{
        type: "send_message",
        text: RESPONSES.forceJoinDisabled,
        parseMode: "HTML",
        autoDeleteSeconds: 30
      }];
    }

    // Handle "on" - enable with existing channel
    if (lowerArg === "on" || lowerArg === "enable") {
      if (settings.mandatoryChannels.length === 0) {
        return [{
          type: "send_message",
          text: RESPONSES.forceJoinNoChannel,
          parseMode: "HTML"
        }];
      }
      // Already has channel, just confirm
      const channels = settings.mandatoryChannels.join(", ");
      const msg = RESPONSES.forceJoinEnabled.replace("{channel}", channels);
      return [{
        type: "send_message",
        text: msg,
        parseMode: "HTML",
        autoDeleteSeconds: 30
      }];
    }

    // Handle @channelname - add/set channel
    if (arg.startsWith("@")) {
      // Add channel if not already present
      if (!settings.mandatoryChannels.includes(arg)) {
        settings.mandatoryChannels.push(arg);
      }
      await saveMandatoryMembershipSettingsByChatId(chatId, settings);
      const msg = RESPONSES.forceJoinEnabled.replace("{channel}", arg);
      return [{
        type: "send_message",
        text: msg,
        parseMode: "HTML",
        autoDeleteSeconds: 30
      }];
    }

    // Invalid format
    return [{
      type: "send_message",
      text: RESPONSES.forceJoinInvalidChannel,
      parseMode: "HTML"
    }];

  } catch (error) {
    logger.error("Failed to handle force join", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

/**
 * Handle !SetForceJoinText command
 * Shows current text and prompts admin for new text (via reply)
 */
async function handleSetForceJoinText(
  ctx: GroupChatContext,
  rawArgs: string
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const customTexts = await loadCustomTextSettingsByChatId(chatId);

    // If user provided text in the command, set it directly
    if (rawArgs.trim().length > 0) {
      customTexts.mandatoryChannelMessage = rawArgs.trim();
      await saveCustomTextSettingsByChatId(chatId, customTexts);
      return [{
        type: "send_message",
        text: RESPONSES.forceJoinTextUpdated,
        parseMode: "HTML",
        autoDeleteSeconds: 30
      }];
    }

    // Show current text and prompt for new text
    const currentText = customTexts.mandatoryChannelMessage || DEFAULT_FORCE_JOIN_MESSAGE;
    const promptMsg = RESPONSES.forceJoinPromptText.replace("{text}", currentText);

    return [{
      type: "send_message",
      text: promptMsg,
      parseMode: "HTML"
    }];

  } catch (error) {
    logger.error("Failed to handle set force join text", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

/**
 * Handle !DelForceJoinText command
 * Resets the force join message to default
 */
async function handleDelForceJoinText(
  ctx: GroupChatContext
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const customTexts = await loadCustomTextSettingsByChatId(chatId);
    customTexts.mandatoryChannelMessage = DEFAULT_FORCE_JOIN_MESSAGE;
    await saveCustomTextSettingsByChatId(chatId, customTexts);

    return [{
      type: "send_message",
      text: RESPONSES.forceJoinTextReset,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];

  } catch (error) {
    logger.error("Failed to delete force join text", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

/**
 * Handle !ForceJoinStatus command
 * Shows current force join status, channel, and message
 */
async function handleForceJoinStatus(
  ctx: GroupChatContext
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const [settings, customTexts] = await Promise.all([
      loadMandatoryMembershipSettingsByChatId(chatId),
      loadCustomTextSettingsByChatId(chatId)
    ]);

    const isEnabled = settings.mandatoryChannels.length > 0;
    const status = isEnabled ? "✅ Enabled" : "❌ Disabled";
    const channels = isEnabled ? settings.mandatoryChannels.join(", ") : "None";
    const currentMessage = customTexts.mandatoryChannelMessage || DEFAULT_FORCE_JOIN_MESSAGE;
    const hasCustomText = customTexts.mandatoryChannelMessage &&
      customTexts.mandatoryChannelMessage !== DEFAULT_FORCE_JOIN_MESSAGE
      ? "✅ Custom" : "📝 Default";

    const statusMsg = RESPONSES.forceJoinStatus
      .replace("{status}", status)
      .replace("{channels}", channels)
      .replace("{has_custom_text}", hasCustomText)
      .replace("{message}", currentMessage);

    return [{
      type: "send_message",
      text: statusMsg,
      parseMode: "HTML"
    }];

  } catch (error) {
    logger.error("Failed to get force join status", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

// ============================================
// End Force Join Commands
// ============================================

// ============================================
// Force Add Commands (Premium Feature)
// ============================================

// Default Force Add message
const DEFAULT_FORCE_ADD_MESSAGE =
  "🚫 <b>Action Required</b>\n\n" +
  "Hi {user}, to prevent spam, we require new members to invite friends before chatting.\n\n" +
  "👥 <b>Progress:</b> {added}/{number} friends invited.\n\n" +
  "<i>Please invite more friends to unlock the chat!</i>";

/**
 * Handle !ForceAdd on/off command
 * Premium feature - enables/disables force add lock
 */
async function handleForceAddToggle(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  // Premium check
  if (!isGroupPremium(chatId)) {
    return [{
      type: "send_message",
      text: RESPONSES.premiumRequired,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  }

  const arg = args[0]?.toLowerCase() ?? "";

  try {
    const banSettings = await loadBanSettingsByChatId(chatId);
    const rawSettings = banSettings as unknown as Record<string, unknown>;

    if (arg === "off" || arg === "disable") {
      rawSettings.mandatoryAdd = false;
      await saveBanSettingsByChatId(chatId, banSettings);
      return [{
        type: "send_message",
        text: RESPONSES.forceAddDisabled,
        parseMode: "HTML",
        autoDeleteSeconds: 30
      }];
    }

    if (arg === "on" || arg === "enable" || arg === "") {
      rawSettings.mandatoryAdd = true;
      // Initialize settings if not present
      if (!rawSettings.mandatoryAddSettings) {
        rawSettings.mandatoryAddSettings = {
          requiredCount: 3,
          deleteTime: 1,
          addMode: "all",
          messageText: "default",
        };
      }
      await saveBanSettingsByChatId(chatId, banSettings);

      const maSettings = rawSettings.mandatoryAddSettings as Record<string, unknown>;
      const count = (maSettings.requiredCount as number) ?? 3;
      const msg = RESPONSES.forceAddEnabled.replace("{count}", count.toString());
      return [{
        type: "send_message",
        text: msg,
        parseMode: "HTML",
        autoDeleteSeconds: 30
      }];
    }

    return [{ type: "send_message", text: RESPONSES.invalidFormat, parseMode: "HTML" }];
  } catch (error) {
    logger.error("Failed to toggle force add", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

/**
 * Handle !SetForceAdd N command
 * Sets the required add count
 */
async function handleSetForceAddCount(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  // Premium check
  if (!isGroupPremium(chatId)) {
    return [{
      type: "send_message",
      text: RESPONSES.premiumRequired,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  }

  const value = parseInt(args[0], 10);
  if (isNaN(value) || value < 1 || value > 20) {
    return [{
      type: "send_message",
      text: "❌ Invalid count. Please use a number between 1 and 20.\n\nExample: <code>!SetForceAdd 5</code>",
      parseMode: "HTML"
    }];
  }

  try {
    const banSettings = await loadBanSettingsByChatId(chatId);
    const rawSettings = banSettings as unknown as Record<string, unknown>;

    if (!rawSettings.mandatoryAddSettings) {
      rawSettings.mandatoryAddSettings = { requiredCount: value };
    } else {
      (rawSettings.mandatoryAddSettings as Record<string, unknown>).requiredCount = value;
    }

    await saveBanSettingsByChatId(chatId, banSettings);
    const msg = RESPONSES.forceAddCountSet.replace("{count}", value.toString());
    return [{
      type: "send_message",
      text: msg,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  } catch (error) {
    logger.error("Failed to set force add count", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

/**
 * Handle !ForceAddTime N/off command
 * Sets the delete time for bot messages
 */
async function handleForceAddTime(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  // Premium check
  if (!isGroupPremium(chatId)) {
    return [{
      type: "send_message",
      text: RESPONSES.premiumRequired,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  }

  const arg = args[0]?.toLowerCase() ?? "";
  const isDisable = arg === "off" || arg === "disable";
  const value = parseInt(args[0], 10);

  try {
    const banSettings = await loadBanSettingsByChatId(chatId);
    const rawSettings = banSettings as unknown as Record<string, unknown>;

    if (!rawSettings.mandatoryAddSettings) {
      rawSettings.mandatoryAddSettings = { deleteTime: 1 };
    }
    const maSettings = rawSettings.mandatoryAddSettings as Record<string, unknown>;

    if (isDisable) {
      maSettings.deleteTime = 0;
      await saveBanSettingsByChatId(chatId, banSettings);
      return [{
        type: "send_message",
        text: RESPONSES.forceAddTimeDisabled,
        parseMode: "HTML",
        autoDeleteSeconds: 30
      }];
    }

    if (isNaN(value) || value < 1 || value > 60) {
      return [{
        type: "send_message",
        text: "❌ Invalid time. Please use a number between 1 and 60 minutes.\n\nExamples:\n• <code>!ForceAddTime 30</code>\n• <code>!ForceAddTime off</code>",
        parseMode: "HTML"
      }];
    }

    maSettings.deleteTime = value;
    await saveBanSettingsByChatId(chatId, banSettings);
    const msg = RESPONSES.forceAddTimeSet.replace("{time}", value.toString());
    return [{
      type: "send_message",
      text: msg,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  } catch (error) {
    logger.error("Failed to set force add time", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

/**
 * Handle !SetForceAddText command
 * Prompts admin to set custom force add message
 */
async function handleSetForceAddText(
  ctx: GroupChatContext,
  rawArgs: string
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  // Premium check
  if (!isGroupPremium(chatId)) {
    return [{
      type: "send_message",
      text: RESPONSES.premiumRequired,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  }

  try {
    const customTexts = await loadCustomTextSettingsByChatId(chatId);

    // If user provided text in the command, set it directly
    if (rawArgs.trim().length > 0) {
      // Handle "default" keyword
      if (rawArgs.trim().toLowerCase() === "default") {
        customTexts.forcedInviteMessage = DEFAULT_FORCE_ADD_MESSAGE;
        await saveCustomTextSettingsByChatId(chatId, customTexts);
        return [{
          type: "send_message",
          text: RESPONSES.forceAddTextReset,
          parseMode: "HTML",
          autoDeleteSeconds: 30
        }];
      }

      customTexts.forcedInviteMessage = rawArgs.trim();
      await saveCustomTextSettingsByChatId(chatId, customTexts);
      return [{
        type: "send_message",
        text: RESPONSES.forceAddTextUpdated,
        parseMode: "HTML",
        autoDeleteSeconds: 30
      }];
    }

    // Show current text and prompt for new text
    const currentText = customTexts.forcedInviteMessage || DEFAULT_FORCE_ADD_MESSAGE;
    const promptMsg = RESPONSES.forceAddTextPrompt.replace("{text}", currentText);

    return [{
      type: "send_message",
      text: promptMsg,
      parseMode: "HTML"
    }];

  } catch (error) {
    logger.error("Failed to handle set force add text", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

/**
 * Handle !DelForceAddText command
 * Resets the force add message to default
 */
async function handleDelForceAddText(
  ctx: GroupChatContext
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  // Premium check
  if (!isGroupPremium(chatId)) {
    return [{
      type: "send_message",
      text: RESPONSES.premiumRequired,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  }

  try {
    const customTexts = await loadCustomTextSettingsByChatId(chatId);
    customTexts.forcedInviteMessage = DEFAULT_FORCE_ADD_MESSAGE;
    await saveCustomTextSettingsByChatId(chatId, customTexts);

    return [{
      type: "send_message",
      text: RESPONSES.forceAddTextReset,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];

  } catch (error) {
    logger.error("Failed to delete force add text", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

/**
 * Handle !ForceAddStatus All/New command
 * Sets whether force add applies to all members or new members only
 */
async function handleForceAddStatusMode(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  // Premium check
  if (!isGroupPremium(chatId)) {
    return [{
      type: "send_message",
      text: RESPONSES.premiumRequired,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  }

  const arg = args[0]?.toLowerCase() ?? "";

  if (arg !== "all" && arg !== "new") {
    return [{
      type: "send_message",
      text: "❌ Invalid mode. Use:\n• <code>!ForceAddStatus All</code> - Apply to all members\n• <code>!ForceAddStatus New</code> - Apply to new members only",
      parseMode: "HTML"
    }];
  }

  try {
    const banSettings = await loadBanSettingsByChatId(chatId);
    const rawSettings = banSettings as unknown as Record<string, unknown>;

    if (!rawSettings.mandatoryAddSettings) {
      rawSettings.mandatoryAddSettings = { addMode: arg };
    } else {
      (rawSettings.mandatoryAddSettings as Record<string, unknown>).addMode = arg;
    }

    await saveBanSettingsByChatId(chatId, banSettings);

    const msg = arg === "all" ? RESPONSES.forceAddStatusAll : RESPONSES.forceAddStatusNew;
    return [{
      type: "send_message",
      text: msg,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  } catch (error) {
    logger.error("Failed to set force add status mode", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

/**
 * Handle !CleanForceAdd command
 * Clears the force add history for all members
 */
async function handleCleanForceAdd(
  ctx: GroupChatContext
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  // Premium check
  if (!isGroupPremium(chatId)) {
    return [{
      type: "send_message",
      text: RESPONSES.premiumRequired,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  }

  try {
    // Clear invite counts for this group from database
    if (databaseAvailable) {
      const { prisma } = await import("../../../server/db/client.js");
      await prisma.membershipEvent.deleteMany({
        where: {
          group: { telegramChatId: chatId },
          event: "invite"
        }
      });
    }

    return [{
      type: "send_message",
      text: RESPONSES.forceAddHistoryCleared,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  } catch (error) {
    logger.error("Failed to clean force add history", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

/**
 * Handle !ForceAddInfo command - shows current status
 */
async function handleForceAddInfo(
  ctx: GroupChatContext
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  // Premium check
  if (!isGroupPremium(chatId)) {
    return [{
      type: "send_message",
      text: RESPONSES.premiumRequired,
      parseMode: "HTML",
      autoDeleteSeconds: 30
    }];
  }

  try {
    const [banSettings, customTexts] = await Promise.all([
      loadBanSettingsByChatId(chatId),
      loadCustomTextSettingsByChatId(chatId)
    ]);

    const rawSettings = banSettings as unknown as Record<string, unknown>;
    const isEnabled = rawSettings.mandatoryAdd === true;
    const maSettings = (rawSettings.mandatoryAddSettings as Record<string, unknown>) ?? {};

    const status = isEnabled ? "✅ Enabled" : "❌ Disabled";
    const count = (maSettings.requiredCount as number) ?? 3;
    const deleteTime = (maSettings.deleteTime as number) ?? 1;
    const addMode = (maSettings.addMode as string) ?? "all";
    const modeLabel = addMode === "new" ? "New Members Only" : "All Members";
    const timeLabel = deleteTime === 0 ? "Disabled" : `${deleteTime} min`;

    const currentMessage = customTexts.forcedInviteMessage || DEFAULT_FORCE_ADD_MESSAGE;
    const hasCustomText = customTexts.forcedInviteMessage &&
      customTexts.forcedInviteMessage !== DEFAULT_FORCE_ADD_MESSAGE
      ? "✅ Custom" : "📝 Default";

    const statusMsg = RESPONSES.forceAddStatus
      .replace("{status}", status)
      .replace("{count}", count.toString())
      .replace("{time}", timeLabel)
      .replace("{mode}", modeLabel)
      .replace("{has_custom_text}", hasCustomText)
      .replace("{message}", currentMessage);

    return [{
      type: "send_message",
      text: statusMsg,
      parseMode: "HTML"
    }];

  } catch (error) {
    logger.error("Failed to get force add info", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

// ============================================
// End Force Add Commands
// ============================================

async function handleWelcomeToggle(

  ctx: GroupChatContext,
  enable: boolean
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    settings.welcomeEnabled = enable;
    await saveGeneralSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to toggle welcome", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleWarningToggle(
  ctx: GroupChatContext,
  enable: boolean
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    settings.warningEnabled = enable;
    await saveGeneralSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to toggle warning", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleAutoDeleteToggle(
  ctx: GroupChatContext,
  enable: boolean
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    settings.autoDeleteEnabled = enable;
    await saveGeneralSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to toggle auto-delete", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleAutoDeleteDelay(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const minutes = parseInt(args[0], 10);

  if (isNaN(minutes) || minutes < 0) {
    return [{ type: "send_message", text: RESPONSES.invalidFormat, parseMode: "HTML" }];
  }

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    settings.autoDeleteDelayMinutes = minutes;
    await saveGeneralSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to set auto-delete delay", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleJoinLeaveToggle(
  ctx: GroupChatContext,
  remove: boolean
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    settings.removeJoinLeaveMessages = remove;
    await saveGeneralSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to toggle join/leave messages", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleAutoWarningToggle(
  ctx: GroupChatContext,
  enable: boolean
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    settings.autoWarningEnabled = enable;
    await saveGeneralSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to toggle auto-warning", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleWarningThreshold(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const threshold = parseInt(args[0], 10);

  if (isNaN(threshold) || threshold < 1) {
    return [{ type: "send_message", text: RESPONSES.invalidFormat, parseMode: "HTML" }];
  }

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    settings.autoWarning.threshold = threshold;
    await saveGeneralSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to set warning threshold", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleWarningRetention(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const days = parseInt(args[0], 10);

  if (isNaN(days) || days < 1) {
    return [{ type: "send_message", text: RESPONSES.invalidFormat, parseMode: "HTML" }];
  }

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    settings.autoWarning.retentionDays = days;
    await saveGeneralSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to set warning retention", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleAdminLock(
  ctx: GroupChatContext,
  lock: boolean
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    settings.countAdminViolationsEnabled = lock;
    await saveGeneralSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to toggle admin lock", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handlePublicCommandsToggle(
  ctx: GroupChatContext,
  lock: boolean
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    settings.disablePublicCommands = lock;
    await saveGeneralSettingsByChatId(chatId, settings);
    return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
  } catch (error) {
    logger.error("Failed to toggle public commands", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

// Tabchi management handlers
async function handleRemoveTabchi(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const message = ctx.message as any;
  const adminId = message.from?.id?.toString();

  // Get target user - either from reply or from args
  let targetUserId: string | null = null;

  const reply = message?.reply_to_message;
  if (reply?.from?.id) {
    targetUserId = reply.from.id.toString();
  } else if (args[0]) {
    // Try to parse user ID from args
    targetUserId = args[0].replace(/\D/g, '');
  }

  if (!targetUserId) {
    return [{
      type: "send_message",
      text: "❌ Please reply to a user's message or provide user ID.\nUsage: !untabchi or !cleartabchi 123456789",
      parseMode: "HTML",
      autoDeleteSeconds: 15,
    }];
  }

  try {
    const { removeFromTabchiList, getTabchiInfo } = await import("../../../server/services/tabchiService.js");

    const info = await getTabchiInfo(targetUserId);
    if (!info || info.removedAt) {
      return [{
        type: "send_message",
        text: "ℹ️ User is not in the tabchi list.",
        parseMode: "HTML",
        autoDeleteSeconds: 15,
      }];
    }

    const removed = await removeFromTabchiList(targetUserId, adminId || "unknown");

    if (removed) {
      return [{
        type: "send_message",
        text: `✅ User removed from tabchi list.\n\n<b>Previous info:</b>\n• Type: ${info.detectionType}\n• Confidence: ${info.confidence}%\n• Groups affected: ${info.groupsAffected}`,
        parseMode: "HTML",
        autoDeleteSeconds: 30,
      }];
    } else {
      return [{
        type: "send_message",
        text: "❌ Failed to remove user from tabchi list.",
        parseMode: "HTML",
        autoDeleteSeconds: 15,
      }];
    }
  } catch (error) {
    logger.error("Failed to remove tabchi", { targetUserId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleTabchiWhitelist(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const message = ctx.message as any;
  const adminId = message.from?.id?.toString();

  const reply = message?.reply_to_message;
  if (!reply?.from?.id) {
    return [{
      type: "send_message",
      text: "❌ Please reply to a user's message to add them to whitelist.",
      parseMode: "HTML",
      autoDeleteSeconds: 15,
    }];
  }

  const targetUserId = reply.from.id.toString();
  const targetName = reply.from.first_name || reply.from.username || targetUserId;

  try {
    const { addToWhitelist, isWhitelisted } = await import("../../../server/services/tabchiService.js");

    if (await isWhitelisted(targetUserId)) {
      return [{
        type: "send_message",
        text: `ℹ️ User <b>${targetName}</b> is already whitelisted.`,
        parseMode: "HTML",
        autoDeleteSeconds: 15,
      }];
    }

    await addToWhitelist({
      telegramUserId: targetUserId,
      addedBy: adminId || "unknown",
      reason: "Added by admin command",
    });

    return [{
      type: "send_message",
      text: `✅ User <b>${targetName}</b> added to tabchi whitelist.\n\n<i>This user will never be flagged as tabchi.</i>`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to whitelist user", { targetUserId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleTabchiInfo(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const message = ctx.message as any;

  const reply = message?.reply_to_message;
  if (!reply?.from?.id) {
    return [{
      type: "send_message",
      text: "❌ Please reply to a user's message to check their tabchi info.",
      parseMode: "HTML",
      autoDeleteSeconds: 15,
    }];
  }

  const targetUserId = reply.from.id.toString();
  const targetName = reply.from.first_name || reply.from.username || targetUserId;

  try {
    const { getTabchiInfo, isWhitelisted } = await import("../../../server/services/tabchiService.js");

    const [info, whitelisted] = await Promise.all([
      getTabchiInfo(targetUserId),
      isWhitelisted(targetUserId),
    ]);

    if (whitelisted) {
      return [{
        type: "send_message",
        text: `✅ <b>${targetName}</b> is whitelisted (never flagged as tabchi).`,
        parseMode: "HTML",
        autoDeleteSeconds: 30,
      }];
    }

    if (!info) {
      return [{
        type: "send_message",
        text: `ℹ️ <b>${targetName}</b> is not in the tabchi database.`,
        parseMode: "HTML",
        autoDeleteSeconds: 30,
      }];
    }

    const status = info.removedAt ? "🟢 Removed" : info.confidence >= 70 ? "🔴 Active (Restricted)" : "🟡 Monitored";

    return [{
      type: "send_message",
      text: `📊 <b>Tabchi Info: ${targetName}</b>\n\n` +
        `• Status: ${status}\n` +
        `• Type: ${info.detectionType}\n` +
        `• Confidence: ${info.confidence}%\n` +
        `• Groups affected: ${info.groupsAffected}\n` +
        `• Detected: ${info.detectedAt.toISOString().split('T')[0]}\n` +
        (info.removedAt ? `• Removed: ${info.removedAt.toISOString().split('T')[0]}\n` : ''),
      parseMode: "HTML",
      autoDeleteSeconds: 60,
    }];
  } catch (error) {
    logger.error("Failed to get tabchi info", { targetUserId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

// Settings display handler
async function handleShowSettings(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const [banSettings, generalSettings, limitSettings] = await Promise.all([
      loadBanSettingsByChatId(chatId),
      loadGeneralSettingsByChatId(chatId),
      loadLimitSettingsByChatId(chatId),
    ]);

    const lines: string[] = [];

    // Active Locks Section
    lines.push("◾️ <b>Active Locks:</b>");
    lines.push("");

    const lockLabels: Record<string, string> = {
      banLinks: "Links",
      banDomains: "External URLs",
      banBots: "Bots",
      banBotInviters: "Bot Inviters",
      banTabchi: "Tabchi",
      banAdvertiser: "Advertisers",
      banSuspiciousBio: "Suspicious Bio",
      banForward: "Forwards",
      banForwardChannels: "Channel Forwards",
      banStickers: "Stickers",
      banPhotos: "Photos",
      banVideos: "Videos",
      banVoice: "Voice",
      banAudio: "Audio",
      banFiles: "Files",
      banGif: "GIFs",
      banPolls: "Polls",
      banGames: "Games",
      banLocation: "Location",
      banPhones: "Phones",
      banUsernames: "Usernames",
      banHashtags: "Hashtags",
      banEmojis: "Emojis",
      banEmojiOnly: "Emoji Only",
      banCaptionless: "Captionless",
      banInlineKeyboards: "Inline Keyboards",
      banSlashCommands: "Slash Commands",
      banTextPatterns: "Text Patterns",
      banLatin: "Latin Text",
      banPersian: "Persian Text",
      banCyrillic: "Cyrillic Text",
      banChinese: "Chinese Text",
      banUserReplies: "User Replies",
      banCrossReplies: "Cross Replies",
      banApps: "Apps",
    };

    const activeLocks: string[] = [];
    for (const [key, label] of Object.entries(lockLabels)) {
      if (banSettings.rules[key as keyof typeof banSettings.rules]?.enabled) {
        activeLocks.push(`✅ ${label}`);
      }
    }

    if (activeLocks.length > 0) {
      lines.push(activeLocks.join("\n"));
    } else {
      lines.push("▫️ No locks active");
    }

    lines.push("~ ~ ~ ~ ~ ~ ~ ~ ~ ~");
    lines.push("");

    // User Entry Settings
    lines.push("◾️ <b>User Entry Settings:</b>");
    lines.push("");

    if (generalSettings.userVerificationEnabled) {
      const mode = generalSettings.userVerificationMode === "incoming" ? "Incoming Users" : "All Users";
      lines.push(`▫️ Verification Active → Mode: ${mode}`);
    } else {
      lines.push("▫️ Verification Disabled");
    }

    lines.push("~ ~ ~ ~ ~ ~ ~ ~ ~ ~");
    lines.push("");

    // Group Settings
    lines.push("◾️ <b>Group Settings:</b>");
    lines.push("");

    // Strict mode / Warning mode
    if (generalSettings.countAdminViolationsEnabled) {
      lines.push("▫️ Strict Mode Active → Warning Mode");
    }

    // Flood protection
    const rawBan = banSettings as unknown as Record<string, unknown>;
    if (rawBan.blockFlood === true) {
      lines.push("▫️ Flood Protection Active → Mute Mode");
    }

    // Warning settings
    if (generalSettings.warningEnabled) {
      const maxWarnings = (generalSettings as any).maxWarningsBeforeAction ?? 3;
      lines.push(`▫️ Warning Mode Active → Max Warnings: ( ${maxWarnings} )`);
    }

    // Temp Media
    if (rawBan.tempMediaEnabled === true) {
      const tempMedia = rawBan.tempMedia as Record<string, unknown> | undefined;
      const deleteTime = (tempMedia?.deleteMinutes as number) ?? 20;
      lines.push(`▫️ Temp Media Active → Time: ( ${deleteTime} ) minutes`);
    }

    // Mandatory Add
    if (rawBan.mandatoryAdd) {
      const mandatoryAdd = rawBan.mandatoryAdd as Record<string, unknown>;
      if (mandatoryAdd.enabled) {
        const count = (mandatoryAdd.requiredCount as number) ?? 3;
        lines.push(`▫️ Mandatory Add Active → Count: ( ${count} ) users`);
      }
    }

    // Word Filter count
    const blacklistCount = banSettings.blacklist?.length ?? 0;
    lines.push(`▫️ Filtered Words Count → ( ${blacklistCount} )`);

    // Group ID
    lines.push(`▫️ Group Numeric ID: ( ${chatId} )`);

    const message = lines.join("\n");

    // Get auto-delete time from settings
    const autoDeleteSeconds = (generalSettings as any).botMessageDeleteSeconds ?? 60;

    return [{
      type: "send_message",
      text: message,
      parseMode: "HTML",
      autoDeleteSeconds,
    }];
  } catch (error) {
    logger.error("Failed to display settings", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

// UserPanel command handler
async function handleUserPanel(
  ctx: GroupChatContext,
  args: string[]
): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  let targetUserId: string | null = null;

  // Priority 1: Check if replying to a message
  const reply = (ctx.message as any)?.reply_to_message;
  if (reply?.from?.id) {
    targetUserId = reply.from.id.toString();
  }
  // Priority 2: Check args for @username or user ID
  else if (args.length > 0) {
    const arg = args[0];
    if (arg.startsWith("@")) {
      // It's a username - we can't resolve it without API access
      return [{
        type: "send_message",
        text: "⚠️ To use UserPanel with username, please reply to a message from that user.\n\nAlternatively, use their numeric user ID:\n<code>!userpanel 123456789</code>",
        parseMode: "HTML",
        autoDeleteSeconds: 30,
      }];
    } else if (/^\d+$/.test(arg)) {
      // It's a numeric user ID
      targetUserId = arg;
    }
  }

  if (!targetUserId) {
    return [{
      type: "send_message",
      text: "❌ Please specify a user:\n\n• Reply to a user's message\n• Use: <code>!userpanel @username</code>\n• Use: <code>!userpanel 123456789</code>",
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  }

  // Try to get user info from Telegram
  let userName = "Unknown User";
  let userUsername = "";
  let userStatus = "Member";
  const botRole = "Regular User";

  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, parseInt(targetUserId, 10));
    userName = member.user.first_name + (member.user.last_name ? ` ${member.user.last_name}` : "");
    userUsername = member.user.username ?? "";

    switch (member.status) {
      case "creator": userStatus = "Creator"; break;
      case "administrator": userStatus = "Administrator"; break;
      case "member": userStatus = "Group Member"; break;
      case "restricted": userStatus = "Restricted"; break;
      case "left": userStatus = "Left"; break;
      case "kicked": userStatus = "Banned"; break;
    }
  } catch {
    // User might not be in group or API error
  }

  // Check ban/mute status
  let isBanned = false;
  let isMuted = false;
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, parseInt(targetUserId, 10));
    isBanned = member.status === "kicked";
    isMuted = member.status === "restricted" && !(member as any).can_send_messages;
  } catch {
    // ignore
  }

  // Get warning count
  let warningCount = 0;
  if (databaseAvailable) {
    try {
      const { prisma } = await import("../../../server/db/client.js");
      const group = await prisma.group.findUnique({
        where: { telegramChatId: chatId },
        select: { id: true },
      });
      if (group) {
        const warning = await prisma.userWarning.findUnique({
          where: {
            groupId_telegramUserId: {
              groupId: group.id,
              telegramUserId: targetUserId,
            },
          },
        });
        warningCount = warning?.count ?? 0;
      }
    } catch {
      // ignore
    }
  }

  const message = `◄ <b>User Status:</b>

⊹ In Group: ${userStatus}
⊹ In Bot: ${botRole}

⊹ User Name: ${userName}
⊹ Numeric ID: ${targetUserId}
⊹ Username: ${userUsername || "None"}
⊹ Nickname: None
⊹ Global Rank: None

⊹ Add Count: 0
⊹ Today's Messages: 0
⊹ Message Rank: None

⊹ Banned: ${isBanned ? "Yes" : "No"}
⊹ Muted: ${isMuted ? "Yes" : "No"}
⊹ Tabchi: No
⊹ Warning Count: ${warningCount}

<i>This panel is specific to the selected user
and does not affect group or other user settings.</i>`;

  // Build inline keyboard for user panel
  const inlineKeyboard = [
    [{ text: "• Locks & Restrictions", callback_data: `fw_up_locks:${chatId}:${targetUserId}` }],
    [{ text: "• Punishments & Release", callback_data: `fw_up_punish:${chatId}:${targetUserId}` }],
    [{ text: "• Promote & Demote", callback_data: `fw_up_promote:${chatId}:${targetUserId}` }],
    [{ text: "• Confirm & Close", callback_data: `fw_up_close:${chatId}:${targetUserId}` }],
  ];

  return [{
    type: "send_message",
    text: message,
    parseMode: "HTML",
    inlineKeyboard,
  }];
}

// Main command processor
async function processCommand(
  ctx: GroupChatContext,
  parsed: ParsedCommand
): Promise<ProcessingAction[]> {
  const { command, args, rawArgs } = parsed;

  // User moderation commands (require reply)
  if (command === "ban" || command === "kick") {
    return handleBanCommand(ctx, args);
  }
  if (command === "mute" || command === "silent" || command === "restrict") {
    return handleMuteCommand(ctx, args);
  }
  if (command === "unmute" || command === "free" || command === "unrestrict") {
    return handleUnmuteCommand(ctx);
  }
  if (command === "reset" || command === "resetwarnings") {
    return handleResetWarningsCommand(ctx);
  }

  // Lock/unlock commands
  for (const [key, mapping] of Object.entries(LOCK_COMMANDS)) {
    if (command === key) {
      const action = args[0]?.toLowerCase();
      if (action === "lock" || action === "on") {
        return handleLockCommand(ctx, key, true);
      }
      if (action === "unlock" || action === "off" || action === "free") {
        return handleLockCommand(ctx, key, false);
      }
    }
    // Also support "!lock link" and "!unlock link" format
    if (command === "lock" && args[0]?.toLowerCase() === key) {
      return handleLockCommand(ctx, key, true);
    }
    if (command === "unlock" && args[0]?.toLowerCase() === key) {
      return handleLockCommand(ctx, key, false);
    }
  }

  // Whitelist commands
  if (command === "whitelist" || command === "wl") {
    const action = args[0]?.toLowerCase();
    if (action === "add") return handleWhitelistAdd(ctx);
    if (action === "remove" || action === "del") return handleWhitelistRemove(ctx);
    if (action === "clear" || action === "reset") return handleWhitelistClear(ctx);
    return handleWhitelistAdd(ctx); // Default to add when replying
  }
  if (command === "unwhitelist" || command === "unwl") {
    return handleWhitelistRemove(ctx);
  }
  if (command === "clearwhitelist" || command === "clearwl") {
    return handleWhitelistClear(ctx);
  }

  // Silence/quiet hours commands
  if (command === "silence1" || command === "quiet1") {
    return handleSilenceCommand(ctx, 1, args);
  }
  if (command === "silence2" || command === "quiet2") {
    return handleSilenceCommand(ctx, 2, args);
  }
  if (command === "silence3" || command === "quiet3") {
    return handleSilenceCommand(ctx, 3, args);
  }
  if (command === "clearsilence" || command === "clearquiet") {
    const chatId = ctx.chat.id.toString();
    try {
      const settings = await loadSilenceSettingsByChatId(chatId);
      settings.window1.enabled = false;
      settings.window2.enabled = false;
      settings.window3.enabled = false;
      await saveSilenceSettingsByChatId(chatId, settings);
      return [{ type: "send_message", text: RESPONSES.success, parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch {
      return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
    }
  }

  // Group lock
  if (command === "lockgroup" || command === "grouplock") {
    return handleGroupLock(ctx, true);
  }
  if (command === "unlockgroup" || command === "groupunlock") {
    return handleGroupLock(ctx, false);
  }

  // Filter commands
  if (command === "filter" || command === "addfilter") {
    return handleFilterAdd(ctx, rawArgs);
  }
  if (command === "unfilter" || command === "removefilter" || command === "delfilter") {
    return handleFilterRemove(ctx, rawArgs);
  }
  if (command === "filterlist" || command === "filters" || command === "listfilters") {
    return handleFilterList(ctx);
  }

  // Purge commands
  if (command === "purge" || command === "clean" || command === "clear") {
    return handlePurgeMessages(ctx, args);
  }

  // Limit commands
  if (command === "msglimit" || command === "messagelimit" || command === "ratelimit") {
    return handleLimitCommand(ctx, "msglimit", args);
  }
  if (command === "msgwindow" || command === "limitwindow") {
    return handleLimitCommand(ctx, "msgwindow", args);
  }
  if (command === "duplicate" || command === "dup" || command === "antispam") {
    return handleLimitCommand(ctx, "duplicate", args);
  }
  if (command === "dupwindow") {
    return handleLimitCommand(ctx, "dupwindow", args);
  }
  if (command === "minwords") {
    return handleLimitCommand(ctx, "minwords", args);
  }
  if (command === "maxwords") {
    return handleLimitCommand(ctx, "maxwords", args);
  }

  // Mandatory membership
  if (command === "invite" || command === "forcedinvite" || command === "pyramid") {
    return handleMandatoryInvite(ctx, args);
  }
  if (command === "join" || command === "channel" || command === "forcedchannel") {
    return handleMandatoryChannel(ctx, args);
  }

  // Force Join commands
  if (command === "forcejoin") {
    return handleForceJoin(ctx, args);
  }
  if (command === "setforcejointext") {
    return handleSetForceJoinText(ctx, rawArgs);
  }
  if (command === "delforcejointext" || command === "deleteforcejointext" || command === "removeforcejointext") {
    return handleDelForceJoinText(ctx);
  }
  if (command === "forcejoinstatus") {
    return handleForceJoinStatus(ctx);
  }

  // Force Add commands (Premium Feature)
  if (command === "forceadd") {
    return handleForceAddToggle(ctx, args);
  }
  if (command === "setforceadd") {
    return handleSetForceAddCount(ctx, args);
  }
  if (command === "forceaddtime") {
    return handleForceAddTime(ctx, args);
  }
  if (command === "setforceaddtext") {
    return handleSetForceAddText(ctx, rawArgs);
  }
  if (command === "delforceaddtext" || command === "deleteforceaddtext" || command === "removeforceaddtext") {
    return handleDelForceAddText(ctx);
  }
  if (command === "forceaddstatus") {
    return handleForceAddStatusMode(ctx, args);
  }
  if (command === "cleanforceadd" || command === "clearforceadd") {
    return handleCleanForceAdd(ctx);
  }
  if (command === "forceaddinfo") {
    return handleForceAddInfo(ctx);
  }

  // Welcome/rules

  if (command === "welcome") {
    const action = args[0]?.toLowerCase();
    return handleWelcomeToggle(ctx, action !== "off" && action !== "disable");
  }

  // Warning settings
  if (command === "warning" || command === "warn") {
    const action = args[0]?.toLowerCase();
    return handleWarningToggle(ctx, action !== "off" && action !== "disable");
  }
  if (command === "autowarning" || command === "autowarn") {
    const action = args[0]?.toLowerCase();
    return handleAutoWarningToggle(ctx, action !== "off" && action !== "disable");
  }
  if (command === "warnthreshold" || command === "maxwarnings") {
    return handleWarningThreshold(ctx, args);
  }
  if (command === "warnretention" || command === "warnexpiry") {
    return handleWarningRetention(ctx, args);
  }

  // Auto-delete
  if (command === "autodelete" || command === "autodel") {
    const action = args[0]?.toLowerCase();
    return handleAutoDeleteToggle(ctx, action !== "off" && action !== "disable");
  }
  if (command === "autodeletedelay" || command === "autodeldelay") {
    return handleAutoDeleteDelay(ctx, args);
  }

  // Join/leave messages
  if (command === "joinleave" || command === "servicemsg") {
    const action = args[0]?.toLowerCase();
    return handleJoinLeaveToggle(ctx, action !== "off" && action !== "show");
  }

  // Admin lock
  if (command === "adminlock" || command === "admins") {
    const action = args[0]?.toLowerCase();
    return handleAdminLock(ctx, action === "lock" || action === "on");
  }

  // Public commands
  if (command === "publiccmds" || command === "publiccommands") {
    const action = args[0]?.toLowerCase();
    return handlePublicCommandsToggle(ctx, action === "lock" || action === "off");
  }

  // Config reload
  if (command === "config" || command === "reload" || command === "refresh") {
    return [{ type: "send_message", text: RESPONSES.configReloaded, parseMode: "HTML", autoDeleteSeconds: 30 }];
  }

  // Credit/renew
  if (command === "credit" || command === "renew" || command === "charge") {
    return [{ type: "send_message", text: RESPONSES.renewLink, parseMode: "HTML" }];
  }

  // Tabchi management commands
  if (command === "untabchi" || command === "cleartabchi") {
    return handleRemoveTabchi(ctx, args);
  }
  if (command === "tabchiwhitelist" || command === "wltabchi") {
    return handleTabchiWhitelist(ctx);
  }
  if (command === "tabchiinfo") {
    return handleTabchiInfo(ctx);
  }

  // Settings display command
  if (command === "settings" || command === "status" || command === "info") {
    return handleShowSettings(ctx);
  }

  // UserPanel command
  if (command === "userpanel" || command === "up" || command === "panel") {
    return handleUserPanel(ctx, args);
  }

  return [];
}

export const textCommandsHandler: UpdateHandler = {
  name: "text-commands",
  matches(ctx) {
    if (!isGroupChat(ctx)) return false;
    const message = ctx.message as Message.TextMessage | undefined;
    if (!message?.text) return false;
    return COMMAND_PREFIX.test(message.text);
  },
  async handle(ctx) {
    const groupCtx = ctx as GroupChatContext;
    const message = groupCtx.message as Message.TextMessage;
    const text = message.text;

    const parsed = parseCommand(text);
    if (!parsed) return { actions: [] };

    // Check if user is admin
    const userId = message.from?.id;
    if (!userId) return { actions: [] };

    const userIsAdmin = await isAdmin(groupCtx, userId);
    if (!userIsAdmin) {
      // Delete the command message for non-admins
      return {
        actions: ensureActions([
          { type: "delete_message", messageId: message.message_id, reason: "non-admin command" },
        ]),
      };
    }

    // Delete the command message
    const actions: ProcessingAction[] = [
      { type: "delete_message", messageId: message.message_id, reason: "admin command processed" },
    ];

    // Process the command
    const commandActions = await processCommand(groupCtx, parsed);
    actions.push(...commandActions);

    logger.info("text command processed", {
      chatId: groupCtx.chat.id,
      userId,
      command: parsed.command,
      args: parsed.args,
    });

    return { actions: ensureActions(actions) };
  },
};
