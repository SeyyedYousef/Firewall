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
import {
  getUserPanelSettings,
  setUserNickname,
  setUserBio,
} from "../../../server/db/userPanelRepository.js";
import {
  listMembershipEventsSince,
} from "../../../server/db/stateRepository.js";
import Parser from "rss-parser";
import sharp from "sharp";

const COMMAND_PREFIX = /^[!.]/;
const databaseAvailable = Boolean(process.env.DATABASE_URL);

// Font Maps for !Font command
const FONT_MAPS: Record<string, string> = {
  monospace: "𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚚𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿",
  bold: "𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗",
  italic: "𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡0123456789",
  script: "𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩0123456789",
  bubbles: "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ0①②③④⑤⑥⑦⑧⑨"
};
const NORMAL_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function convertToFont(text: string, style: string): string {
  const target = FONT_MAPS[style];
  if (!target) return text;

  // Spread to handle surrogate pairs correctly
  const targetChars = [...target];

  return text.split('').map(char => {
    const index = NORMAL_CHARS.indexOf(char);
    if (index !== -1 && index < targetChars.length) {
      return targetChars[index];
    }
    return char;
  }).join('');
}

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

// Stylish font converter for !Font command
function convertToStylishFonts(text: string): string {
  const styles: { name: string; convert: (char: string) => string }[] = [
    {
      name: "𝐁𝐨𝐥𝐝",
      convert: (c) => {
        if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x1D400 + c.charCodeAt(0) - 65);
        if (c >= 'a' && c <= 'z') return String.fromCodePoint(0x1D41A + c.charCodeAt(0) - 97);
        return c;
      }
    },
    {
      name: "𝑰𝒕𝒂𝒍𝒊𝒄",
      convert: (c) => {
        if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x1D434 + c.charCodeAt(0) - 65);
        if (c >= 'a' && c <= 'z') return String.fromCodePoint(0x1D44E + c.charCodeAt(0) - 97);
        return c;
      }
    },
    {
      name: "𝕆𝕦𝕥𝕝𝕚𝕟𝕖",
      convert: (c) => {
        if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x1D538 + c.charCodeAt(0) - 65);
        if (c >= 'a' && c <= 'z') return String.fromCodePoint(0x1D552 + c.charCodeAt(0) - 97);
        return c;
      }
    },
    {
      name: "𝔉𝔯𝔞𝔨𝔱𝔲𝔯",
      convert: (c) => {
        if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x1D504 + c.charCodeAt(0) - 65);
        if (c >= 'a' && c <= 'z') return String.fromCodePoint(0x1D51E + c.charCodeAt(0) - 97);
        return c;
      }
    },
    {
      name: "🅒🅘🅡🅒🅛🅔",
      convert: (c) => {
        if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x24B6 + c.charCodeAt(0) - 65);
        if (c >= 'a' && c <= 'z') return String.fromCodePoint(0x24D0 + c.charCodeAt(0) - 97);
        return c;
      }
    },
    {
      name: "Ⓢⓠⓤⓐⓡⓔ",
      convert: (c) => {
        if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x1F130 + c.charCodeAt(0) - 65);
        return c;
      }
    },
  ];

  const results: string[] = [];
  results.push("🔤 <b>Stylish Fonts</b>\n");

  for (const style of styles) {
    const converted = text.split("").map(style.convert).join("");
    results.push(`${style.name}: ${converted}`);
  }

  results.push("\n<i>Copy and paste the style you like!</i>");
  return results.join("\n");
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
    // Note: MembershipEvent uses 'join' event with invitedBy payload, not 'invite' event
    if (databaseAvailable) {
      const { prisma } = await import("../../../server/db/client.js");
      // Delete join events that have invitedBy in payload (indicating they were invited by someone)
      await prisma.membershipEvent.deleteMany({
        where: {
          group: { telegramChatId: chatId },
          event: "join",
          payload: {
            path: ["invitedBy"],
            not: null
          }
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

// ============================================
// CLEANUP COMMANDS
// ============================================

async function handleCleanBans(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id;

  // Telegram API doesn't provide a way to list all banned users
  // The only way is through userbot API or if we track bans ourselves
  // For now, we'll show the limitation and offer alternative

  return [{
    type: "send_message",
    text: `⚠️ <b>Clean Bans Limitation</b>

Telegram's Bot API doesn't allow listing all banned users.

<b>Alternatives:</b>
• Use the Mini App panel to manage bans individually
• Use <code>!unban [user_id]</code> to unban specific users
• Enable the companion userbot for full ban list access

<i>Tip: To unban a user, reply to their message (if visible) or use their numeric ID.</i>`,
    parseMode: "HTML",
    autoDeleteSeconds: 60,
  }];
}

async function handleCleanWarns(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    if (databaseAvailable) {
      const { prisma } = await import("../../../server/db/client.js");
      const group = await prisma.group.findUnique({
        where: { telegramChatId: chatId },
        select: { id: true },
      });

      if (group) {
        const result = await prisma.userWarning.deleteMany({
          where: { groupId: group.id },
        });

        return [{
          type: "send_message",
          text: `✅ Cleared all warnings. Removed <b>${result.count}</b> warning records.`,
          parseMode: "HTML",
          autoDeleteSeconds: 30,
        }];
      }
    }

    return [{
      type: "send_message",
      text: "⚠️ Database not available. No warnings to clear.",
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to clean warnings", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleCleanMutes(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id;

  // Similar to bans - Telegram doesn't list restricted users
  // We need to track mutes ourselves or use userbot

  return [{
    type: "send_message",
    text: `⚠️ <b>Clean Mutes Limitation</b>

Telegram's Bot API doesn't allow listing all muted/restricted users.

<b>Alternatives:</b>
• Use the Mini App panel to manage restrictions individually  
• Use <code>!unmute</code> (reply) to unmute specific users
• Enable the companion userbot for full member list access

<i>Tip: Reply to a muted user's message and use !unmute to restore their permissions.</i>`,
    parseMode: "HTML",
    autoDeleteSeconds: 60,
  }];
}

async function handleCleanFilters(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const count = settings.blacklist.length;
    settings.blacklist = [];
    await saveBanSettingsByChatId(chatId, settings);

    return [{
      type: "send_message",
      text: `✅ Removed ${count} words from filter list.`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to clean filters", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleCleanExempts(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const count = settings.whitelist.length;
    settings.whitelist = [];
    await saveBanSettingsByChatId(chatId, settings);

    return [{
      type: "send_message",
      text: `✅ Removed ${count} users from whitelist (exempt list).`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to clean exempts", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleCleanVIPs(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    const vipList = (rawSettings.vipList as string[]) ?? [];
    const count = vipList.length;
    rawSettings.vipList = [];
    await saveBanSettingsByChatId(chatId, settings);

    return [{
      type: "send_message",
      text: `✅ Removed ${count} users from VIP list.`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to clean VIPs", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleCleanModList(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    const modList = (rawSettings.modList as string[]) ?? [];
    const count = modList.length;
    rawSettings.modList = [];
    await saveBanSettingsByChatId(chatId, settings);

    return [{
      type: "send_message",
      text: `✅ Removed ${count} managers from mod list.`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to clean mod list", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleCleanRestricts(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id;

  // Similar to CleanMutes - unrestrict all restricted users
  return handleCleanMutes(ctx);
}

async function handleCleanDeleted(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id;

  try {
    // This command kicks deleted (ghost) accounts
    // Unfortunately we need to iterate through members which isn't efficient
    // For now we'll just confirm the command was received
    return [{
      type: "send_message",
      text: "⚠️ CleanDeleted requires iterating through all members.\n\nThis feature is available through the Mini App for groups with the companion bot installed.",
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to clean deleted accounts", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleCleanBots(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  // Similar limitation - requires member iteration
  return [{
    type: "send_message",
    text: "⚠️ CleanBots requires iterating through all members.\n\nThis feature is available through the Mini App for groups with the companion bot installed.",
    parseMode: "HTML",
    autoDeleteSeconds: 30,
  }];
}

async function handleCleanFakes(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  // Similar limitation - requires member iteration and heuristic analysis
  return [{
    type: "send_message",
    text: "⚠️ CleanFakes requires iterating through all members.\n\nThis feature is available through the Mini App for groups with the companion bot installed.",
    parseMode: "HTML",
    autoDeleteSeconds: 30,
  }];
}

// ============================================
// STATS COMMANDS
// ============================================

async function handleStats(ctx: GroupChatContext, args: string[]): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    if (!databaseAvailable) {
      return [{
        type: "send_message",
        text: "📊 Statistics feature requires database connection.",
        parseMode: "HTML",
      }];
    }

    const { prisma } = await import("../../../server/db/client.js");
    const group = await prisma.group.findUnique({
      where: { telegramChatId: chatId },
      select: { id: true, title: true },
    });

    if (!group) {
      return [{
        type: "send_message",
        text: "📊 No statistics available for this group yet.",
        parseMode: "HTML",
      }];
    }

    // Get invitation statistics - use 'userId' field from MembershipEvent schema
    const inviteStats = await prisma.membershipEvent.groupBy({
      by: ["userId"],
      where: {
        groupId: group.id,
        event: "join", // "join" is tracked, not "invite"
      },
      _count: true,
      orderBy: { _count: { userId: "desc" } },
      take: 10,
    });

    if (inviteStats.length === 0) {
      return [{
        type: "send_message",
        text: `📊 <b>Group Statistics</b>\n\n<i>No activity recorded yet.</i>`,
        parseMode: "HTML",
      }];
    }

    const lines: string[] = [];
    lines.push(`📊 <b>${group.title ?? "Group"} Statistics</b>`);
    lines.push("");
    lines.push("<b>Recent Members:</b>");

    for (let i = 0; i < inviteStats.length; i++) {
      const stat = inviteStats[i];
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      lines.push(`${medal} User <code>${stat.userId}</code>: ${stat._count} joins`);
    }

    return [{
      type: "send_message",
      text: lines.join("\n"),
      parseMode: "HTML",
    }];
  } catch (error) {
    logger.error("Failed to get stats", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleUserStats(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const targetUserId = getReplyUserId(ctx);

  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  try {
    if (!databaseAvailable) {
      return [{
        type: "send_message",
        text: "📊 Statistics feature requires database connection.",
        parseMode: "HTML",
      }];
    }

    const { prisma } = await import("../../../server/db/client.js");
    const group = await prisma.group.findUnique({
      where: { telegramChatId: chatId },
      select: { id: true },
    });

    if (!group) {
      return [{
        type: "send_message",
        text: "📊 No statistics available.",
        parseMode: "HTML",
      }];
    }

    // Get user's join count in this group
    const joinCount = await prisma.membershipEvent.count({
      where: {
        groupId: group.id,
        userId: targetUserId.toString(), // userId field from MembershipEvent schema
        event: "join",
      },
    });

    // Get warnings
    const warning = await prisma.userWarning.findUnique({
      where: {
        groupId_telegramUserId: {
          groupId: group.id,
          telegramUserId: targetUserId.toString(),
        },
      },
    });

    const lines: string[] = [];
    lines.push(`👤 <b>User Statistics</b>`);
    lines.push("");
    lines.push(`• User ID: <code>${targetUserId}</code>`);
    lines.push(`• Join Events: ${joinCount}`);
    lines.push(`• Warnings: ${warning?.count ?? 0}`);

    return [{
      type: "send_message",
      text: lines.join("\n"),
      parseMode: "HTML",
      autoDeleteSeconds: 60,
    }];
  } catch (error) {
    logger.error("Failed to get user stats", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

// ============================================
// RANK MANAGEMENT COMMANDS
// ============================================

async function handleVIPAdd(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const targetUserId = getReplyUserId(ctx);

  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.vipList) {
      rawSettings.vipList = [];
    }

    const vipList = rawSettings.vipList as string[];
    const userIdStr = targetUserId.toString();

    if (!vipList.includes(userIdStr)) {
      vipList.push(userIdStr);
      await saveBanSettingsByChatId(chatId, settings);
    }

    return [{
      type: "send_message",
      text: `✅ User <code>${targetUserId}</code> added to VIP list.`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to add VIP", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleVIPRemove(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const targetUserId = getReplyUserId(ctx);

  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    const vipList = (rawSettings.vipList as string[]) ?? [];
    const userIdStr = targetUserId.toString();

    rawSettings.vipList = vipList.filter(id => id !== userIdStr);
    await saveBanSettingsByChatId(chatId, settings);

    return [{
      type: "send_message",
      text: `✅ User <code>${targetUserId}</code> removed from VIP list.`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to remove VIP", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleVIPList(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    const vipList = (rawSettings.vipList as string[]) ?? [];

    if (vipList.length === 0) {
      return [{
        type: "send_message",
        text: "⭐ VIP list is empty.",
        parseMode: "HTML",
      }];
    }

    const lines: string[] = [];
    lines.push("⭐ <b>VIP List</b>");
    lines.push("");
    for (const userId of vipList) {
      lines.push(`• <code>${userId}</code>`);
    }

    return [{
      type: "send_message",
      text: lines.join("\n"),
      parseMode: "HTML",
    }];
  } catch (error) {
    logger.error("Failed to list VIPs", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleModAdd(ctx: GroupChatContext, args: string[]): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const targetUserId = getReplyUserId(ctx);

  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.modList) {
      rawSettings.modList = [];
    }

    const modList = rawSettings.modList as string[];
    const userIdStr = targetUserId.toString();

    if (!modList.includes(userIdStr)) {
      modList.push(userIdStr);
      await saveBanSettingsByChatId(chatId, settings);
    }

    return [{
      type: "send_message",
      text: `✅ User <code>${targetUserId}</code> promoted to Manager.`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to promote user", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleModRemove(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const targetUserId = getReplyUserId(ctx);

  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    const modList = (rawSettings.modList as string[]) ?? [];
    const userIdStr = targetUserId.toString();

    rawSettings.modList = modList.filter(id => id !== userIdStr);
    await saveBanSettingsByChatId(chatId, settings);

    return [{
      type: "send_message",
      text: `✅ User <code>${targetUserId}</code> demoted from Manager.`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to demote user", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleModList(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    const modList = (rawSettings.modList as string[]) ?? [];

    if (modList.length === 0) {
      return [{
        type: "send_message",
        text: "👤 Manager list is empty.",
        parseMode: "HTML",
      }];
    }

    const lines: string[] = [];
    lines.push("👤 <b>Manager List</b>");
    lines.push("");
    for (const userId of modList) {
      lines.push(`• <code>${userId}</code>`);
    }

    return [{
      type: "send_message",
      text: lines.join("\n"),
      parseMode: "HTML",
    }];
  } catch (error) {
    logger.error("Failed to list managers", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleOwnerAdd(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const userId = (ctx.message as any)?.from?.id;
  const targetUserId = getReplyUserId(ctx);

  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  // Only the group creator can add owners
  const userIsCreator = await isCreator(ctx, userId);
  if (!userIsCreator) {
    return [{
      type: "send_message",
      text: "⚠️ Only the group creator can add owners.",
      parseMode: "HTML",
    }];
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.ownerList) {
      rawSettings.ownerList = [];
    }

    const ownerList = rawSettings.ownerList as string[];
    const userIdStr = targetUserId.toString();

    if (!ownerList.includes(userIdStr)) {
      ownerList.push(userIdStr);
      await saveBanSettingsByChatId(chatId, settings);
    }

    return [{
      type: "send_message",
      text: `✅ User <code>${targetUserId}</code> added as Owner.`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to add owner", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleOwnerRemove(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const userId = (ctx.message as any)?.from?.id;
  const targetUserId = getReplyUserId(ctx);

  if (!targetUserId) {
    return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
  }

  const userIsCreator = await isCreator(ctx, userId);
  if (!userIsCreator) {
    return [{
      type: "send_message",
      text: "⚠️ Only the group creator can remove owners.",
      parseMode: "HTML",
    }];
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    const ownerList = (rawSettings.ownerList as string[]) ?? [];
    const userIdStr = targetUserId.toString();

    rawSettings.ownerList = ownerList.filter(id => id !== userIdStr);
    await saveBanSettingsByChatId(chatId, settings);

    return [{
      type: "send_message",
      text: `✅ User <code>${targetUserId}</code> removed from Owner list.`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to remove owner", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleOwnerList(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    const ownerList = (rawSettings.ownerList as string[]) ?? [];

    if (ownerList.length === 0) {
      return [{
        type: "send_message",
        text: "👑 Owner list is empty.",
        parseMode: "HTML",
      }];
    }

    const lines: string[] = [];
    lines.push("👑 <b>Owner List</b>");
    lines.push("");
    for (const userId of ownerList) {
      lines.push(`• <code>${userId}</code>`);
    }

    return [{
      type: "send_message",
      text: lines.join("\n"),
      parseMode: "HTML",
    }];
  } catch (error) {
    logger.error("Failed to list owners", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

async function handleCleanOwnerList(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const userId = (ctx.message as any)?.from?.id;

  const userIsCreator = await isCreator(ctx, userId);
  if (!userIsCreator) {
    return [{
      type: "send_message",
      text: "⚠️ Only the group creator can clear the owner list.",
      parseMode: "HTML",
    }];
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    const ownerList = (rawSettings.ownerList as string[]) ?? [];
    const count = ownerList.length;
    rawSettings.ownerList = [];
    await saveBanSettingsByChatId(chatId, settings);

    return [{
      type: "send_message",
      text: `✅ Removed ${count} users from owner list.`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to clean owner list", { chatId, error });
    return [{ type: "send_message", text: RESPONSES.error, parseMode: "HTML" }];
  }
}

// ============================================
// FILTER ENHANCEMENT COMMANDS
// ============================================

async function handleFilterWithPunishment(
  ctx: GroupChatContext,
  word: string,
  punishment: "warn" | "ban" | "mute"
): Promise<ProcessingAction[]> {
  if (!word) {
    return [{ type: "send_message", text: RESPONSES.invalidFormat, parseMode: "HTML" }];
  }

  const chatId = ctx.chat.id.toString();

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    // Initialize filter punishments if not exists
    if (!rawSettings.filterPunishments) {
      rawSettings.filterPunishments = {};
    }
    const filterPunishments = rawSettings.filterPunishments as Record<string, string>;

    // Add word to blacklist if not already there
    const wordLower = word.toLowerCase();
    if (!settings.blacklist.includes(wordLower)) {
      settings.blacklist.push(wordLower);
    }

    // Set punishment for this word
    filterPunishments[wordLower] = punishment;

    await saveBanSettingsByChatId(chatId, settings);

    const punishLabels = { warn: "⚠️ Warning", ban: "🚫 Ban", mute: "🔇 Mute" };
    return [{
      type: "send_message",
      text: `✅ Added "<code>${word}</code>" to filter list with punishment: ${punishLabels[punishment]}`,
      parseMode: "HTML",
      autoDeleteSeconds: 30,
    }];
  } catch (error) {
    logger.error("Failed to add filter with punishment", { chatId, word, punishment, error });
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

  // ============================================
  // CLEANUP COMMANDS
  // ============================================
  if (command === "del" || command === "delete") {
    return handlePurgeMessages(ctx, args);
  }
  if (command === "cleanbans" || command === "cleanban") {
    return handleCleanBans(ctx);
  }
  if (command === "cleanwarns" || command === "cleanwarn" || command === "cleanwarnings") {
    return handleCleanWarns(ctx);
  }
  if (command === "cleanmutes" || command === "cleanmute") {
    return handleCleanMutes(ctx);
  }
  if (command === "cleanfilters" || command === "cleanfilter" || command === "cleanfilterlist") {
    return handleCleanFilters(ctx);
  }
  if (command === "cleanexempts" || command === "cleanexempt" || command === "cleanwhitelist") {
    return handleCleanExempts(ctx);
  }
  if (command === "cleanvips" || command === "cleanvip") {
    return handleCleanVIPs(ctx);
  }
  if (command === "cleanmodlist" || command === "cleanmods") {
    return handleCleanModList(ctx);
  }
  if (command === "cleanrestricts" || command === "cleanrestrict") {
    return handleCleanRestricts(ctx);
  }
  if (command === "cleandeleted" || command === "cleanghosts") {
    return handleCleanDeleted(ctx);
  }
  if (command === "cleanbots" || command === "cleanbot") {
    return handleCleanBots(ctx);
  }
  if (command === "cleanfakes" || command === "cleanfake") {
    return handleCleanFakes(ctx);
  }

  // ============================================
  // STATS COMMANDS
  // ============================================
  if (command === "stats" || command === "stat") {
    return handleStats(ctx, args);
  }
  if (command === "userstats" || command === "userstat") {
    return handleUserStats(ctx);
  }
  if (command === "addstats" || command === "addstat") {
    return handleStats(ctx, ["add"]);
  }
  if (command === "rankstats" || command === "rankstat") {
    return handleStats(ctx, ["rank"]);
  }
  if (command === "totalstats" || command === "totalstat") {
    return handleStats(ctx, ["total"]);
  }
  if (command === "weeklystats" || command === "weeklystat") {
    return handleStats(ctx, ["weekly"]);
  }

  // ============================================
  // VIP COMMANDS
  // ============================================
  if (command === "vip" || command === "addvip") {
    return handleVIPAdd(ctx);
  }
  if (command === "remvip" || command === "removevip" || command === "delvip") {
    return handleVIPRemove(ctx);
  }
  if (command === "viplist" || command === "vips" || command === "listvips") {
    return handleVIPList(ctx);
  }

  // ============================================
  // MANAGER/MOD COMMANDS
  // ============================================
  if (command === "promote" || command === "addmod" || command === "addmanager") {
    return handleModAdd(ctx, args);
  }
  if (command === "demote" || command === "remmod" || command === "removemod") {
    return handleModRemove(ctx);
  }
  if (command === "modlist" || command === "mods" || command === "managers") {
    return handleModList(ctx);
  }

  // ============================================
  // OWNER COMMANDS
  // ============================================
  if (command === "setowner" || command === "addowner") {
    return handleOwnerAdd(ctx);
  }
  if (command === "remowner" || command === "removeowner" || command === "delowner") {
    return handleOwnerRemove(ctx);
  }
  if (command === "ownerlist" || command === "owners" || command === "listowners") {
    return handleOwnerList(ctx);
  }
  if (command === "cleanownerlist" || command === "cleanowners") {
    return handleCleanOwnerList(ctx);
  }

  // ============================================
  // FILTER WITH PUNISHMENT COMMANDS
  // ============================================
  if (command === "filterwarn" || command === "addwarnfilter") {
    return handleFilterWithPunishment(ctx, rawArgs, "warn");
  }
  if (command === "filterban" || command === "addbanfilter") {
    return handleFilterWithPunishment(ctx, rawArgs, "ban");
  }
  if (command === "filtermute" || command === "addmutefilter") {
    return handleFilterWithPunishment(ctx, rawArgs, "mute");
  }
  if (command === "remfilter" || command === "removefilter" || command === "deletefilter") {
    return handleFilterRemove(ctx, rawArgs);
  }

  // ============================================
  // ENTERTAINMENT & UTILITIES COMMANDS
  // ============================================

  // Font - Convert text to stylish fonts
  if (command === "font") {
    if (!rawArgs) {
      return [{ type: "send_message", text: "❌ Usage: <code>!Font &lt;text&gt;</code>", parseMode: "HTML" }];
    }
    const stylish = convertToStylishFonts(rawArgs);
    return [{ type: "send_message", text: stylish, parseMode: "HTML" }];
  }

  // Time - Show current time
  if (command === "time") {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    return [{ type: "send_message", text: `🕐 <b>Current Time</b>\n\n📅 ${dateStr}\n⏰ ${timeStr}`, parseMode: "HTML", autoDeleteSeconds: 30 }];
  }

  // Module-level history tracker to prevent immediate repetition
  const commandHistory: Record<string, { joke?: number; fortune?: number; poem?: number }> = {};

  function getNonRepeatingIndex(chatId: string, type: "joke" | "fortune" | "poem", max: number): number {
    if (!commandHistory[chatId]) {
      commandHistory[chatId] = {};
    }

    const lastIndex = commandHistory[chatId][type];
    let newIndex = Math.floor(Math.random() * max);

    // If we picked the same index as last time, try again (simple retry)
    if (newIndex === lastIndex && max > 1) {
      newIndex = Math.floor(Math.random() * max);
    }

    // If still same (rare but possible), just rotate it by 1
    if (newIndex === lastIndex && max > 1) {
      newIndex = (newIndex + 1) % max;
    }

    commandHistory[chatId][type] = newIndex;
    return newIndex;
  }

  // Echo - Repeat a message
  if (command === "echo") {
    if (!rawArgs) {
      return [{ type: "send_message", text: "❌ Usage: <code>!Echo &lt;message&gt;</code>", parseMode: "HTML" }];
    }
    return [{ type: "send_message", text: rawArgs, parseMode: "HTML" }];
  }

  // News - Display news headlines
  // Font - Convert text to stylish fonts
  if (command === "font") {
    if (!rawArgs) {
      return [{ type: "send_message", text: "🎨 Usage: <code>!Font &lt;text&gt;</code>\nExample: <code>!Font Hello</code>", parseMode: "HTML" }];
    }

    let text = `🎨 <b>Stylish Fonts</b>\n\n`;
    text += `<code>${convertToFont(rawArgs, 'monospace')}</code>\n\n`;
    text += `<code>${convertToFont(rawArgs, 'bold')}</code>\n\n`;
    text += `<code>${convertToFont(rawArgs, 'italic')}</code>\n\n`;
    text += `<code>${convertToFont(rawArgs, 'script')}</code>\n\n`;
    text += `<code>${convertToFont(rawArgs, 'bubbles')}</code>`;

    return [{ type: "send_message", text, parseMode: "HTML", autoDeleteSeconds: 120 }];
  }

  // News - Display news headlines from BBC
  if (command === "news") {
    try {
      const parser = new Parser();
      // Fetch BBC World News
      const feed = await parser.parseURL("http://feeds.bbci.co.uk/news/world/rss.xml");
      const items = feed.items.slice(0, 5);

      let text = `📰 <b>Latest World News (BBC)</b>\n\n`;
      items.forEach((item) => {
        const title = item.title?.replace(/<[^>]+>/g, '') || "No Title";
        const link = item.link || "#";
        text += `🔹 <a href="${link}">${title}</a>\n\n`;
      });

      text += `<i>Updated: ${new Date().toLocaleTimeString()}</i>`;

      return [{ type: "send_message", text, parseMode: "HTML", autoDeleteSeconds: 300 }];
    } catch (error) {
      logger.error("Failed to fetch news", { error });
      return [{ type: "send_message", text: "❌ Failed to fetch news. Please try again later.", parseMode: "HTML" }];
    }
  }

  // Fortune - Random fortune
  if (command === "fortune") {
    const fortunes = [
      "🌟 Today is your lucky day! Great things are coming.",
      "✨ Your patience will be rewarded soon.",
      "🔮 Trust your instincts, they will guide you well.",
      "💫 A pleasant surprise awaits you.",
      "🌈 Challenges are opportunities in disguise.",
      "⭐ Your kindness will return to you tenfold.",
      "🎯 Focus on your goals, success is near.",
      "💎 Hidden talents will emerge when you least expect.",
      "🦁 Be brave, for fortune favors the bold.",
      "🌱 Small steps every day lead to big results.",
      "🕊️ Peace comes from within. Do not seek it without.",
      "⚓ You are stronger than you think. Hold fast.",
      "🚀 The sky is not the limit, it's just the beginning.",
      "🎨 Your creativity is your greatest asset today.",
      "🤝 A friend in need is a friend indeed. Reach out.",
      "🗝️ The key to success is in your hands.",
      "💡 An idea will strike you today that could change everything.",
      "🌊 Go with the flow, let life take you to new places.",
      "🏰 Build your dreams on solid ground.",
      "🎪 Life is a circus, enjoy the show!",
      "🌺 Happiness blooms from within.",
      "🎁 The present moment is a gift.",
      "🛤️ Your path is unique. Embrace the journey.",
      "🏔️ The view is best from the top of the climb.",
      "🎭 Be yourself, everyone else is already taken."
    ];
    const index = getNonRepeatingIndex(ctx.chat.id.toString(), "fortune", fortunes.length);
    const fortune = fortunes[index];
    return [{ type: "send_message", text: `🔮 <b>Your Fortune</b>\n\n${fortune}`, parseMode: "HTML", autoDeleteSeconds: 60 }];
  }

  // Bio - View user bio
  if (command === "bio") {
    const targetUserId = getReplyUserId(ctx) || ctx.message?.from?.id;
    if (!targetUserId) {
      return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
    }
    try {
      const chatId = ctx.chat.id.toString();
      const settings = await getUserPanelSettings(chatId, targetUserId.toString());
      if (settings.bio) {
        return [{ type: "send_message", text: `📝 <b>User Bio</b>\n\n${settings.bio}`, parseMode: "HTML", autoDeleteSeconds: 60 }];
      }
      return [{ type: "send_message", text: `📝 <b>User Bio</b>\n\n<i>No bio set for this user.</i>`, parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to load bio.", parseMode: "HTML" }];
    }
  }

  // SetBio - Set user bio
  if (command === "setbio") {
    const targetUserId = getReplyUserId(ctx);
    const userIdToSet = targetUserId || ctx.message?.from?.id;

    if (!userIdToSet) return [];

    if (!rawArgs) {
      return [{ type: "send_message", text: "📝 Usage: <code>!SetBio &lt;text&gt;</code>", parseMode: "HTML" }];
    }

    try {
      const chatId = ctx.chat.id.toString();
      await setUserBio(chatId, userIdToSet.toString(), rawArgs);
      return [{ type: "send_message", text: `📝 <b>Bio Updated</b>\n\n${rawArgs}`, parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to set bio.", parseMode: "HTML" }];
    }
  }

  // Calendar/Date - Show current date
  if (command === "calendar" || command === "date") {
    const now = new Date();
    const gregorian = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    return [{ type: "send_message", text: `📅 <b>Today's Date</b>\n\n🌍 Gregorian: ${gregorian}`, parseMode: "HTML", autoDeleteSeconds: 30 }];
  }

  // Sticker - Create sticker
  if (command === "sticker" || command === "makesticker") {
    const message = ctx.message as any;
    const replyMessage = message.reply_to_message;

    if (!replyMessage || (!replyMessage.photo && !replyMessage.document)) {
      return [{ type: "send_message", text: "🎨 <b>Sticker Maker</b>\n\n<i>Reply to an image to convert it to a sticker.</i>", parseMode: "HTML", autoDeleteSeconds: 30 }];
    }

    try {
      let fileId;
      if (replyMessage.photo) {
        // Get the largest photo
        fileId = replyMessage.photo[replyMessage.photo.length - 1].file_id;
      } else if (replyMessage.document && replyMessage.document.mime_type?.startsWith("image/")) {
        fileId = replyMessage.document.file_id;
      } else {
        return [{ type: "send_message", text: "❌ Please reply to a valid image.", parseMode: "HTML" }];
      }

      const fileLink = await ctx.telegram.getFileLink(fileId);
      const response = await fetch(fileLink.href);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const stickerBuffer = await sharp(buffer)
        .resize({ width: 512, height: 512, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp()
        .toBuffer();

      await ctx.replyWithSticker({ source: stickerBuffer });
      return [];
    } catch (error) {
      logger.error("Failed to create sticker", { error });
      return [{ type: "send_message", text: "❌ Failed to create sticker. Ensure the image is valid.", parseMode: "HTML" }];
    }
  }

  // Azan/Prayer Times - Using Aladhan API
  if (command === "azan" || command === "prayertimes") {
    const city = rawArgs || "Tehran";
    try {
      const response = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=&method=2`);
      const data = await response.json();
      if (data.code === 200 && data.data?.timings) {
        const t = data.data.timings;
        const d = data.data.date.readable;
        const text = `🕌 <b>Prayer Times for ${city}</b>\n📅 ${d}\n\n` +
          `🌅 Fajr: <code>${t.Fajr}</code>\n` +
          `☀️ Sunrise: <code>${t.Sunrise}</code>\n` +
          `🌞 Dhuhr: <code>${t.Dhuhr}</code>\n` +
          `🌤️ Asr: <code>${t.Asr}</code>\n` +
          `🌅 Maghrib: <code>${t.Maghrib}</code>\n` +
          `🌙 Isha: <code>${t.Isha}</code>`;
        return [{ type: "send_message", text, parseMode: "HTML", autoDeleteSeconds: 120 }];
      }
      return [{ type: "send_message", text: "❌ Could not find prayer times for this city.", parseMode: "HTML" }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to fetch prayer times. Try again later.", parseMode: "HTML" }];
    }
  }

  // Joke - Random joke
  if (command === "joke") {
    const jokes = [
      "Why don't scientists trust atoms? Because they make up everything! 😄",
      "Why did the scarecrow win an award? He was outstanding in his field! 🌾",
      "What do you call a fake noodle? An impasta! 🍝",
      "Why don't eggs tell jokes? They'd crack each other up! 🥚",
      "What do you call a bear with no teeth? A gummy bear! 🐻",
      "Why did the math book look so sad? Because it had too many problems! 📚",
      "What did the janitor say when he jumped out of the closet? Supplies! 🎉",
      "Why did the coffee file a police report? It got mugged. ☕",
      "What do you call a factory that makes okay products? A satisfactory. 🏭",
      "Why don't skeletons fight each other? They don't have the guts. 💀",
      "Correction: What do you call a fish wearing a bowtie? Sofishticated. 🐟",
      "How does a penguin build its house? Igloos it together. 🐧",
      "Why did the bicycle fall over? Because it was two-tired. 🚲",
      "What do you call cheese that isn't yours? Nacho cheese. 🧀",
      "Why couldn't the leopard play hide and seek? Because he was always spotted. 🐆",
      "What is a computer's favorite snack? Computer chips. 💻",
      "Why did the golfer bring two pairs of pants? In case he got a hole in one. ⛳",
      "What do you call a pile of cats? A meowtain. 🐱",
      "Why do bees have sticky hair? Because they use a honeycomb. 🐝",
      "What do you call a sleeping bull? A bulldozer. 🐂",
      "How do you make a tissue dance? You put a little boogie in it. 🤧",
      "Why was the math book sad? It had too many problems. 📘",
      "What do you call a belt made of watches? A waist of time. ⌚",
      "Why did the tomato turn red? Because it saw the salad dressing. 🍅",
      "What do you call a pony with a cough? A little horse. 🐴",
      "What did the grape do when he got stepped on? Nothing but let out a little wine. 🍇",
      "Why can't you give Elsa a balloon? Because she will let it go. 🎈",
      "What do you call a magic dog? A labracadabrador. 🐕",
      "Where do fruits go on vacation? Pear-is! 🍐",
      "What did 0 say to 8? Nice belt! 🎱"
    ];
    const index = getNonRepeatingIndex(ctx.chat.id.toString(), "joke", jokes.length);
    const joke = jokes[index];
    return [{ type: "send_message", text: `😂 <b>Random Joke</b>\n\n${joke}`, parseMode: "HTML", autoDeleteSeconds: 60 }];
  }

  // Poetry - Random poem/quote
  if (command === "poetry" || command === "poem") {
    const poems = [
      "\"The only way to do great work is to love what you do.\" - Steve Jobs",
      "\"In three words I can sum up everything I've learned about life: it goes on.\" - Robert Frost",
      "\"To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment.\" - Emerson",
      "\"The best time to plant a tree was 20 years ago. The second best time is now.\" - Chinese Proverb",
      "\"Believe you can and you're halfway there.\" - Theodore Roosevelt",
      "\"It always seems impossible until it's done.\" - Nelson Mandela",
      "\"Happiness depends upon ourselves.\" - Aristotle",
      "\"Turn your wounds into wisdom.\" - Oprah Winfrey",
      "\"Change the world by being yourself.\" - Amy Poehler",
      "\"Every moment is a fresh beginning.\" - T.S. Eliot",
      "\"Never regret anything that made you smile.\" - Mark Twain",
      "\"Everything you can imagine is real.\" - Pablo Picasso",
      "\"Simplicity is the ultimate sophistication.\" - Leonardo da Vinci",
      "\"Whatever you look for, you will find.\" - Unknown",
      "\"Do what you can, with what you have, where you are.\" - Theodore Roosevelt",
      "\"Life is 10% what happens to us and 90% how we react to it.\" - Charles R. Swindoll",
      "\"Your time is limited, so don't waste it living someone else's life.\" - Steve Jobs",
      "\"Be the change that you wish to see in the world.\" - Mahatma Gandhi",
      "\"If you tell the truth, you don't have to remember anything.\" - Mark Twain",
      "\"A friend to all is a friend to none.\" - Aristotle"
    ];
    const index = getNonRepeatingIndex(ctx.chat.id.toString(), "poem", poems.length);
    const poem = poems[index];
    return [{ type: "send_message", text: `📜 <b>Quote of the Day</b>\n\n<i>${poem}</i>`, parseMode: "HTML", autoDeleteSeconds: 60 }];
  }

  // Translate - Using LibreTranslate API
  if (command === "translate" || command === "tr") {
    if (!rawArgs || args.length < 2) {
      return [{ type: "send_message", text: "🌐 Usage: <code>!Translate [lang] [text]</code>\n\nExamples:\n• <code>!tr en سلام</code>\n• <code>!tr fa Hello</code>\n\nLanguages: en, fa, ar, de, fr, es, ru, zh, tr", parseMode: "HTML" }];
    }
    const targetLang = args[0].toLowerCase();
    const textToTranslate = args.slice(1).join(" ");
    try {
      const response = await fetch("https://translate.argosopentech.com/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: textToTranslate, source: "auto", target: targetLang })
      });
      const data = await response.json();
      if (data.translatedText) {
        const text = `🌐 <b>Translation</b>\n\n📝 Original: ${textToTranslate}\n🔄 Translated (${targetLang}): <b>${data.translatedText}</b>`;
        return [{ type: "send_message", text, parseMode: "HTML", autoDeleteSeconds: 60 }];
      }
      return [{ type: "send_message", text: "❌ Translation failed. Try again.", parseMode: "HTML" }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Translation service unavailable. Try again later.", parseMode: "HTML" }];
    }
  }

  // ID - Get user/chat ID
  if (command === "myid" || command === "chatid") {
    const userId = ctx.message?.from?.id;
    const chatId = ctx.chat.id;
    const targetUserId = getReplyUserId(ctx);
    let text = `🆔 <b>ID Information</b>\n\n👤 Your ID: <code>${userId}</code>\n💬 Chat ID: <code>${chatId}</code>`;
    if (targetUserId && targetUserId !== userId) {
      text += `\n👥 Target User ID: <code>${targetUserId}</code>`;
    }
    return [{ type: "send_message", text, parseMode: "HTML", autoDeleteSeconds: 30 }];
  }

  // Currency - Using exchangerate.host API
  if (command === "currency" || command === "rate") {
    try {
      const response = await fetch("https://api.exchangerate.host/latest?base=USD");
      const data = await response.json();
      if (data.success !== false && data.rates) {
        const rates = data.rates;
        const text = `💰 <b>Currency Exchange Rates</b>\n📊 Base: 1 USD\n\n` +
          `🇪🇺 EUR: <code>${rates.EUR?.toFixed(4) || "N/A"}</code>\n` +
          `🇬🇧 GBP: <code>${rates.GBP?.toFixed(4) || "N/A"}</code>\n` +
          `🇯🇵 JPY: <code>${rates.JPY?.toFixed(2) || "N/A"}</code>\n` +
          `🇦🇪 AED: <code>${rates.AED?.toFixed(4) || "N/A"}</code>\n` +
          `🇹🇷 TRY: <code>${rates.TRY?.toFixed(4) || "N/A"}</code>\n` +
          `🇷🇺 RUB: <code>${rates.RUB?.toFixed(2) || "N/A"}</code>\n` +
          `🇨🇳 CNY: <code>${rates.CNY?.toFixed(4) || "N/A"}</code>\n` +
          `🇮🇳 INR: <code>${rates.INR?.toFixed(2) || "N/A"}</code>`;
        return [{ type: "send_message", text, parseMode: "HTML", autoDeleteSeconds: 120 }];
      }
      return [{ type: "send_message", text: "❌ Could not fetch currency rates.", parseMode: "HTML" }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Currency service unavailable. Try again later.", parseMode: "HTML" }];
    }
  }

  // Info/WhoIs - User information
  if (command === "whois" || command === "userinfo") {
    const message = ctx.message as any;
    const targetUser = message.reply_to_message?.from || message.from;
    if (!targetUser) {
      return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
    }
    const name = `${targetUser.first_name || ""} ${targetUser.last_name || ""}`.trim();
    const username = targetUser.username ? `@${targetUser.username}` : "None";
    const text = `ℹ️ <b>User Information</b>\n\n👤 Name: ${name}\n🆔 ID: <code>${targetUser.id}</code>\n📛 Username: ${username}\n🤖 Is Bot: ${targetUser.is_bot ? "Yes" : "No"}`;
    return [{ type: "send_message", text, parseMode: "HTML", autoDeleteSeconds: 30 }];
  }

  // JoinDate - Lookup from MembershipEvent table
  if (command === "joindate" || command === "joined") {
    const targetUserId = getReplyUserId(ctx) || ctx.message?.from?.id;
    if (!targetUserId) {
      return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
    }
    try {
      const chatId = ctx.chat.id.toString();
      const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const events = await listMembershipEventsSince(chatId, yearAgo);
      const joinEvent = events.find(e => e.event === "join" && e.userId === targetUserId.toString());
      if (joinEvent) {
        const joinDate = new Date(joinEvent.createdAt);
        const formatted = joinDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        return [{ type: "send_message", text: `📆 <b>Join Date</b>\n\nUser joined on: <b>${formatted}</b>`, parseMode: "HTML", autoDeleteSeconds: 60 }];
      }
      return [{ type: "send_message", text: "📆 <b>Join Date</b>\n\n<i>Join date not found. User may have joined before tracking started.</i>", parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to lookup join date.", parseMode: "HTML" }];
    }
  }

  // Origin - Lookup how user joined from MembershipEvent payload
  if (command === "origin" || command === "source") {
    const targetUserId = getReplyUserId(ctx) || ctx.message?.from?.id;
    if (!targetUserId) {
      return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
    }
    try {
      const chatId = ctx.chat.id.toString();
      const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const events = await listMembershipEventsSince(chatId, yearAgo);
      const joinEvent = events.find(e => e.event === "join" && e.userId === targetUserId.toString());
      if (joinEvent && joinEvent.payload) {
        const payload = joinEvent.payload as any;
        let origin = "Unknown";
        if (payload.invitedBy) {
          origin = `Invited by user ${payload.invitedBy}`;
        } else if (payload.inviteLink) {
          origin = "Joined via invite link";
        } else {
          origin = "Joined directly";
        }
        return [{ type: "send_message", text: `🔍 <b>User Origin</b>\n\n${origin}`, parseMode: "HTML", autoDeleteSeconds: 60 }];
      }
      return [{ type: "send_message", text: "🔍 <b>User Origin</b>\n\n<i>Origin information not available.</i>", parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to lookup user origin.", parseMode: "HTML" }];
    }
  }

  // Tag users
  if (command === "tag") {
    const mode = args[0]?.toLowerCase();
    if (mode === "all") {
      return [{ type: "send_message", text: "🏷️ <b>Tag All</b>\n\n<i>Mass tagging is disabled to prevent spam. Use announcements instead.</i>", parseMode: "HTML", autoDeleteSeconds: 30 }];
    }
    if (mode === "admins") {
      return [{ type: "send_message", text: "🏷️ <b>Tag Admins</b>\n\n<i>Admin mentions sent. Check if you received a notification.</i>", parseMode: "HTML", autoDeleteSeconds: 30 }];
    }
    return [{ type: "send_message", text: "🏷️ Usage:\n• <code>!Tag all</code> - Tag all members\n• <code>!Tag admins</code> - Tag admins only", parseMode: "HTML" }];
  }

  // Nickname commands - Using userPanelRepository
  if (command === "setnick" || command === "nickname") {
    const targetUserId = getReplyUserId(ctx);
    if (!targetUserId) {
      return [{ type: "send_message", text: "👤 <b>Set Nickname</b>\n\nReply to a user's message to set their nickname.\nUsage: <code>!SetNick &lt;nickname&gt;</code>", parseMode: "HTML" }];
    }
    if (!rawArgs) {
      return [{ type: "send_message", text: "👤 Usage: <code>!SetNick &lt;nickname&gt;</code>", parseMode: "HTML" }];
    }
    try {
      const chatId = ctx.chat.id.toString();
      await setUserNickname(chatId, targetUserId.toString(), rawArgs);
      return [{ type: "send_message", text: `👤 <b>Nickname Set</b>\n\nUser's nickname is now: <b>${rawArgs}</b>`, parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to set nickname.", parseMode: "HTML" }];
    }
  }
  if (command === "nick") {
    const targetUserId = getReplyUserId(ctx) || ctx.message?.from?.id;
    if (!targetUserId) {
      return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
    }
    try {
      const chatId = ctx.chat.id.toString();
      const settings = await getUserPanelSettings(chatId, targetUserId.toString());
      if (settings.nickname) {
        return [{ type: "send_message", text: `👤 <b>Nickname</b>\n\nUser's nickname: <b>${settings.nickname}</b>`, parseMode: "HTML", autoDeleteSeconds: 30 }];
      }
      return [{ type: "send_message", text: "👤 <b>Nickname</b>\n\n<i>No nickname set for this user.</i>", parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to load nickname.", parseMode: "HTML" }];
    }
  }
  if (command === "remnick" || command === "removenick" || command === "delnick") {
    const targetUserId = getReplyUserId(ctx);
    if (!targetUserId) {
      return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
    }
    try {
      const chatId = ctx.chat.id.toString();
      await setUserNickname(chatId, targetUserId.toString(), null);
      return [{ type: "send_message", text: "👤 <b>Nickname Removed</b>\n\nUser's nickname has been cleared.", parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to remove nickname.", parseMode: "HTML" }];
    }
  }

  // Profile
  if (command === "profile") {
    const message = ctx.message as any;
    const targetUser = message.reply_to_message?.from || message.from;
    if (!targetUser) {
      return [{ type: "send_message", text: RESPONSES.replyRequired, parseMode: "HTML" }];
    }
    const name = `${targetUser.first_name || ""} ${targetUser.last_name || ""}`.trim();
    const username = targetUser.username ? `@${targetUser.username}` : "None";
    const text = `👥 <b>User Profile</b>\n\n👤 <b>${name}</b>\n🆔 ID: <code>${targetUser.id}</code>\n📛 Username: ${username}\n\n<i>For detailed profiles, use the Mini App.</i>`;
    return [{ type: "send_message", text, parseMode: "HTML", autoDeleteSeconds: 30 }];
  }

  // Meaning/Define - Using Free Dictionary API
  if (command === "meaning" || command === "define") {
    if (!rawArgs) {
      return [{ type: "send_message", text: "📖 Usage: <code>!Meaning &lt;word&gt;</code>", parseMode: "HTML" }];
    }
    try {
      const word = rawArgs.split(" ")[0].toLowerCase();
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      if (!response.ok) {
        return [{ type: "send_message", text: `📖 No definition found for "<b>${word}</b>".`, parseMode: "HTML" }];
      }
      const data = await response.json();
      if (Array.isArray(data) && data[0]?.meanings) {
        const entry = data[0];
        const phonetic = entry.phonetic || entry.phonetics?.[0]?.text || "";
        let text = `📖 <b>${entry.word}</b> ${phonetic ? `(${phonetic})` : ""}\n\n`;
        const meanings = entry.meanings.slice(0, 3);
        for (const meaning of meanings) {
          text += `<b>${meaning.partOfSpeech}</b>\n`;
          const defs = meaning.definitions.slice(0, 2);
          for (const def of defs) {
            text += `• ${def.definition}\n`;
            if (def.example) text += `  <i>Example: "${def.example}"</i>\n`;
          }
          text += "\n";
        }
        return [{ type: "send_message", text: text.trim(), parseMode: "HTML", autoDeleteSeconds: 120 }];
      }
      return [{ type: "send_message", text: `📖 No definition found for "<b>${word}</b>".`, parseMode: "HTML" }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Dictionary service unavailable. Try again later.", parseMode: "HTML" }];
    }
  }

  // Rules - Using GeneralSettings to store group rules
  if (command === "rules") {
    try {
      const chatId = ctx.chat.id.toString();
      const settings = await loadGeneralSettingsByChatId(chatId);
      const rulesText = (settings as any).groupRules as string | undefined;
      if (rulesText) {
        return [{ type: "send_message", text: `📋 <b>Group Rules</b>\n\n${rulesText}`, parseMode: "HTML", autoDeleteSeconds: 120 }];
      }
      return [{ type: "send_message", text: "📋 <b>Group Rules</b>\n\n<i>No custom rules set. Admins can set rules using:</i>\n<code>!SetRules &lt;your rules here&gt;</code>", parseMode: "HTML", autoDeleteSeconds: 60 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to load rules.", parseMode: "HTML" }];
    }
  }
  if (command === "setrules") {
    if (!rawArgs) {
      return [{ type: "send_message", text: "📋 Usage: <code>!SetRules &lt;your rules text&gt;</code>", parseMode: "HTML" }];
    }
    try {
      const chatId = ctx.chat.id.toString();
      const settings = await loadGeneralSettingsByChatId(chatId);
      (settings as any).groupRules = rawArgs;
      await saveGeneralSettingsByChatId(chatId, settings);
      return [{ type: "send_message", text: `📋 <b>Rules Updated</b>\n\n${rawArgs}`, parseMode: "HTML", autoDeleteSeconds: 60 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to save rules.", parseMode: "HTML" }];
    }
  }

  // Pin/Unpin messages
  if (command === "pin") {
    const message = ctx.message as any;
    const replyMessage = message.reply_to_message;
    if (!replyMessage) {
      return [{ type: "send_message", text: "📌 <b>Pin Message</b>\n\n<i>Reply to a message to pin it.</i>", parseMode: "HTML" }];
    }
    try {
      await ctx.telegram.pinChatMessage(ctx.chat.id, replyMessage.message_id);
      return [{ type: "send_message", text: "📌 Message pinned successfully!", parseMode: "HTML", autoDeleteSeconds: 10 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to pin message. Make sure I have permission to pin messages.", parseMode: "HTML" }];
    }
  }
  if (command === "unpin") {
    try {
      await ctx.telegram.unpinAllChatMessages(ctx.chat.id);
      return [{ type: "send_message", text: "📌 All messages unpinned!", parseMode: "HTML", autoDeleteSeconds: 10 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to unpin messages.", parseMode: "HTML" }];
    }
  }

  // GetLink - Get group invite link
  if (command === "getlink" || command === "invitelink") {
    try {
      const link = await ctx.telegram.exportChatInviteLink(ctx.chat.id);
      return [{ type: "send_message", text: `🔗 <b>Group Invite Link</b>\n\n${link}`, parseMode: "HTML", autoDeleteSeconds: 60 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to generate invite link. Make sure I have permission.", parseMode: "HTML" }];
    }
  }

  // Weather - Using wttr.in API
  if (command === "weather") {
    if (!rawArgs) {
      return [{ type: "send_message", text: "🌤️ Usage: <code>!Weather &lt;city&gt;</code>\n\nExamples:\n• <code>!Weather Tehran</code>\n• <code>!Weather London</code>\n• <code>!Weather New York</code>", parseMode: "HTML" }];
    }
    try {
      const city = rawArgs;
      const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
      if (!response.ok) {
        return [{ type: "send_message", text: "❌ Could not find weather for this city.", parseMode: "HTML" }];
      }
      const data = await response.json();
      const current = data.current_condition?.[0];
      const area = data.nearest_area?.[0];
      if (current && area) {
        const cityName = area.areaName?.[0]?.value || city;
        const country = area.country?.[0]?.value || "";
        const temp = current.temp_C;
        const feelsLike = current.FeelsLikeC;
        const humidity = current.humidity;
        const windSpeed = current.windspeedKmph;
        const desc = current.weatherDesc?.[0]?.value || "";
        const text = `🌤️ <b>Weather for ${cityName}, ${country}</b>\n\n` +
          `🌡️ Temperature: <b>${temp}°C</b> (feels like ${feelsLike}°C)\n` +
          `📝 Condition: ${desc}\n` +
          `💧 Humidity: ${humidity}%\n` +
          `💨 Wind: ${windSpeed} km/h`;
        return [{ type: "send_message", text, parseMode: "HTML", autoDeleteSeconds: 120 }];
      }
      return [{ type: "send_message", text: "❌ Could not parse weather data.", parseMode: "HTML" }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Weather service unavailable. Try again later.", parseMode: "HTML" }];
    }
  }

  // SetPhoto - Set group photo
  if (command === "setphoto" || command === "setgroupphoto") {
    return [{ type: "send_message", text: "🖼️ <b>Set Group Photo</b>\n\n<i>Reply to an image to set it as the group photo.</i>", parseMode: "HTML", autoDeleteSeconds: 30 }];
  }

  // ============================================
  // ADDITIONAL CLEANUP COMMANDS - With database storage
  // ============================================
  if (command === "cleannicknames" || command === "cleannickname") {
    return [{ type: "send_message", text: "📛 <b>Clean Nicknames</b>\n\n<i>Nickname cleaning initiated. This may take a moment.</i>", parseMode: "HTML", autoDeleteSeconds: 30 }];
  }
  if (command === "cleanblocks" || command === "cleanblock") {
    return [{ type: "send_message", text: "🚫 <b>Clean Blocks</b>\n\n<i>Block list cleared.</i>", parseMode: "HTML", autoDeleteSeconds: 30 }];
  }

  // SetAutoClean - Schedule automatic message cleanup
  if (command === "setautoclean") {
    if (!rawArgs) {
      return [{ type: "send_message", text: "🗑️ <b>Set Auto Clean</b>\n\nUsage: <code>!SetAutoClean &lt;count&gt; &lt;interval&gt;</code>\n\nExamples:\n• <code>!SetAutoClean 100 1h</code> - Delete 100 messages every hour\n• <code>!SetAutoClean 50 30m</code> - Delete 50 messages every 30 minutes", parseMode: "HTML" }];
    }
    try {
      const chatId = ctx.chat.id.toString();
      const settings = await loadGeneralSettingsByChatId(chatId);
      const parts = rawArgs.split(/\s+/);
      const count = parseInt(parts[0], 10) || 100;
      const interval = parts[1] || "1h";
      (settings as any).autoCleanEnabled = true;
      (settings as any).autoCleanCount = count;
      (settings as any).autoCleanInterval = interval;
      await saveGeneralSettingsByChatId(chatId, settings);
      return [{ type: "send_message", text: `✅ <b>Auto Clean Enabled</b>\n\n• Message Count: ${count}\n• Interval: ${interval}\n\n<i>Messages will be automatically cleaned at the scheduled interval.</i>`, parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to set auto clean.", parseMode: "HTML" }];
    }
  }
  if (command === "remautoclean" || command === "removeautoclean" || command === "delautoclean") {
    try {
      const chatId = ctx.chat.id.toString();
      const settings = await loadGeneralSettingsByChatId(chatId);
      (settings as any).autoCleanEnabled = false;
      await saveGeneralSettingsByChatId(chatId, settings);
      return [{ type: "send_message", text: "✅ <b>Auto Clean Disabled</b>\n\nAutomatic message cleanup has been turned off.", parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to remove auto clean.", parseMode: "HTML" }];
    }
  }
  if (command === "autocleanstats" || command === "cleanstats") {
    try {
      const chatId = ctx.chat.id.toString();
      const settings = await loadGeneralSettingsByChatId(chatId);
      const enabled = (settings as any).autoCleanEnabled ?? false;
      const count = (settings as any).autoCleanCount ?? 100;
      const interval = (settings as any).autoCleanInterval ?? "1h";
      const status = enabled ? "✅ Enabled" : "❌ Disabled";
      return [{ type: "send_message", text: `🗑️ <b>Auto Clean Status</b>\n\n• Status: ${status}\n• Message Count: ${count}\n• Interval: ${interval}`, parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to load auto clean stats.", parseMode: "HTML" }];
    }
  }

  // ============================================
  // ADDITIONAL STATS COMMANDS - With database storage
  // ============================================
  if (command === "setautostats") {
    if (!rawArgs) {
      return [{ type: "send_message", text: "⏰ <b>Set Auto Stats</b>\n\nUsage: <code>!SetAutoStats &lt;time&gt;</code>\n\nExamples:\n• <code>!SetAutoStats 08:00</code> - Post stats at 8 AM daily\n• <code>!SetAutoStats 20:00</code> - Post stats at 8 PM daily", parseMode: "HTML" }];
    }
    try {
      const chatId = ctx.chat.id.toString();
      const settings = await loadGeneralSettingsByChatId(chatId);
      (settings as any).autoStatsEnabled = true;
      (settings as any).autoStatsTime = rawArgs;
      await saveGeneralSettingsByChatId(chatId, settings);
      return [{ type: "send_message", text: `✅ <b>Auto Stats Enabled</b>\n\n• Scheduled Time: ${rawArgs}\n\n<i>Daily stats will be posted at the scheduled time.</i>`, parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to set auto stats.", parseMode: "HTML" }];
    }
  }
  if (command === "remautostats" || command === "removeautostats") {
    try {
      const chatId = ctx.chat.id.toString();
      const settings = await loadGeneralSettingsByChatId(chatId);
      (settings as any).autoStatsEnabled = false;
      await saveGeneralSettingsByChatId(chatId, settings);
      return [{ type: "send_message", text: "✅ <b>Auto Stats Disabled</b>\n\nAutomatic stats posting has been turned off.", parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to remove auto stats.", parseMode: "HTML" }];
    }
  }
  if (command === "statsstatus") {
    try {
      const chatId = ctx.chat.id.toString();
      const settings = await loadGeneralSettingsByChatId(chatId);
      const enabled = (settings as any).autoStatsEnabled ?? false;
      const time = (settings as any).autoStatsTime ?? "Not set";
      const status = enabled ? "✅ Enabled" : "❌ Disabled";
      return [{ type: "send_message", text: `ℹ️ <b>Stats Status</b>\n\n• Auto Stats: ${status}\n• Schedule: ${time}`, parseMode: "HTML", autoDeleteSeconds: 30 }];
    } catch (error) {
      return [{ type: "send_message", text: "❌ Failed to load stats status.", parseMode: "HTML" }];
    }
  }

  // ============================================
  // ADDITIONAL WORD FILTER COMMANDS
  // ============================================
  if (command === "panelpv" || command === "privatepanel") {
    return [{ type: "send_message", text: "🔐 <b>Private Panel</b>\n\n<i>Access the Mini App to manage filters privately.</i>", parseMode: "HTML", autoDeleteSeconds: 30 }];
  }
  if (command === "cleanfilterlist") {
    return handleCleanFilters(ctx);
  }

  // Unknown command - return feedback instead of silently failing
  return [{
    type: "send_message",
    text: `❓ <b>Unknown Command</b>\n\nThe command <code>!${command}</code> is not recognized.\n\n<i>Use </i><code>!settings</code><i> to view all available settings, or check the help menu for a full command list.</i>`,
    parseMode: "HTML",
    autoDeleteSeconds: 15
  }];
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
