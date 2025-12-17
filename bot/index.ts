import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { Markup, Telegraf, type Context } from "telegraf";

// Import validation utilities
import {
  validateTelegramUserId,
  validateTelegramChatId,
  validateCreditAmount,
  validateXpReward,
  validateTelegramChannelLink,
  validateButtonLabel,
  validateMessage,
  validateJson
} from "../src/utils/validation.js";

import { loadBotContent } from "./content.js";
import { renderTemplate, resolveUserDisplayName } from "./templating.js";
import { installFirewall, invalidateFirewallCache } from "./firewall.js";
import { installProcessingPipeline } from "./processing/index.js";
import { startTrialMonitor } from "./jobs/trialMonitor.js";
import { startAdminMonitor } from "./jobs/adminMonitor.js";
import { startMissionResetJob } from "./jobs/missionReset.js";
import { startInactivityMonitor } from "./jobs/inactivityMonitor.js";
import { startExpiredGroupsMonitor } from "../server/services/expiredGroupService.js";
import { fetchGroupsFromDb, fetchOwnerWalletBalance } from "../server/db/stateRepository.js";
import { checkDatabaseHealth } from "../server/utils/health.js";
import { createApiRouter } from "../server/api/router.js";
import { logger } from "../server/utils/logger.js";
import {
  appendStarsTransactionMetadata,
  extractTransactionIdFromPayload,
  finalizeStarsPurchase,
  getStarsWalletSummary,
  normalizeGroupMetadata,
  purchaseStars,
  refundStarsTransaction,
} from "../server/services/starsService.js";
import { findStarsReconciliationIssues } from "../server/services/starsReconciliation.js";
import { createPromoSlide } from "../server/services/promoSlideService.js";
import {
  buildStarsOverview,
  loadGroupsSnapshot,
  resolveStarsBalance,
  searchGroupRecords,
  type ManagedGroup,
  type StarsOverview,
} from "../server/services/dashboardService.js";
import {
  type BanRuleKey,
  type GroupBanSettingsRecord,
  loadBanSettingsByChatId,
  saveBanSettingsByChatId,
  loadGeneralSettingsByChatId,
  saveGeneralSettingsByChatId,
} from "../server/db/groupSettingsRepository.js";
import {
  getUserPanelSettings,
  setUserLockOverride,
  type UserLockOverrideState as UserLockState,
} from "../server/db/userPanelRepository.js";
import { extractCreditCode, redeemCreditCode } from "../server/services/creditCodeService.js";
import { recordGroupCreditRenewal } from "../server/services/missionVerificationService.js";
import {
  addBannedUser,
  addPanelAdmin,
  addPromoSlide,
  getPanelSettings,
  getPromoSlides,
  getState,
  getStarsState,
  isPanelAdmin,
  listBannedUsers,
  listGroups,
  listPanelAdmins,
  recordBroadcast,
  removeBannedUser,
  removePanelAdmin,
  removePromoSlide,
  setButtonLabels,
  setPanelSettings,
  setWelcomeMessages,
  readOwnerSessionState,
  writeOwnerSessionState,
  type GroupRecord,
  type StarsPlanRecord,
  type StarsState,
  type StarsPurchaseInput,
  type PromoSlideRecord,
  type OwnerSessionState,
  upsertGroup,
  listGroupsWithoutOwner,
  fixGroupOwnership,
  // Free/Premium system
  getPendingGroupSetup,
  removePendingGroupSetup,
  finalizeGroupAsFree,
  finalizeGroupAsPremium,
  canUserAddFreeGroup,
  getUserFreeGroupCount,
  listFreeGroups,
  isGroupPremium,
  type PendingGroupSetup,
} from "./state.js";
import { registerPromoStaticRoutes } from "../server/services/promoMediaStorage.js";
import type { FirewallRuleConfig, RuleAction, RuleCondition, RuleEscalation } from "../shared/firewall.js";
import { requireEnv, optionalWarnEnv } from "../server/utils/env.js";

requireEnv(["BOT_TOKEN", "BOT_OWNER_ID", "MINI_APP_URL"], "bot startup");
optionalWarnEnv(["CHANNEL_URL", "ADD_TO_GROUP_URL"], "bot startup");

const BOT_TOKEN = process.env.BOT_TOKEN!;

const content = loadBotContent();
const bot = new Telegraf(BOT_TOKEN);
installFirewall(bot);
installProcessingPipeline(bot);

const ownerConfigPath = resolve(dirname(fileURLToPath(import.meta.url)), "../public/daily-task.json");

type DailyTaskConfig = {
  channelLink: string;
  buttonLabel: string;
  description: string;
  xp: number;
  updatedAt: string;
};

function loadDailyTaskConfig(): DailyTaskConfig | null {
  try {
    const raw = readFileSync(ownerConfigPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DailyTaskConfig>;
    if (!parsed.channelLink || !parsed.buttonLabel || !parsed.description || typeof parsed.xp !== "number") {
      return null;
    }
    return {
      channelLink: parsed.channelLink,
      buttonLabel: parsed.buttonLabel,
      description: parsed.description,
      xp: parsed.xp,
      updatedAt: parsed.updatedAt ?? new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function saveDailyTaskConfig(config: DailyTaskConfig): void {
  writeFileSync(ownerConfigPath, JSON.stringify(config, null, 2), "utf8");
}

let dailyTaskConfig = loadDailyTaskConfig();

function formatDailyTaskSummary(config: DailyTaskConfig | null): string {
  if (!config) {
    return 'No daily task channel is configured yet.';
  }
  return `Current configuration:
- Channel: ${config.channelLink}
- Button: ${config.buttonLabel}
- Description: ${config.description}
- XP Reward: ${config.xp}`;
}

const ACTIONS = {
  channel: "fw_channel_placeholder",
  commands: "fw_commands_placeholder",
  info: "fw_info_placeholder",
  managementBack: "fw_management_back_to_start",
  inlinePanel: "fw_inline_panel_placeholder",
  managementPanel: "fw_open_management_panel",
  missingAddToGroup: "fw_missing_add_to_group",
  ownerBackToPanel: "fw_owner_back_to_panel",
  ownerManageAdmins: "fw_owner_manage_admins",
  ownerAddAdmin: "fw_owner_add_admin",
  ownerRemoveAdmin: "fw_owner_remove_admin",
  ownerManageGroup: "fw_owner_manage_group",
  ownerAdjustCredit: "fw_owner_adjust_credit",
  ownerIncreaseCredit: "fw_owner_increase_credit",
  ownerDecreaseCredit: "fw_owner_decrease_credit",
  ownerReconcileStars: "fw_owner_reconcile_stars",
  ownerBroadcast: "fw_owner_broadcast",
  ownerStatistics: "fw_owner_statistics",
  ownerSettings: "fw_owner_settings",
  ownerSettingsFreeDays: "fw_owner_settings_free_days",
  ownerSettingsStars: "fw_owner_settings_stars",
  ownerSettingsWelcomeMessages: "fw_owner_settings_welcome_messages",
  ownerSettingsGpidHelp: "fw_owner_settings_gpid_help",
  ownerSettingsLabels: "fw_owner_settings_labels",
  ownerSettingsChannelText: "fw_owner_settings_channel_text",
  ownerSettingsInfoCommands: "fw_owner_settings_info_commands",
  ownerMainMenu: "fw_owner_main_menu",
  ownerSliderMenu: "fw_owner_slider_menu",
  ownerSliderView: "fw_owner_slider_view",
  ownerSliderAdd: "fw_owner_slider_add",
  ownerSliderRemove: "fw_owner_slider_remove",
  ownerDailyTask: "fw_owner_daily_task",
  ownerBanMenu: "fw_owner_ban_menu",
  ownerBanAdd: "fw_owner_ban_add",
  ownerBanRemove: "fw_owner_ban_remove",
  ownerCreditCodes: "fw_owner_credit_codes",
  ownerCreateCreditCode: "fw_owner_create_credit_code",
  ownerListCreditCodes: "fw_owner_list_credit_codes",
  ownerDeleteCreditCode: "fw_owner_delete_credit_code",
  ownerBanList: "fw_owner_ban_list",
  ownerFirewallMenu: "fw_owner_firewall_menu",
  ownerFirewallRefresh: "fw_owner_firewall_refresh",
  ownerFirewallAdd: "fw_owner_firewall_add",
  ownerFirewallView: "fw_owner_firewall_view",
  ownerFirewallToggle: "fw_owner_firewall_toggle",
  ownerFirewallDelete: "fw_owner_firewall_delete",
  ownerFirewallEdit: "fw_owner_firewall_edit",
  ownerResetBot: "fw_owner_reset_bot",
  ownerAdBanner: "fw_owner_ad_banner",
  ownerAdBannerConfirm: "fw_owner_ad_banner_confirm",
  ownerAdBannerCancel: "fw_owner_ad_banner_cancel"
} as const;

type ActionKey = keyof typeof ACTIONS;

function actionId(key: ActionKey): string {
  return ACTIONS[key];
}

const DAY_MS = 86_400_000;

type StarsOverviewResponse = StarsOverview;

type StarsPurchaseResponse = {
  groupId: string;
  planId: string;
  daysAdded: number;
  expiresAt: string;
  balanceDelta: number;
  gifted: boolean;
};

function escapeMarkdownV2(input: string): string {
  return input.replace(/[\\_*\[\]()~`>#+\-=|{}.!]/g, (char) => `\\${char}`);
}

const startPayload = process.env.START_PAYLOAD ?? "fw01";
const botUsername = process.env.BOT_USERNAME;
const explicitAddToGroupUrl = process.env.ADD_TO_GROUP_URL;
const addToGroupUrl =
  explicitAddToGroupUrl ??
  (botUsername ? `https://t.me/${botUsername}?startgroup=inpvbtn&admin=delete_messages+restrict_members+invite_users` : undefined);

const miniAppUrl = process.env.MINI_APP_URL;

if (!miniAppUrl) {
  throw new Error("MINI_APP_URL is required to build the management panel flow");
}

const channelUrl = process.env.CHANNEL_URL;
const ownerUserId = process.env.BOT_OWNER_ID?.trim();
if (!ownerUserId) {
  throw new Error("BOT_OWNER_ID is required to enable the owner panel flow");
}

const panelAdminsProvider = () => listPanelAdmins();
startTrialMonitor(bot, { ownerId: ownerUserId, getPanelAdmins: panelAdminsProvider });
startAdminMonitor(bot, { ownerId: ownerUserId, getPanelAdmins: panelAdminsProvider });
startInactivityMonitor(bot, { ownerId: ownerUserId, getPanelAdmins: panelAdminsProvider });
startExpiredGroupsMonitor(bot);
void startMissionResetJob();

const REQUIRED_SLIDE_WIDTH = 960;
const REQUIRED_SLIDE_HEIGHT = 360;

const databaseAvailable = Boolean(process.env.DATABASE_URL);

type InlineKeyboard = ReturnType<typeof Markup.inlineKeyboard>;

type InlineLockItem = {
  id: string;
  keys: BanRuleKey[];
  label: string;
  page: 1 | 2 | 3;
};

type InlineListId =
  | "owners"
  | "admins"
  | "vip"
  | "muted"
  | "banned"
  | "warnings"
  | "exempt"
  | "filters"
  | "whitelist"
  | "forward_whitelist"
  | "auto_replies"
  | "scheduled_posts";

type InlineListConfig = {
  id: InlineListId;
  title: string;
  supportsAdd: boolean;
  commandUsage?: string;
  commandExample?: string;
  addPrompt?: string;
  description?: string;
};

const INLINE_LOCK_ITEMS: InlineLockItem[] = [
  // Page 1: Links & Content Restrictions (10 items)
  { id: "links", keys: ["banLinks"], label: "🔗 Links", page: 1 },
  { id: "domains", keys: ["banDomains"], label: "🌐 Domains", page: 1 },
  { id: "usernames", keys: ["banUsernames"], label: "👤 Usernames", page: 1 },
  { id: "hashtags", keys: ["banHashtags"], label: "#️⃣ Hashtags", page: 1 },
  { id: "latin", keys: ["banLatin"], label: "🔤 Latin", page: 1 },
  { id: "persian", keys: ["banPersian"], label: "🔡 Persian", page: 1 },
  { id: "text_patterns", keys: ["banTextPatterns"], label: "📝 Text Patterns", page: 1 },
  { id: "emojis", keys: ["banEmojis"], label: "😀 Emojis", page: 1 },
  { id: "forward", keys: ["banForward"], label: "↪️ Forward", page: 1 },
  { id: "forward_channels", keys: ["banForwardChannels"], label: "📢 Forward Channels", page: 1 },

  // Page 2: Media & Files (12 items)
  { id: "photos", keys: ["banPhotos"], label: "🖼️ Photos", page: 2 },
  { id: "videos", keys: ["banVideos"], label: "🎬 Videos", page: 2 },
  { id: "audio", keys: ["banAudio"], label: "🎵 Audio", page: 2 },
  { id: "voice", keys: ["banVoice"], label: "🎤 Voice", page: 2 },
  { id: "gif", keys: ["banGif"], label: "🎞️ GIF", page: 2 },
  { id: "stickers", keys: ["banStickers"], label: "🎨 Stickers", page: 2 },
  { id: "files", keys: ["banFiles"], label: "📁 Files", page: 2 },
  { id: "location", keys: ["banLocation"], label: "📍 Location", page: 2 },
  { id: "apps", keys: ["banApps"], label: "📱 Apps", page: 2 },
  { id: "inline_keyboards", keys: ["banInlineKeyboards"], label: "⌨️ Inline Keyboards", page: 2 },
  { id: "emoji_only", keys: ["banEmojiOnly"], label: "😊 Emoji Only", page: 2 },
  { id: "captionless", keys: ["banCaptionless"], label: "🚫 Captionless", page: 2 },

  // Page 3: Bots, Games & Advanced (11 items)
  { id: "bots", keys: ["banBots"], label: "🤖 Bots", page: 3 },
  { id: "bot_inviters", keys: ["banBotInviters"], label: "👥 Bot Inviters", page: 3 },
  { id: "tabchi", keys: ["banTabchi"], label: "🚫 Tabchi", page: 3 },
  { id: "advertiser", keys: ["banAdvertiser"], label: "📢 Advertisers", page: 3 },
  { id: "suspicious_bio", keys: ["banSuspiciousBio"], label: "📝 Suspicious Bio", page: 3 },
  { id: "phones", keys: ["banPhones"], label: "📞 Phone Numbers", page: 3 },
  { id: "games", keys: ["banGames"], label: "🎮 Games", page: 3 },
  { id: "polls", keys: ["banPolls"], label: "📊 Polls", page: 3 },
  { id: "slash_commands", keys: ["banSlashCommands"], label: "⚡ Slash Commands", page: 3 },
  { id: "cyrillic", keys: ["banCyrillic"], label: "🔠 Cyrillic", page: 3 },
  { id: "chinese", keys: ["banChinese"], label: "🈯 Chinese", page: 3 },
  { id: "user_replies", keys: ["banUserReplies"], label: "💬 User Replies", page: 3 },
  { id: "cross_replies", keys: ["banCrossReplies"], label: "🔀 Cross Replies", page: 3 },
];

const INLINE_LOCK_PAGE_SIZE = 6;

// ============================================
// USER PANEL CONFIGURATION
// ============================================

type UserLockOverrideState = 'default' | 'open' | 'locked';

type UserPanelLockItem = {
  id: string;
  key: string;
  label: string;
};

// Lock items for UserPanel - mirrors INLINE_LOCK_ITEMS but for per-user overrides
const USER_PANEL_LOCK_ITEMS: UserPanelLockItem[] = [
  { id: "hyperlink", key: "banLinks", label: "Hyperlink" },
  { id: "link", key: "banDomains", label: "Link" },
  { id: "hashtag", key: "banHashtags", label: "Hashtag" },
  { id: "username", key: "banUsernames", label: "Username" },
  { id: "persian", key: "banPersian", label: "Persian" },
  { id: "english", key: "banLatin", label: "English" },
  { id: "emoji_single", key: "banEmojiOnly", label: "Emoji Single" },
  { id: "file", key: "banFiles", label: "File" },
  { id: "inline_keyboard", key: "banInlineKeyboards", label: "Inline Keyboard" },
  { id: "forward", key: "banForward", label: "Forward" },
  { id: "media_edit", key: "banMediaEdit", label: "Media Edit" },
  { id: "message_edit", key: "banMessageEdit", label: "Message Edit" },
  { id: "voice", key: "banVoice", label: "Voice" },
  { id: "video", key: "banVideos", label: "Video" },
  { id: "photo", key: "banPhotos", label: "Photo" },
  { id: "animated_sticker", key: "banAnimatedStickers", label: "Animated Sticker" },
  { id: "sticker", key: "banStickers", label: "Sticker" },
  { id: "gif", key: "banGif", label: "GIF" },
  { id: "game", key: "banGames", label: "Game" },
  { id: "music", key: "banAudio", label: "Music" },
  { id: "selfie_video", key: "banVideoNotes", label: "Selfie Video" },
];

// Get state icon for UserPanel lock
function getUserLockStateIcon(state: UserLockOverrideState): string {
  switch (state) {
    case 'locked': return '🔐';
    case 'open': return 'Open';
    case 'default':
    default: return '✗';
  }
}

// Cycle to next state
function getNextLockState(current: UserLockOverrideState): UserLockOverrideState {
  switch (current) {
    case 'default': return 'open';
    case 'open': return 'locked';
    case 'locked': return 'default';
    default: return 'default';
  }
}

// ============================================
// HELP SECTION CONFIGURATION
// ============================================

type HelpSectionId =
  | "lock_management" | "settings" | "tabchi" | "user_panel"
  | "user_penalties" | "promote_demote" | "word_filter" | "cleanup"
  | "mandatory_add" | "welcome" | "mandatory_membership"
  | "activity_stats" | "entertainment";

type HelpSectionConfig = {
  id: HelpSectionId;
  icon: string;
  title: string;
  implemented: boolean;
};

const HELP_SECTIONS: HelpSectionConfig[] = [
  { id: "lock_management", icon: "🔒", title: "Lock Management", implemented: true },
  { id: "settings", icon: "⚙️", title: "Settings", implemented: true },
  { id: "tabchi", icon: "🚫", title: "Tabchi (Spam Bots)", implemented: true },
  { id: "user_panel", icon: "👤", title: "User Panel", implemented: true },
  { id: "user_penalties", icon: "⚠️", title: "User Penalties", implemented: true },
  { id: "promote_demote", icon: "👑", title: "Promote & Demote", implemented: true },
  { id: "word_filter", icon: "🚷", title: "Word Filter", implemented: true },
  { id: "cleanup", icon: "🧹", title: "Cleanup", implemented: true },
  { id: "mandatory_add", icon: "➕", title: "Mandatory Add", implemented: true },
  { id: "welcome", icon: "👋", title: "Welcome", implemented: true },
  { id: "mandatory_membership", icon: "📌", title: "Mandatory Membership", implemented: true },
  { id: "activity_stats", icon: "📊", title: "Activity Statistics", implemented: true },
  { id: "entertainment", icon: "🎮", title: "Entertainment & Utilities", implemented: true },
];

type LockHelpData = {
  id: string;
  name: string;
  icon: string;
  whatItDoes: string;
  example: string;
  commandAlias: string;
  miniAppPath: string;
  whenToUse: string;
  limitations: string;
};

const LOCK_HELP_DATA: LockHelpData[] = [
  // Links & Content
  { id: "links", name: "Telegram Links", icon: "🔗", whatItDoes: "Blocks all Telegram links (t.me, telegram.me)", example: "t.me/example", commandAlias: "link", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Links", whenToUse: "Prevent spam and unauthorized promotion", limitations: "Also blocks legitimate sharing links" },
  { id: "domains", name: "External URLs", icon: "🌐", whatItDoes: "Blocks all external website URLs", example: "google.com", commandAlias: "site", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Domains", whenToUse: "Prevent external link spam and phishing", limitations: "Blocks all URLs including safe ones" },
  { id: "usernames", name: "Usernames/Mentions", icon: "👤", whatItDoes: "Blocks @username mentions", example: "@username", commandAlias: "username", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Usernames", whenToUse: "Prevent tagging spam and promotion", limitations: "May affect legitimate mentions" },
  { id: "hashtags", name: "Hashtags", icon: "#️⃣", whatItDoes: "Blocks messages containing #hashtags", example: "#trending", commandAlias: "hashtag", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Hashtags", whenToUse: "Prevent hashtag spam", limitations: "Blocks all hashtags" },
  { id: "latin", name: "English/Latin Text", icon: "🔤", whatItDoes: "Blocks messages with Latin alphabet", example: "Hello, ABC", commandAlias: "english", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Latin", whenToUse: "Enforce non-English only groups", limitations: "Blocks any Latin characters" },
  { id: "persian", name: "Persian/Arabic Text", icon: "🔡", whatItDoes: "Blocks messages with Persian/Arabic script", example: "سلام", commandAlias: "persian", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Persian", whenToUse: "Enforce non-Persian groups", limitations: "Blocks all Arabic script" },
  { id: "text_patterns", name: "Text Patterns", icon: "📝", whatItDoes: "Blocks plain text messages", example: "Any text message", commandAlias: "text", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Text Patterns", whenToUse: "Media-only groups", limitations: "Blocks all text" },
  { id: "emojis", name: "Contains Emojis", icon: "😀", whatItDoes: "Blocks messages containing emojis", example: "Hello 😀", commandAlias: "emoji", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Emojis", whenToUse: "Professional/formal groups", limitations: "Blocks any emoji usage" },
  { id: "forward", name: "Forwarded Messages", icon: "↪️", whatItDoes: "Blocks all forwarded messages", example: "Forwarded message", commandAlias: "forward", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Forward", whenToUse: "Prevent content from elsewhere", limitations: "Use Forward Whitelist for exceptions" },
  { id: "forward_channels", name: "Channel Forwards", icon: "📢", whatItDoes: "Blocks messages forwarded from channels", example: "Forwarded from @channel", commandAlias: "channelforward", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Forward Channels", whenToUse: "Block channel promotions", limitations: "User forwards still allowed" },
  // Media & Files
  { id: "photos", name: "Photos", icon: "🖼️", whatItDoes: "Blocks image uploads", example: "[Photo]", commandAlias: "photo", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Photos", whenToUse: "Text-only discussions", limitations: "Blocks all images" },
  { id: "videos", name: "Videos", icon: "🎬", whatItDoes: "Blocks video uploads", example: "[Video]", commandAlias: "video", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Videos", whenToUse: "Reduce media clutter", limitations: "Blocks all video content" },
  { id: "audio", name: "Audio Files", icon: "🎵", whatItDoes: "Blocks audio file uploads", example: "[Audio.mp3]", commandAlias: "audio", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Audio", whenToUse: "Prevent music sharing", limitations: "Blocks all audio files" },
  { id: "voice", name: "Voice Messages", icon: "🎤", whatItDoes: "Blocks voice notes", example: "[Voice Note]", commandAlias: "voice", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Voice", whenToUse: "Keep discussions readable", limitations: "Blocks all voice messages" },
  { id: "gif", name: "GIFs/Animations", icon: "🎞️", whatItDoes: "Blocks animated GIFs", example: "[GIF]", commandAlias: "gif", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → GIF", whenToUse: "Reduce visual noise", limitations: "Blocks all animations" },
  { id: "stickers", name: "Stickers", icon: "🎨", whatItDoes: "Blocks sticker messages", example: "[Sticker]", commandAlias: "sticker", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Stickers", whenToUse: "Professional groups", limitations: "Blocks all stickers" },
  { id: "files", name: "Files/Documents", icon: "📁", whatItDoes: "Blocks document uploads", example: "[document.pdf]", commandAlias: "file", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Files", whenToUse: "Prevent file sharing", limitations: "Blocks all documents" },
  { id: "location", name: "Locations", icon: "📍", whatItDoes: "Blocks location sharing", example: "[Location]", commandAlias: "location", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Location", whenToUse: "Privacy concerns", limitations: "Blocks all location shares" },
  { id: "apps", name: "Apps/Software", icon: "📱", whatItDoes: "Blocks messages sent via specific unofficial apps or identifying as 'via AppName'.", example: "[App Message]", commandAlias: "app", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Apps", whenToUse: "Block third-party integrations", limitations: "May affect legitimate apps" },
  { id: "inline_keyboards", name: "Inline Keyboards", icon: "⌨️", whatItDoes: "Blocks messages with inline buttons", example: "[Buttons]", commandAlias: "inline", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Inline Keyboards", whenToUse: "Block bot interactions", limitations: "Blocks all inline buttons" },
  { id: "emoji_only", name: "Emoji-Only Messages", icon: "😊", whatItDoes: "Blocks messages with only emojis (no text)", example: "😀😀😀", commandAlias: "emojionly", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Emoji Only", whenToUse: "Prevent emoji spam", limitations: "Only pure emoji messages" },
  { id: "captionless", name: "Media Without Caption", icon: "🚫", whatItDoes: "Blocks media without captions", example: "[Photo no text]", commandAlias: "nocaption", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Captionless", whenToUse: "Require context for media", limitations: "All uncaptioned media" },
  // Bots & Advanced
  { id: "bots", name: "Bot Messages", icon: "🤖", whatItDoes: "Blocks messages from actual bot accounts", example: "@OtherBot message", commandAlias: "bot", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Bots", whenToUse: "Single-bot groups", limitations: "Blocks all bot messages" },
  { id: "bot_inviters", name: "Bot Inviters", icon: "👥", whatItDoes: "Bans users who add bots", example: "User adds @SpamBot", commandAlias: "botinviter", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Bot Inviters", whenToUse: "Prevent bot spam", limitations: "User gets banned" },
  { id: "tabchi", name: "Tabchi Detection", icon: "🚫", whatItDoes: "Detects and bans users who promote other groups/channels", example: "User advertising in multiple groups", commandAlias: "tabchi", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Tabchi", whenToUse: "Prevent cross-group advertising", limitations: "May affect legitimate promoters" },
  { id: "advertiser", name: "Advertisers", icon: "📢", whatItDoes: "Detects and blocks advertising behavior patterns", example: "User sending promotional content", commandAlias: "advertiser", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Advertisers", whenToUse: "Block spam/ad accounts", limitations: "Uses behavior analysis" },
  { id: "suspicious_bio", name: "Suspicious Bio", icon: "📝", whatItDoes: "Blocks users with suspicious profile bios", example: "Bio containing ads or spam links", commandAlias: "suspiciousbio", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Suspicious Bio", whenToUse: "Block spammer accounts", limitations: "May affect legitimate users" },
  { id: "phones", name: "Phone Numbers", icon: "📞", whatItDoes: "Blocks phone numbers", example: "+1234567890", commandAlias: "phone", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Phones", whenToUse: "Prevent contact sharing", limitations: "Blocks all phone formats" },
  { id: "games", name: "Games", icon: "🎮", whatItDoes: "Blocks Telegram games", example: "[Game]", commandAlias: "game", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Games", whenToUse: "Focus on discussions", limitations: "Blocks all games" },
  { id: "polls", name: "Polls", icon: "📊", whatItDoes: "Blocks poll creation", example: "[Poll]", commandAlias: "poll", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Polls", whenToUse: "Admin-only polling", limitations: "Blocks all polls" },
  { id: "slash_commands", name: "Slash Commands", icon: "⚡", whatItDoes: "Blocks /command messages", example: "/start, /help", commandAlias: "slash", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Slash Commands", whenToUse: "Prevent command spam", limitations: "Blocks all /commands" },
  { id: "cyrillic", name: "Cyrillic Text", icon: "🔠", whatItDoes: "Blocks Cyrillic alphabet messages", example: "Привет", commandAlias: "cyrillic", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Cyrillic", whenToUse: "Non-Russian groups", limitations: "Blocks all Cyrillic" },
  { id: "chinese", name: "Chinese Text", icon: "🈯", whatItDoes: "Blocks Chinese characters", example: "你好", commandAlias: "chinese", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Chinese", whenToUse: "Non-Chinese groups", limitations: "Blocks all Chinese text" },
  { id: "user_replies", name: "User Replies", icon: "💬", whatItDoes: "Blocks users from replying to each other's messages within the group", example: "Reply to message", commandAlias: "reply", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → User Replies", whenToUse: "Linear conversation only", limitations: "All reply messages" },
  { id: "cross_replies", name: "Cross-Chat Replies", icon: "🔀", whatItDoes: "Blocks users from replying to messages from OTHER channels or groups (e.g., linked channel comments)", example: "External reply", commandAlias: "crossreply", miniAppPath: "My Groups → Group Manage → Quick Menu → Content restriction → Cross Replies", whenToUse: "Isolated discussions", limitations: "External replies only" },
];

const HELP_LOCKS_PAGE_SIZE = 8;

// ============================================
// USER PENALTIES HELP DATA
// ============================================

type PenaltyHelpData = {
  id: string;
  name: string;
  icon: string;
  whatItDoes: string;
  example: string;
  commandEnable: string;
  commandDisable?: string;
  requiresReply: boolean;
  whenToUse: string;
  notes: string;
};

const PENALTY_HELP_DATA: PenaltyHelpData[] = [
  {
    id: "ban",
    name: "Ban",
    icon: "🚫",
    whatItDoes: "Permanently bans a user from the group. The user cannot rejoin until unbanned.",
    example: "Reply to a spammer's message and use the ban command",
    commandEnable: "!Ban",
    commandDisable: "!Unban [user_id]",
    requiresReply: true,
    whenToUse: "For severe violations, repeat offenders, or spammers",
    notes: "The banned user's message and your command are deleted."
  },
  {
    id: "ban_plus",
    name: "Ban Plus",
    icon: "⛔",
    whatItDoes: "Bans the user AND deletes all their recent messages from the group.",
    example: "Reply to spam messages to ban and clean up their content",
    commandEnable: "!Ban+",
    commandDisable: "!Unban [user_id]",
    requiresReply: true,
    whenToUse: "When you need to remove both the user and their spam content",
    notes: "Deletes recent messages from the banned user."
  },
  {
    id: "kick",
    name: "Kick",
    icon: "👢",
    whatItDoes: "Removes a user from the group but they can rejoin using an invite link.",
    example: "Reply to a user's message and kick them temporarily",
    commandEnable: "!Kick",
    requiresReply: true,
    whenToUse: "For minor violations, when you don't want to permanently ban",
    notes: "User can rejoin via invite link."
  },
  {
    id: "mute",
    name: "Mute",
    icon: "🔇",
    whatItDoes: "Permanently restricts a user from sending any messages in the group. (Unspecified duration is permanent)",
    example: "Reply to a disruptive user's message to mute them",
    commandEnable: "!Mute",
    commandDisable: "!Unmute (reply)",
    requiresReply: true,
    whenToUse: "For users who disrupt discussions but don't deserve a ban",
    notes: "User stays in group but cannot send messages."
  },
  {
    id: "temp_mute",
    name: "Temporary Mute",
    icon: "⏱️",
    whatItDoes: "Mutes a user for a specified duration. Auto-unmutes when time expires.",
    example: "!Mute 24 — mutes for 24 hours",
    commandEnable: "!Mute <hours>",
    commandDisable: "!Unmute (reply)",
    requiresReply: true,
    whenToUse: "Give users time to cool down before returning",
    notes: "Specify duration in hours (e.g., 24 = 24 hours)."
  },
  {
    id: "warn",
    name: "Warning",
    icon: "⚠️",
    whatItDoes: "Issues a formal warning. Warnings accumulate and can trigger auto-actions.",
    example: "Reply to a rule-breaking message to warn the user",
    commandEnable: "!Warn",
    commandDisable: "!Reset (clears warnings)",
    requiresReply: true,
    whenToUse: "For first-time or minor violations",
    notes: "Configure auto-mute/ban after X warnings in Advanced settings."
  },
];

const HELP_PENALTIES_PAGE_SIZE = 6;

// ============================================
// SETTINGS HELP DATA
// ============================================

type SettingsHelpData = {
  id: string;
  name: string;
  icon: string;
  whatItDoes: string;
  commands: string[];
};

const SETTINGS_HELP_DATA: SettingsHelpData[] = [
  {
    id: "view_settings",
    name: "View Settings",
    icon: "⚙️",
    whatItDoes: "View all your group's current settings, including active locks, verification status, and other configurations.",
    commands: ["!Settings", "!Status", "!Info"],
  },
  {
    id: "media_lock",
    name: "Media Lock",
    icon: "🖼️",
    whatItDoes: "Control which types of media can be sent. Lock photos, videos, GIFs, stickers, voice messages, and other media types.",
    commands: ["!Lock photo", "!Lock video", "!Lock sticker", "!Lock voice", "!Lock gif", "!Unlock [type]"],
  },
  {
    id: "message_limit",
    name: "Word/Character Limits",
    icon: "📏",
    whatItDoes: "Set minimum and maximum character/word limits for messages. Messages outside these limits are automatically deleted.",
    commands: ["!MaxWords <count>", "!MinWords <count>"],
  },
  {
    id: "add_admin",
    name: "Add Admin",
    icon: "👑",
    whatItDoes: "Add new bot admins to your group with special permissions. Manage or remove admins added by the bot.",
    commands: ["!AddAdmin", "!RemAdmin", "!AdminList"],
  },
  {
    id: "strict_mode",
    name: "Strict Mode",
    icon: "🔐",
    whatItDoes: "When enabled, rules apply to everyone including admins. When disabled, admins are exempt from most restrictions.",
    commands: ["!Strict on", "!Strict off", "!AdminLock on (Alias)"],
  },
  {
    id: "auto_lock",
    name: "Auto Lock (Silence)",
    icon: "🔒",
    whatItDoes: "Automatically lock the group at specified times. Non-admin messages are deleted during locked periods.",
    commands: ["!Silence1 from <HH:MM> to <HH:MM>", "!Silence1 off", "!ClearSilence"],
  },
  {
    id: "group_lock",
    name: "Group Lock",
    icon: "🚨",
    whatItDoes: "Emergency lock the entire group. Only admins can send messages. Useful for spam attacks or announcements.",
    commands: ["!LockGroup", "!UnlockGroup"],
  },
  {
    id: "flood_control",
    name: "Flood Control",
    icon: "🌊",
    whatItDoes: "Prevent message flooding. Users sending too many messages in a short time are automatically muted. Use !MsgLimit to set per-window limits.",
    commands: ["!Flood on", "!Flood off", "!SetFlood <count> <seconds>", "!MsgLimit <count>"],
  },
];

// ============================================
// PROMOTE & DEMOTE HELP DATA
// ============================================

type RankHelpData = {
  id: string;
  name: string;
  icon: string;
  description: string;
  commands: { label: string; command: string }[];
  notes: string;
};

const RANK_HELP_DATA: RankHelpData[] = [
  {
    id: "owner",
    name: "Owner",
    icon: "👑",
    description: "Highest access level in the group. Owners can change all settings without restrictions and promote/demote users (except other owners).",
    commands: [
      { label: "Set Owner", command: "!SetOwner" },
      { label: "Remove Owner", command: "!RemOwner" },
      { label: "Owner List", command: "!OwnerList" },
      { label: "Clean Owner List", command: "!CleanOwnerList" },
    ],
    notes: "Commands work with reply, @username, or numeric ID.",
  },
  {
    id: "manager",
    name: "Manager",
    icon: "👤",
    description: "Managers can change most settings and restrict/ban regular users. Owners can customize each manager's permissions.",
    commands: [
      { label: "Promote", command: "!Promote" },
      { label: "Demote", command: "!Demote" },
      { label: "Mod List", command: "!ModList" },
      { label: "Clean Mod List", command: "!CleanModList" },
    ],
    notes: "Use !Promote [hours] for temporary promotion.",
  },
  {
    id: "vip",
    name: "VIP/Special",
    icon: "⭐",
    description: "VIP members bypass all content restrictions. Their messages are never deleted or restricted by the bot.",
    commands: [
      { label: "Add VIP", command: "!VIP" },
      { label: "Remove VIP", command: "!RemVIP" },
      { label: "VIP List", command: "!VIPList" },
    ],
    notes: "Commands work with reply, @username, or numeric ID.",
  },
];

// ============================================
// CLEANUP HELP DATA
// ============================================

type CleanupHelpData = {
  id: string;
  name: string;
  icon: string;
  description: string;
  commands: string[];
};

const CLEANUP_HELP_DATA: CleanupHelpData[] = [
  {
    id: "messages",
    name: "Messages",
    icon: "💬",
    description: "Delete a specified number of messages from the group.\n\nIn groups with fewer than 100 members, cleanup is performed through the bot API (messages from the last 48 hours only).\n\nIn larger groups, install the companion bot for advanced cleanup by message type.\n\nAdmins can set up to five automatic cleanup schedules.",
    commands: ["!Del <count>", "!SetAutoClean", "!RemAutoClean", "!AutoCleanStats"],
  },
  {
    id: "bans",
    name: "Ban List",
    icon: "🚫",
    description: "Remove all banned users from the ban list and unban them.\n\n⚠️ Note: Due to Telegram API limits, the bot may not be able to list/unban older bans. Use the Mini App or manual commands for individual management.",
    commands: ["!CleanBans"],
  },
  {
    id: "warns",
    name: "Warning List",
    icon: "⚠️",
    description: "Clear all warning records from the bot's warning database for this group.",
    commands: ["!CleanWarns"],
  },
  {
    id: "mutes",
    name: "Mute List",
    icon: "🔇",
    description: "Unmute all muted users and clear the mute list.\n\n⚠️ Note: Due to Telegram API limits, the bot may not be able to list/unmute older mutes. Use the Mini App or manual commands.",
    commands: ["!CleanMutes"],
  },
  {
    id: "filters",
    name: "Filter Words",
    icon: "🚷",
    description: "Remove all filtered keywords from the word filter list.",
    commands: ["!CleanFilters"],
  },
  {
    id: "exempts",
    name: "Exempt Users",
    icon: "✅",
    description: "Remove all users from the exempt (whitelist) list.",
    commands: ["!CleanExempts"],
  },
  {
    id: "modlist",
    name: "Admin Users",
    icon: "👤",
    description: "Demote all bot-assigned managers from the group. Only the bot owner can use this command.",
    commands: ["!CleanModList"],
  },
  {
    id: "vips",
    name: "VIP Users",
    icon: "⭐",
    description: "Remove all VIP privileges from users in the group.",
    commands: ["!CleanVIPs"],
  },
  {
    id: "nicknames",
    name: "Nicknames",
    icon: "📛",
    description: "Clear all stored nicknames from the bot's database.",
    commands: ["!CleanNicknames"],
  },
  {
    id: "blocks",
    name: "Blocked Users",
    icon: "🚫",
    description: "Unblock all users from the bot's block list.",
    commands: ["!CleanBlocks"],
  },
  {
    id: "restricts",
    name: "Restricted Users",
    icon: "🔒",
    description: "Remove restrictions from all restricted users in the group.",
    commands: ["!CleanRestricts"],
  },
  {
    id: "bots",
    name: "Bots",
    icon: "🤖",
    description: "Remove all bots from the group (except Firewall). Only the bot owner can use this command.",
    commands: ["!CleanBots"],
  },
  {
    id: "fakes",
    name: "Fake Accounts",
    icon: "👻",
    description: "Kick all detected fake/suspicious accounts from the group.",
    commands: ["!CleanFakes"],
  },
  {
    id: "deleted",
    name: "Deleted Accounts",
    icon: "🗑️",
    description: "Remove all deleted (ghost) accounts from the group membership.",
    commands: ["!CleanDeleted"],
  },
];

// ============================================
// WORD FILTER HELP DATA
// ============================================

type WordFilterHelpData = {
  id: string;
  name: string;
  icon: string;
  summary: string;
  description: string;
  commands: { label: string; command: string }[];
  examples?: { description: string; command: string }[];
};

const WORDFILTER_HELP_DATA: WordFilterHelpData[] = [
  {
    id: "single",
    name: "Single Filtering",
    icon: "➊",
    summary: "Filter words one at a time with optional punishments",
    description: "Block specific words in the group. When a filtered word is sent, the bot deletes the message. Optionally, set a punishment for the sender (warn, ban, or mute).",
    commands: [
      { label: "AddFilter", command: "!AddFilter &lt;word&gt;" },
      { label: "FilterWarn", command: "!FilterWarn &lt;word&gt;" },
      { label: "FilterBan", command: "!FilterBan &lt;word&gt;" },
      { label: "FilterMute", command: "!FilterMute &lt;word&gt;" },
      { label: "RemFilter", command: "!RemFilter &lt;word&gt;" },
      { label: "FilterList", command: "!FilterList" },
      { label: "CleanFilterList", command: "!CleanFilterList" },
    ],
    examples: [
      { description: "Filter the word 'spam'", command: "!AddFilter spam" },
      { description: "Filter and warn sender", command: "!FilterWarn advertisement" },
    ],
  },
  {
    id: "continuous",
    name: "Continuous Filtering",
    icon: "➋",
    summary: "Enter filter mode to add multiple words quickly",
    description: "Efficient method for filtering multiple words at once. After sending the command, all words you type will be added to the filter list until you exit the mode.",
    commands: [
      { label: "Filter", command: "!Filter" },
    ],
    examples: [
      { description: "Start continuous filter mode", command: "!Filter" },
    ],
  },
  {
    id: "private",
    name: "Private Filtering",
    icon: "➌",
    summary: "Filter words privately via bot panel",
    description: "Manage filtered words without exposing commands in the group. Send the command in the group, then go to the bot's private chat and navigate to: Lists → Filter List.",
    commands: [
      { label: "PanelPV", command: "!PanelPV" },
    ],
    examples: [
      { description: "Open the private panel link", command: "!PanelPV" },
    ],
  },
];


// ============================================
// ACTIVITY STATISTICS HELP DATA
// ============================================

type StatsHelpData = {
  id: string;
  name: string;
  icon: string;
  summary: string;
  description: string;
  commands: { label: string; command: string }[];
  examples?: { description: string; command: string }[];
};

const STATS_HELP_DATA: StatsHelpData[] = [
  {
    id: "overview",
    name: "Group Stats Overview",
    icon: "📊",
    summary: "View the overall chat and add statistics for all users in the group",
    description: "Using this feature, group admins can view comprehensive statistics about user activity including chat messages and adds (user invitations). The bot displays a ranked list of users based on their contribution to the group.\n\nAdmins can see who is most active in the group and who has invited the most members.",
    commands: [
      { label: "Stats", command: "!Stats" },
      { label: "Stats (Alt)", command: ".Stats" },
    ],
    examples: [
      { description: "View group statistics", command: "!Stats" },
    ],
  },
  {
    id: "add_stats",
    name: "Add Stats",
    icon: "➕",
    summary: "View statistics for user invitations (adds) only",
    description: "This command shows statistics specifically for user invitations. See which members have invited the most new users to the group.\n\nUseful for tracking recruitment campaigns or rewarding active inviters.",
    commands: [
      { label: "AddStats", command: "!AddStats" },
      { label: "AddStats (Alt)", command: ".AddStats" },
    ],
    examples: [
      { description: "View add-only statistics", command: "!AddStats" },
    ],
  },
  {
    id: "rank_stats",
    name: "Rank Stats",
    icon: "👑",
    summary: "View statistics for admins and ranked members only",
    description: "This command displays activity statistics specifically for users who hold a rank in the group (owners, managers, VIPs).\n\nUseful for monitoring admin activity and ensuring ranked members are contributing to the group.",
    commands: [
      { label: "RankStats", command: "!RankStats" },
      { label: "RankStats (Alt)", command: ".RankStats" },
    ],
    examples: [
      { description: "View ranked members statistics", command: "!RankStats" },
    ],
  },
  {
    id: "custom_member",
    name: "Custom Member Count",
    icon: "🔢",
    summary: "View statistics for a specific number of top members",
    description: "Use this command to view statistics for a custom number of top users. Specify the number of members you want to see in the statistics.\n\nFor example, 'Stats 30 mem' will show the top 30 most active members.",
    commands: [
      { label: "Stats N mem", command: "!Stats &lt;N&gt; mem" },
    ],
    examples: [
      { description: "View top 30 members", command: "!Stats 30 mem" },
      { description: "View top 50 members", command: "!Stats 50 mem" },
    ],
  },
  {
    id: "total_stats",
    name: "Total Stats",
    icon: "📈",
    summary: "View all-time cumulative statistics for the group",
    description: "This command shows the total accumulated statistics since the bot was added to the group. Unlike regular stats which may be time-limited, this shows the complete picture of all activity.",
    commands: [
      { label: "TotalStats", command: "!TotalStats" },
      { label: "TotalStats (Alt)", command: ".TotalStats" },
    ],
    examples: [
      { description: "View all-time statistics", command: "!TotalStats" },
    ],
  },
  {
    id: "weekly_stats",
    name: "Weekly Stats",
    icon: "📅",
    summary: "View statistics for the current week only",
    description: "This command shows activity statistics for the current week. Useful for tracking weekly performance and comparing activity across different time periods.",
    commands: [
      { label: "WeeklyStats", command: "!WeeklyStats" },
      { label: "WeeklyStats (Alt)", command: ".WeeklyStats" },
    ],
    examples: [
      { description: "View this week's statistics", command: "!WeeklyStats" },
    ],
  },
  {
    id: "user_stats",
    name: "User Stats",
    icon: "👤",
    summary: "View detailed statistics for a specific user",
    description: "Reply to a user's message with this command to view their last 7 days of activity statistics. This provides a detailed breakdown of the user's contribution to the group.\n\nThis command requires replying to the target user's message.",
    commands: [
      { label: "UserStats", command: "!UserStats" },
      { label: "UserStats (Alt)", command: ".UserStats" },
    ],
    examples: [
      { description: "View user stats (reply to their message)", command: "!UserStats" },
    ],
  },
  {
    id: "auto_stats",
    name: "Auto Stats Schedule",
    icon: "⏰",
    summary: "Configure automatic stats posting at scheduled times",
    description: "Admins can enable automatic statistics posting. The bot will automatically send group statistics at the configured times.\n\nYou can set multiple schedules and the bot will post stats according to the configured intervals. Use RemAutoStats to disable a schedule.",
    commands: [
      { label: "SetAutoStats", command: "!SetAutoStats" },
      { label: "RemAutoStats", command: "!RemAutoStats" },
    ],
    examples: [
      { description: "Set up automatic stats schedule", command: "!SetAutoStats" },
      { description: "Remove automatic stats schedule", command: "!RemAutoStats" },
    ],
  },
  {
    id: "stats_status",
    name: "Stats Status",
    icon: "ℹ️",
    summary: "View current auto stats configuration",
    description: "This command shows the current status of automatic statistics posting, including all configured schedules and their timing.",
    commands: [
      { label: "StatsStatus", command: "!StatsStatus" },
      { label: "StatsStatus (Alt)", command: ".StatsStatus" },
    ],
    examples: [
      { description: "View auto stats status", command: "!StatsStatus" },
    ],
  },
];



// ============================================
// ENTERTAINMENT & UTILITIES HELP DATA
// ============================================

type EntertainmentHelpData = {
  id: string;
  name: string;
  icon: string;
  summary: string;
  description: string;
  commands: { label: string; command: string }[];
  examples?: { description: string; command: string }[];
};

const ENTERTAINMENT_HELP_DATA: EntertainmentHelpData[] = [
  {
    id: "font",
    name: "Stylish Fonts",
    icon: "🔤",
    summary: "Convert text to various stylish and decorative fonts",
    description: "Using this command, you can convert any text into beautiful and stylish fonts. The bot will display your text in multiple font variations that you can copy and use anywhere.",
    commands: [
      { label: "Font", command: "!Font &lt;text&gt;" },
      { label: "Alias", command: ".Font &lt;text&gt;" },
    ],
    examples: [
      { description: "Convert 'Hello' to stylish fonts", command: "!Font Hello" },
    ],
  },
  {
    id: "time",
    name: "Current Time",
    icon: "🕐",
    summary: "Display the current time based on user's timezone",
    description: "This command shows the current time. The time is displayed according to the user's configured timezone or the group's default timezone setting.\n\nAdmins can configure the default timezone in Advanced Settings → Timezone.",
    commands: [
      { label: "Time", command: "!Time" },
      { label: "Alias", command: ".Time" },
    ],
    examples: [
      { description: "Get current time", command: "!Time" },
    ],
  },
  {
    id: "echo",
    name: "Echo Message",
    icon: "📢",
    summary: "Echo/repeat a message through the bot",
    description: "The bot will repeat whatever text you send after the command. Useful for making announcements or repeating important messages.",
    commands: [
      { label: "Echo", command: "!Echo &lt;text&gt;" },
      { label: "Alias", command: ".Echo &lt;text&gt;" },
    ],
    examples: [
      { description: "Echo a message", command: "!Echo Welcome everyone!" },
    ],
  },
  {
    id: "news",
    name: "Latest News",
    icon: "📰",
    summary: "Get the latest news from reliable external sources",
    description: "Fetches and displays the latest news headlines from trusted and reliable external news sources. News is aggregated from reputable international news agencies only.",
    commands: [
      { label: "News", command: "!News" },
      { label: "Alias", command: ".News" },
    ],
    examples: [
      { description: "Get latest news", command: "!News" },
    ],
  },
  {
    id: "fortune",
    name: "Fortune/Horoscope",
    icon: "🔮",
    summary: "Get a random fortune or horoscope reading",
    description: "Receive a random fortune, daily horoscope, or inspirational message. Great for entertainment and adding some fun to your group.",
    commands: [
      { label: "Fortune", command: "!Fortune" },
      { label: "Fortune (Alt)", command: ".Fortune" },
    ],
    examples: [
      { description: "Get your fortune", command: "!Fortune" },
    ],
  },
  {
    id: "bio",
    name: "User Bio",
    icon: "📝",
    summary: "Set or view user biography/description",
    description: "View or set a custom biography for yourself or view another user's bio. Reply to a user's message to see their bio.",
    commands: [
      { label: "Bio", command: "!Bio" },
      { label: "SetBio", command: "!SetBio &lt;text&gt;" },
    ],
    examples: [
      { description: "View your bio", command: "!Bio" },
      { description: "Set your bio", command: "!SetBio I love coding!" },
    ],
  },
  {
    id: "calendar",
    name: "Calendar/Date",
    icon: "📅",
    summary: "Display current date and calendar information",
    description: "Shows the current date in multiple calendar formats including Gregorian, Persian (Jalali/Shamsi), and Islamic (Hijri) calendars.",
    commands: [
      { label: "Calendar", command: "!Calendar" },
      { label: "Date", command: "!Date" },
    ],
    examples: [
      { description: "Get current date", command: "!Calendar" },
    ],
  },
  {
    id: "sticker",
    name: "Sticker Maker",
    icon: "🎨",
    summary: "Create custom stickers from images or text",
    description: "Create custom Telegram stickers. Reply to an image to convert it to a sticker, or use text to create text-based stickers.",
    commands: [
      { label: "Sticker", command: "!Sticker" },
      { label: "Alias", command: "!MakeSticker" },
    ],
    examples: [
      { description: "Convert image to sticker (reply to image)", command: "!Sticker" },
    ],
  },
  {
    id: "azan",
    name: "Prayer Times",
    icon: "🕌",
    summary: "Get Islamic prayer times (Azan)",
    description: "Display the daily Islamic prayer times (Fajr, Dhuhr, Asr, Maghrib, Isha) based on location. Times are calculated for the configured city.",
    commands: [
      { label: "Azan", command: "!Azan" },
      { label: "PrayerTimes", command: "!PrayerTimes" },
    ],
    examples: [
      { description: "Get prayer times", command: "!Azan" },
    ],
  },
  {
    id: "joke",
    name: "Random Joke",
    icon: "😂",
    summary: "Get a random joke for entertainment",
    description: "The bot will send a random joke to entertain the group. Jokes are clean and appropriate for all audiences.",
    commands: [
      { label: "Joke", command: "!Joke" },
      { label: "Alias", command: ".Joke" },
    ],
    examples: [
      { description: "Get a random joke", command: "!Joke" },
    ],
  },
  {
    id: "poetry",
    name: "Random Poetry",
    icon: "📜",
    summary: "Get a random poem or verse",
    description: "Receive a random poem, verse, or literary quote. Great for adding culture and beauty to your group conversations.",
    commands: [
      { label: "Poetry", command: "!Poetry" },
      { label: "Alias", command: "!Poem" },
    ],
    examples: [
      { description: "Get a random poem", command: "!Poetry" },
    ],
  },
  {
    id: "translate",
    name: "Translation",
    icon: "🌐",
    summary: "Translate text between languages",
    description: "Translate text from one language to another. Specify the target language code followed by the text to translate, or reply to a message to translate it.",
    commands: [
      { label: "Translate", command: "!Translate &lt;lang&gt; &lt;text&gt;" },
      { label: "Alias", command: "!Tr &lt;lang&gt; &lt;text&gt;" },
    ],
    examples: [
      { description: "Translate to English", command: "!Translate en سلام" },
      { description: "Translate to Persian", command: "!Tr fa Hello" },
    ],
  },
  {
    id: "id",
    name: "User/Chat ID",
    icon: "🆔",
    summary: "Get user ID or chat ID information",
    description: "Display the numeric Telegram ID of a user or the current chat. Reply to a user's message to get their ID, or use without reply to get your own ID and the chat ID.",
    commands: [
      { label: "ID", command: "!ID" },
      { label: "Alias", command: ".ID" },
    ],
    examples: [
      { description: "Get your ID and chat ID", command: "!ID" },
    ],
  },
  {
    id: "currency",
    name: "Currency Rates",
    icon: "💰",
    summary: "Get live currency exchange rates",
    description: "Display current exchange rates for major currencies including USD, EUR, GBP, and more. Rates are fetched from reliable financial sources.",
    commands: [
      { label: "Currency", command: "!Currency" },
      { label: "Alias", command: "!Rate" },
    ],
    examples: [
      { description: "Get currency rates", command: "!Currency" },
    ],
  },
  {
    id: "info",
    name: "User/Chat Info",
    icon: "ℹ️",
    summary: "Get detailed information about user or chat",
    description: "Display detailed information about a user including their name, username, ID, and group membership status. Reply to a user's message to get their info.",
    commands: [
      { label: "Info", command: "!Info" },
      { label: "Alias", command: "!WhoIs" },
    ],
    examples: [
      { description: "Get user info (reply to user)", command: "!Info" },
    ],
  },
  {
    id: "joindate",
    name: "Join Date",
    icon: "📆",
    summary: "View when a user joined the group",
    description: "Shows the date and time when a user first joined the group. Reply to a user's message to see their join date, or use without reply to see your own.",
    commands: [
      { label: "JoinDate", command: "!JoinDate" },
      { label: "Alias", command: "!Joined" },
    ],
    examples: [
      { description: "Get your join date", command: "!JoinDate" },
    ],
  },
  {
    id: "origin",
    name: "User Origin",
    icon: "🔍",
    summary: "Check how a user joined the group",
    description: "Shows the origin/source of how a user joined the group (via invite link, added by another user, joined directly, etc.).",
    commands: [
      { label: "Origin", command: "!Origin" },
      { label: "Alias", command: "!Source" },
    ],
    examples: [
      { description: "Check user origin (reply to user)", command: "!Origin" },
    ],
  },
  {
    id: "tag",
    name: "Tag Users",
    icon: "🏷️",
    summary: "Tag/mention multiple users at once",
    description: "Mention multiple users or groups of users. Can tag all members, admins only, or specific roles. Useful for important announcements.",
    commands: [
      { label: "Tag All", command: "!Tag all" },
      { label: "Tag Admins", command: "!Tag admins" },
    ],
    examples: [
      { description: "Tag all members", command: "!Tag all" },
      { description: "Tag admins only", command: "!Tag admins" },
    ],
  },
  {
    id: "nickname",
    name: "Nickname",
    icon: "👤",
    summary: "Set or view user nicknames",
    description: "Assign a custom nickname to a user that will be displayed by the bot. Reply to a user to set their nickname or view existing nicknames.",
    commands: [
      { label: "SetNick", command: "!SetNick &lt;name&gt;" },
      { label: "Nick", command: "!Nick" },
      { label: "RemNick", command: "!RemNick" },
    ],
    examples: [
      { description: "Set a nickname (reply to user)", command: "!SetNick Boss" },
      { description: "Remove nickname", command: "!RemNick" },
    ],
  },
  {
    id: "profile",
    name: "User Profile",
    icon: "👥",
    summary: "View detailed user profile card",
    description: "Display a comprehensive profile card for a user including their photo, name, bio, activity statistics, join date, and group rank.",
    commands: [
      { label: "Profile", command: "!Profile" },
      { label: "Alias", command: ".Profile" },
    ],
    examples: [
      { description: "View your profile", command: "!Profile" },
    ],
  },
  {
    id: "meaning",
    name: "Word Meaning",
    icon: "📖",
    summary: "Get the definition/meaning of a word",
    description: "Look up the dictionary definition of any word. Supports multiple languages and provides detailed explanations with examples.",
    commands: [
      { label: "Meaning", command: "!Meaning &lt;word&gt;" },
      { label: "Define", command: "!Define &lt;word&gt;" },
    ],
    examples: [
      { description: "Get meaning of 'serendipity'", command: "!Meaning serendipity" },
    ],
  },
  {
    id: "rules",
    name: "Group Rules",
    icon: "📋",
    summary: "Display or set group rules",
    description: "View the current group rules, or admins can set/update the rules. The rules message will be pinned or sent as needed.",
    commands: [
      { label: "Rules", command: "!Rules" },
      { label: "SetRules", command: "!SetRules &lt;text&gt;" },
    ],
    examples: [
      { description: "View group rules", command: "!Rules" },
    ],
  },
  {
    id: "pin",
    name: "Pin Message",
    icon: "📌",
    summary: "Pin a message to the group",
    description: "Pin a message so it stays at the top of the chat. Reply to any message and use this command to pin it. Only admins can use this command.",
    commands: [
      { label: "Pin", command: "!Pin" },
      { label: "Unpin", command: "!Unpin" },
    ],
    examples: [
      { description: "Pin a message (reply to message)", command: "!Pin" },
    ],
  },
  {
    id: "getlink",
    name: "Get Invite Link",
    icon: "🔗",
    summary: "Get the group's invite link",
    description: "Generate or retrieve the group's invite link that can be shared with others to join the group. Only admins can generate new links.",
    commands: [
      { label: "GetLink", command: "!GetLink" },
      { label: "Alias", command: "!Link" },
    ],
    examples: [
      { description: "Get group invite link", command: "!GetLink" },
    ],
  },
  {
    id: "weather",
    name: "Weather",
    icon: "🌤️",
    summary: "Get weather information for a city",
    description: "Display current weather conditions and forecast for any city. Shows temperature, humidity, wind speed, and weather description.",
    commands: [
      { label: "Weather", command: "!Weather &lt;city&gt;" },
      { label: "Alias", command: ".Weather &lt;city&gt;" },
    ],
    examples: [
      { description: "Get weather for Tehran", command: "!Weather Tehran" },
      { description: "Get weather for London", command: "!Weather London" },
    ],
  },
  {
    id: "setphoto",
    name: "Photo Settings",
    icon: "🖼️",
    summary: "Adjust or set photo/image settings",
    description: "Configure photo-related settings for the group or set a profile photo. Reply to an image to set it as the group photo (admin only).",
    commands: [
      { label: "SetPhoto", command: "!SetPhoto" },
      { label: "Alias", command: "!SetGroupPhoto" },
    ],
    examples: [
      { description: "Set group photo (reply to image)", command: "!SetPhoto" },
    ],
  },
];

const MANDATORY_ADD_HELP_DATA: HelpItemConfig[] = [
  {
    id: "config",
    name: "Configuration",
    icon: "⚙️",
    summary: "Enable and configure Mandatory Add",
    description: "Commands to enable/disable the feature and set the number of invites required.",
    commands: [
      { label: "Enable", command: "!ForceAdd on" },
      { label: "Disable", command: "!ForceAdd off" },
      { label: "SetLimit", command: "!SetForceAdd &lt;count&gt;" },
      { label: "SetTime", command: "!ForceAddTime &lt;min&gt;" },
    ],
    examples: [
      { description: "Require 3 invites", command: "!SetForceAdd 3" },
      { description: "Allow 5 minutes before restricting", command: "!ForceAddTime 5" }
    ]
  },
  {
    id: "message",
    name: "Message Customization",
    icon: "📝",
    summary: "Customize the warning message",
    description: "Set a custom message to be displayed when a user tries to speak without meeting invite requirements.",
    commands: [
      { label: "SetMessage", command: "!SetForceAddText" },
      { label: "DelMessage", command: "!DelForceAddText" },
    ],
    examples: [
      { description: "Set custom text (interactive)", command: "!SetForceAddText" }
    ]
  },
  {
    id: "management",
    name: "Management & Info",
    icon: "📊",
    summary: "Manage records and check status",
    description: "View status, check user invites, and clean up Old/All add records.",
    commands: [
      { label: "Status", command: "!ForceAddStatus" },
      { label: "UserInfo", command: "!ForceAddInfo (reply)" },
      { label: "Clean Records", command: "!CleanForceAdd" }
    ],
    examples: []
  }
];

const MANDATORY_MEMBERSHIP_HELP_DATA: HelpItemConfig[] = [
  {
    id: "config",
    name: "Configuration",
    icon: "⚙️",
    summary: "Enable and configure Force Join",
    description: "Commands to enable/disable mandatory channel membership.",
    commands: [
      { label: "Enable", command: "!ForceJoin on" },
      { label: "Disable", command: "!ForceJoin off" },
      { label: "Status", command: "!ForceJoinStatus" }
    ],
    examples: []
  },
  {
    id: "message",
    name: "Message Customization",
    icon: "📝",
    summary: "Customize the warning message",
    description: "Set the message shown to users who haven't joined the channel.",
    commands: [
      { label: "SetMessage", command: "!SetForceJoinText &lt;text&gt;" },
      { label: "DelMessage", command: "!DelForceJoinText" }
    ],
    examples: [
      { description: "Set message", command: "!SetForceJoinText Please join our channel first!" }
    ]
  }
];

const INLINE_LIST_CONFIGS: InlineListConfig[] = [
  {
    id: "owners",
    title: "👑 Owners",
    supportsAdd: false,
    description: "Group owners/creators. This shows all users with 'creator' status in this group."
  },
  {
    id: "admins",
    title: "👥 Admins",
    supportsAdd: false,
    description: "Group administrators. Users with admin permissions who can manage the group."
  },
  {
    id: "vip",
    title: "⭐ VIP Members",
    supportsAdd: true,
    commandUsage: "!vip <username> or !vip <user_id>",
    commandExample: "!vip @john or !vip 123456789",
    addPrompt: "Send user ID or @username to add as VIP.\n\n💡 VIP members bypass all content restrictions.",
    description: "VIP users who bypass ALL content filtering rules. Their messages are never deleted or restricted."
  },
  {
    id: "muted",
    title: "🔇 Muted",
    supportsAdd: true,
    commandUsage: "!mute <hours> (reply to user)",
    commandExample: "!mute 24",
    addPrompt: "Send User ID to mute (permanently).\n\n⚠️ Note: Only User IDs are supported currently.",
    description: "Users who have been muted via !mute command. They cannot send messages until the mute expires."
  },
  {
    id: "banned",
    title: "🚫 Banned",
    supportsAdd: true,
    commandUsage: "!ban <hours> (reply to user)",
    commandExample: "!ban 1",
    addPrompt: "Send User ID to ban.\n\n⚠️ Note: Only User IDs are supported currently.",
    description: "Users who have been banned via !ban command. They are removed from the group and cannot rejoin."
  },
  {
    id: "warnings",
    title: "⚠️ Warnings",
    supportsAdd: false,
    commandUsage: "!reset (reply to user)",
    commandExample: "!reset",
    description: "Active warnings for users. After reaching the threshold, automatic action (mute/kick) is taken."
  },
  {
    id: "exempt",
    title: "✅ Exempt",
    supportsAdd: true,
    commandUsage: "!exempt <username> or !exempt <user_id>",
    commandExample: "!exempt @john",
    addPrompt: "Send user ID or @username to exempt from rules.\n\n💡 Exempt users are not affected by content restrictions.",
    description: "Users exempt from content filtering. Unlike VIP, they still receive warnings but messages aren't deleted."
  },
  {
    id: "filters",
    title: "🚷 Filtered Keywords",
    supportsAdd: true,
    commandUsage: "!filter <word>",
    commandExample: "!filter spam",
    addPrompt: "Send word(s) to filter.\n\n📝 Format:\n• Single: spam\n• Multiple: spam,scam,fake",
    description: "Blacklisted words that will be detected and messages containing them will be deleted."
  },
  {
    id: "whitelist",
    title: "✔️ Allowed Keywords",
    supportsAdd: true,
    commandUsage: "!whitelist (reply to message)",
    commandExample: "Reply to a message and send !whitelist",
    addPrompt: "Send word(s) to allow (comma-separated).",
    description: "Whitelisted words that are allowed even if they match other filters."
  },
  {
    id: "forward_whitelist",
    title: "↪️ Allowed Forwards",
    supportsAdd: true,
    commandUsage: "!allowforward <channel>",
    commandExample: "!allowforward @mychannel",
    addPrompt: "Send channel username (e.g., @channel) to allow forwards from.",
    description: "Channels that forwards are allowed from. If forward restriction is on, only these channels are permitted."
  },
  {
    id: "auto_replies",
    title: "🤖 Auto Replies",
    supportsAdd: true,
    commandUsage: "Inline Panel",
    commandExample: "Use ➕ Add button below",
    addPrompt: "📝 **Step 1/2: Enter Trigger Keyword**\n\nSend the keyword/phrase that will trigger this auto-reply.\n\nExample: `hello` or `price`",
    description: "Automatic responses to specific keywords or phrases."
  },
  {
    id: "scheduled_posts",
    title: "⏰ Scheduled Posts",
    supportsAdd: true,
    commandUsage: "Inline Panel",
    commandExample: "Use ➕ Add button below",
    addPrompt: "📝 **Step 1/2: Enter Message**\n\nSend the message content you want to schedule.\n\nYou can include text, emojis, etc.",
    description: "Posts scheduled to be sent automatically at specific times."
  },
];

// Inline session management for interactive list additions
type InlineSessionStep =
  | "awaiting_add_input"           // Single step input (filters, whitelist, etc.)
  | "awaiting_auto_reply_trigger"  // Step 1 for auto replies: keyword
  | "awaiting_auto_reply_response" // Step 2 for auto replies: response text
  | "awaiting_scheduled_message"   // Step 1 for scheduled posts: message content
  | "awaiting_scheduled_time";     // Step 2 for scheduled posts: schedule time

type InlineSession = {
  chatId: string;
  listId: InlineListId;
  step: InlineSessionStep;
  tempData?: {
    trigger?: string;           // For auto-reply: stores the trigger keyword
    scheduledMessage?: string;  // For scheduled post: stores the message content
  };
};
const inlineSessions = new Map<string, InlineSession>();

function setInlineSession(userId: string, session: InlineSession): void {
  inlineSessions.set(userId, session);
}

function getInlineSession(userId: string): InlineSession | undefined {
  return inlineSessions.get(userId);
}

function clearInlineSession(userId: string): void {
  inlineSessions.delete(userId);
}

// Group list statistics for inline panel
type GroupListStats = {
  ownersCount: number;
  adminsCount: number;
  vipCount: number;
  mutedCount: number;
  bannedCount: number;
  warningsCount: number;
  exemptCount: number;
  forwardWhitelistCount: number;
  autoRepliesCount: number;
  scheduledPostsCount: number;
};

async function loadGroupListStats(chatId: string): Promise<GroupListStats> {
  const stats: GroupListStats = {
    ownersCount: 0,
    adminsCount: 0,
    vipCount: 0,
    mutedCount: 0,
    bannedCount: 0,
    warningsCount: 0,
    exemptCount: 0,
    forwardWhitelistCount: 0,
    autoRepliesCount: 0,
    scheduledPostsCount: 0,
  };

  // Get group from in-memory list
  const groups = listGroups();
  const group = groups.find((g) => g.chatId === chatId);

  // Owner count - typically 1 if ownerId exists
  if (group?.ownerId) {
    stats.ownersCount = 1;
  }

  // Try to load from database if available
  if (!databaseAvailable) {
    return stats;
  }

  let prismaModule: { prisma: any };
  try {
    prismaModule = await import("../server/db/client.js");
  } catch {
    logger.warn("Failed to import prisma client", { chatId });
    return stats;
  }
  const { prisma } = prismaModule;

  // Find the group in database
  let dbGroup: { id: string; banSettings: unknown } | null = null;
  try {
    dbGroup = await prisma.group.findUnique({
      where: { telegramChatId: chatId },
      select: {
        id: true,
        banSettings: true,
      },
    });
  } catch (error) {
    logger.warn("Failed to find group in database", { chatId, error });
    return stats;
  }

  if (!dbGroup) {
    return stats;
  }

  // Count admins from GroupAdmin table (independent query)
  try {
    const adminsCount = await prisma.groupAdmin.count({
      where: { groupId: dbGroup.id },
    });
    stats.adminsCount = adminsCount;
  } catch (error) {
    logger.debug("Failed to count admins (table may not exist)", { chatId, error: (error as Error).message });
  }

  // Count active warnings (independent query)
  try {
    const warningsCount = await prisma.userWarning.count({
      where: {
        groupId: dbGroup.id,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });
    stats.warningsCount = warningsCount;
  } catch (error) {
    logger.debug("Failed to count warnings (table may not exist)", { chatId, error: (error as Error).message });
  }

  // Count recent mute/ban actions (independent query)
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const mutedCount = await prisma.moderationAction.count({
      where: {
        groupId: dbGroup.id,
        action: { in: ["mute", "restrict"] },
        createdAt: { gte: thirtyDaysAgo },
      },
    });
    stats.mutedCount = mutedCount;

    const bannedCount = await prisma.moderationAction.count({
      where: {
        groupId: dbGroup.id,
        action: { in: ["ban", "kick"] },
        createdAt: { gte: thirtyDaysAgo },
      },
    });
    stats.bannedCount = bannedCount;
  } catch (error) {
    logger.debug("Failed to count muted/banned (table may not exist)", { chatId, error: (error as Error).message });
  }

  // Parse banSettings for VIP, exempt, forward whitelist (no database query needed)
  if (dbGroup.banSettings && typeof dbGroup.banSettings === "object") {
    const banSettings = dbGroup.banSettings as Record<string, unknown>;

    // VIP members (whitelist users who bypass all rules)
    if (Array.isArray(banSettings.vipMembers)) {
      stats.vipCount = banSettings.vipMembers.length;
    }

    // Exempt users
    if (Array.isArray(banSettings.exemptUsers)) {
      stats.exemptCount = banSettings.exemptUsers.length;
    }

    // Forward whitelist
    if (Array.isArray(banSettings.forwardWhitelist)) {
      stats.forwardWhitelistCount = banSettings.forwardWhitelist.length;
    }

    // Auto replies
    if (Array.isArray(banSettings.autoReplies)) {
      stats.autoRepliesCount = banSettings.autoReplies.length;
    }

    // Scheduled posts
    if (Array.isArray(banSettings.scheduledPosts)) {
      stats.scheduledPostsCount = banSettings.scheduledPosts.length;
    }
  }

  return stats;
}

function actorId(ctx: Context): string | null {
  const id = ctx.from?.id;
  return typeof id === "number" ? id.toString() : null;
}

function isOwner(ctx: Context): boolean {
  return actorId(ctx) === ownerUserId;
}

function isPanelOperator(ctx: Context): boolean {
  const id = actorId(ctx);
  if (!id) {
    return false;
  }
  if (id === ownerUserId) {
    return true;
  }
  return isPanelAdmin(id);
}

function isUserBanned(id: string): boolean {
  return listBannedUsers().includes(id);
}

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

async function ensureOwnerAccess(ctx: Context): Promise<boolean> {
  const id = actorId(ctx);
  if (!id) {
    await ctx.reply("Unable to verify your account.");
    return false;
  }

  if (id !== ownerUserId && isUserBanned(id)) {
    const message = "You are blocked from using the panel.";
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(message, { show_alert: true });
    } else {
      await ctx.reply(message);
    }
    return false;
  }

  if (isPanelOperator(ctx)) {
    return true;
  }

  const denialText = "Only the bot owner or designated panel admins can access this panel.";

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery(denialText, { show_alert: true });
  } else {
    await ctx.reply(denialText);
  }

  return false;
}

function buildStartKeyboard(): InlineKeyboard {
  const settings = getPanelSettings();
  const labels = settings.buttonLabels ?? {};
  const label = (key: string, fallback: string) => {
    const value = labels[key];
    return value && value.trim().length > 0 ? value : fallback;
  };

  return Markup.inlineKeyboard([
    [
      addToGroupUrl
        ? Markup.button.url(label("start_add_to_group", content.buttons.addToGroup), addToGroupUrl)
        : Markup.button.callback(label("start_add_to_group", content.buttons.addToGroup), actionId("missingAddToGroup"))
    ],
    [
      Markup.button.callback(label("start_management_panel", content.buttons.managementPanel), actionId("managementPanel")),
      channelUrl
        ? Markup.button.url(label("start_channel", content.buttons.channel), channelUrl)
        : Markup.button.callback(label("start_channel", content.buttons.channel), actionId("channel"))
    ],
    [
      Markup.button.callback("❓ Help", "fw_inline_help:global"),
      Markup.button.callback(label("start_info", content.buttons.info), actionId("info"))
    ]
  ]);
}

async function sendStartMenu(ctx: Context): Promise<void> {
  if (!isPrivateChat(ctx)) {
    const notice =
      "To see the management menu, open a private chat with the bot and send /start.";
    if (ctx.callbackQuery) {
      try {
        await ctx.answerCbQuery(notice, { show_alert: true });
      } catch {
        // ignore acknowledgement errors
      }
      return;
    }
    await ctx.reply(notice);
    return;
  }

  const settings = getPanelSettings();
  const userName = resolveUserDisplayName(ctx.from);
  const replacements = {
    user: userName,
    name: userName,
    username: ctx.from?.username ? `@${ctx.from.username}` : userName,
    first: ctx.from?.first_name ?? "",
    last: ctx.from?.last_name ?? "",
    group: ctx.chat && "title" in ctx.chat ? ctx.chat.title ?? "" : "",
  };

  const welcomeMessage = renderTemplate(content.messages.start, replacements);
  await replyOrEditRoot(ctx, welcomeMessage, buildStartKeyboard());

  for (const rawMessage of settings.welcomeMessages) {
    const formatted = renderTemplate(rawMessage, replacements).trim();
    if (formatted.length > 0) {
      // welcome message templates may include HTML tags; send as HTML
      try {
        await ctx.replyWithHTML(formatted);
      } catch {
        // fallback to plain reply if HTML fails
        await ctx.reply(formatted);
      }
    }
  }
}

function ownerNavigationRow() {
  const settings = getPanelSettings();
  const backLabel = settings.buttonLabels.owner_nav_back ?? "Back";
  const mainLabel = settings.buttonLabels.owner_nav_main ?? "Back to Main Menu";
  return [
    Markup.button.callback(backLabel, actionId("ownerBackToPanel")),
    Markup.button.callback(mainLabel, actionId("ownerMainMenu"))
  ];
}

function buildOwnerPanelKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback("👥 Panel Administrators", actionId("ownerManageAdmins"))],
    [Markup.button.callback("🏢 Group Management", actionId("ownerManageGroup"))],
    [Markup.button.callback("💳 Credit Adjustment", actionId("ownerAdjustCredit"))],
    [Markup.button.callback("🎁 Generate Credit Codes", actionId("ownerCreditCodes"))],
    [Markup.button.callback("⭐ Reconcile Stars", actionId("ownerReconcileStars"))],
    [Markup.button.callback("📢 Broadcast Messages", actionId("ownerBroadcast"))],
    [Markup.button.callback("📣 Send Ad Banner (Free Groups)", actionId("ownerAdBanner"))],
    [Markup.button.callback("📊 Global Statistics", actionId("ownerStatistics"))],
    [Markup.button.callback("⚙️ Global Configuration", actionId("ownerSettings"))],
    [Markup.button.callback("🛡️ Firewall Rules", actionId("ownerFirewallMenu"))],
    [Markup.button.callback("📋 Daily Task Channel", actionId("ownerDailyTask"))],
    [Markup.button.callback("🎨 Promo Slider", actionId("ownerSliderMenu"))],
    [Markup.button.callback("🚫 User Ban Management", actionId("ownerBanMenu"))],
    [Markup.button.callback("🔴 Reset Bot Completely", actionId("ownerResetBot"))],
    ownerNavigationRow()
  ]);
}

function buildCreditCodesKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ Create Credit Code", actionId("ownerCreateCreditCode"))],
    [Markup.button.callback("📋 List Credit Codes", actionId("ownerListCreditCodes"))],
    [Markup.button.callback("🗑️ Delete Credit Code", actionId("ownerDeleteCreditCode"))],
    ownerNavigationRow()
  ]);
}

function buildOwnerCreditKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Increase Credit", actionId("ownerIncreaseCredit"))],
    [Markup.button.callback("Decrease Credit", actionId("ownerDecreaseCredit"))],
    ownerNavigationRow()
  ]);
}

function buildOwnerSettingsKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Set Free Trial Days", actionId("ownerSettingsFreeDays"))],
    [Markup.button.callback("Set Monthly Stars", actionId("ownerSettingsStars"))],
    [Markup.button.callback("Edit Welcome Messages", actionId("ownerSettingsWelcomeMessages"))],
    [Markup.button.callback("Edit GPID Help Text", actionId("ownerSettingsGpidHelp"))],
    [Markup.button.callback("Edit Button Labels", actionId("ownerSettingsLabels"))],
    [Markup.button.callback("Edit Channel Text", actionId("ownerSettingsChannelText"))],
    [Markup.button.callback("Edit Info and Commands Text", actionId("ownerSettingsInfoCommands"))],
    ownerNavigationRow()
  ]);
}

function buildOwnerNavigationKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([ownerNavigationRow()]);
}

function buildOwnerSliderKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback("View Slides", actionId("ownerSliderView"))],
    [Markup.button.callback("Add Slide", actionId("ownerSliderAdd"))],
    [Markup.button.callback("Remove Slide", actionId("ownerSliderRemove"))],
    ownerNavigationRow()
  ]);
}

function buildSliderNavigationKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Back to Slider Menu", actionId("ownerSliderMenu"))],
    ownerNavigationRow()
  ]);
}

function buildOwnerBanKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Ban User", actionId("ownerBanAdd"))],
    [Markup.button.callback("Unban User", actionId("ownerBanRemove"))],
    [Markup.button.callback("Show Ban List", actionId("ownerBanList"))],
    ownerNavigationRow()
  ]);
}

function buildAdBannerConfirmKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Yes, Send to All", actionId("ownerAdBannerConfirm")),
      Markup.button.callback("❌ Cancel", actionId("ownerAdBannerCancel"))
    ],
    ownerNavigationRow()
  ]);
}

function buildOwnerAdminsKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ Add Admin", actionId("ownerAddAdmin"))],
    [Markup.button.callback("➖ Remove Admin", actionId("ownerRemoveAdmin"))],
    ownerNavigationRow()
  ]);
}

async function auditCreditAdjustment(params: {
  chatId: string;
  actorId: string | null;
  delta: number;
  beforeBalance: number;
  afterBalance: number;
}): Promise<void> {
  const { chatId, actorId, delta, beforeBalance, afterBalance } = params;
  logger.info("owner credit adjustment", {
    chatId,
    actorId,
    delta,
    beforeBalance,
    afterBalance,
  });

  if (!databaseAvailable) {
    return;
  }

  try {
    const { recordModerationAction } = await import("../server/db/mutateRepository.js");
    await recordModerationAction({
      chatId,
      action: "owner_credit_adjustment",
      actorId: actorId ?? null,
      userId: null,
      severity: null,
      reason: delta > 0 ? "increase" : "decrease",
      metadata: {
        delta,
        before: beforeBalance,
        after: afterBalance,
      },
    });
  } catch (error) {
    logger.warn("failed to persist credit adjustment audit", { chatId, error });
  }
}

function buildBanNavigationKeyboard(): InlineKeyboard {
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ Ban User", actionId("ownerBanAdd"))],
    [Markup.button.callback("➖ Unban User", actionId("ownerBanRemove"))],
    [Markup.button.callback("📋 View Ban List", actionId("ownerBanList"))],
    [Markup.button.callback("🔙 Back to Panel", actionId("ownerBackToPanel"))],
  ]);
}

const ownerMessages = {
  panelIntro:
    "🎛️ <b>Owner Control Panel</b>\n\nWelcome to your private management center. From here you can control all aspects of your Firewall bot:\n\n• 👥 Manage administrators\n• 🏢 Control groups & billing\n• 🎁 Generate credit codes\n• 📢 Send broadcasts\n• ⚙️ Configure global settings",
  adminsIntro:
    "👥 <b>Panel Administrators</b>\n\nManage who has access to your bot's dashboard. Choose an action below:",
  addAdmin: "➕ <b>Add Panel Administrator</b>\n\nSend the numeric Telegram user ID of the person you want to promote to admin.\n\n<i>Example: 123456789</i>",
  removeAdmin: "➖ <b>Remove Panel Administrator</b>\n\nSend the numeric Telegram user ID of the admin you want to remove from the panel.\n\n<i>Example: 123456789</i>",
  manageGroup: "🏢 <b>Group Management</b>\n\nEnter the target chat ID to open the management session for that specific group.\n\n<i>Example: -1001234567890</i>",
  creditIntro:
    "💳 <b>Manual Credit Adjustment</b>\n\nChoose whether you want to increase or decrease the credit balance for a specific group:",
  increaseCredit: "➕ <b>Increase Group Credit</b>\n\nSend the chat ID and the amount to add, separated by a space.\n\n<i>Example: -1001234567890 7</i>\n\n💡 This will add 7 days of credit to the group.",
  decreaseCredit: "➖ <b>Decrease Group Credit</b>\n\nSend the chat ID and the amount to deduct, separated by a space.\n\n<i>Example: -1001234567890 3</i>\n\n⚠️ This will remove 3 days of credit from the group.",
  broadcast:
    "📢 <b>Broadcast Message</b>\n\nSend the message you want to deliver to all active groups. The bot will ask for confirmation before broadcasting.\n\n💡 <i>Use HTML formatting for better presentation</i>",
  statistics: "📊 <b>Global Statistics</b>\n\nHere are the latest metrics for your bot's performance and usage:",
  settingsIntro: "⚙️ <b>Global Configuration</b>\n\nSelect the parameter you want to configure:",
  settingsFreeDays: "📅 <b>Free Trial Days</b>\n\nSend the new number of free days that groups receive after activation.\n\n<i>Current setting will be replaced with your input.</i>",
  settingsStars: "⭐ <b>Monthly Stars Quota</b>\n\nSend the monthly Stars allowance that each group should get.\n\n<i>This affects the Stars balance for all groups.</i>",
  settingsWelcomeMessages:
    "👋 <b>Welcome Messages</b>\n\nSend up to four welcome texts, one per message. The bot will replace the stored templates in order.\n\n<i>Use HTML formatting for better presentation.</i>",
  settingsGpidHelp: "🆔 <b>GPID Help Text</b>\n\nProvide the helper text that explains how to find the group GPID.\n\n<i>This message helps users locate their group identifier.</i>",
  settingsLabels:
    "🏷️ <b>Button Labels</b>\n\nSend the updated labels for all buttons as a JSON object.\n\n<i>Example: {\"start_add_to_group\":\"➕ Add Bot\",\"owner_nav_back\":\"🔙 Back\"}</i>",
  settingsChannelText:
    "📢 <b>Channel Announcement Text</b>\n\nSend the announcement template that should appear when the channel button is used.\n\n<i>Use placeholders like {user} and {group} for personalization.</i>",
  settingsInfoCommands:
    "ℹ️ <b>Info and Commands Text</b>\n\nShare the combined Info and Commands message that should be shown to users.\n\n<i>This appears when users tap the Info button.</i>",
  creditCodesIntro: "🎁 <b>Credit Code Management</b>\n\nGenerate and manage credit codes for your users. These codes can be used to add days to group subscriptions:",
  createCreditCode: "➕ <b>Create New Credit Code</b>\n\nSend the details in this format:\n<code>DAYS MAX_USES [EXPIRES_IN_DAYS]</code>\n\n<b>Examples:</b>\n• <code>7 100</code> - 7 days, 100 uses, no expiry\n• <code>30 50 90</code> - 30 days, 50 uses, expires in 90 days\n• <code>14 1</code> - 14 days, single use, no expiry",
  creditCodesList: "📋 <b>Active Credit Codes</b>\n\nHere are your current credit codes:",
  creditCodesEmpty: "📋 No credit codes have been created yet.",
  creditCodeCreated: "✅ <b>Credit Code Created Successfully!</b>",
  creditCodeDeleted: "🗑️ Credit code deleted successfully.",
  creditCodeNotFound: "❌ Credit code not found.",
  sliderIntro: `🎨 <b>Promo Slider Control</b>\n\nManage the slides displayed in the dashboard carousel.\n\n<i>Recommended image size: ${REQUIRED_SLIDE_WIDTH}x${REQUIRED_SLIDE_HEIGHT}px</i>`,
  sliderViewEmpty: "📭 <b>No promo slides configured yet</b>\n\nUse \"Add Slide\" to upload the first banner and start engaging your users.",
  sliderViewHeader: "🎨 <b>Current Promo Slides:</b>",
  sliderAddPromptPhoto: `📸 <b>Upload Promo Image</b>\n\nSend a high-quality photo (recommended ${REQUIRED_SLIDE_WIDTH}x${REQUIRED_SLIDE_HEIGHT}px).\n\n<i>The bot will crop and compress it automatically.</i>`,
  sliderAwaitLink: "🔗 <b>Add Slide Link</b>\n\nGreat! Now send the HTTPS link that should open when users tap the slide.\n\n<i>Make sure the link is accessible and relevant.</i>",
  sliderDimensionsMismatch:
    `⚠️ <b>Image Size Notice</b>\n\nFor best results, upload at least ${REQUIRED_SLIDE_WIDTH}x${REQUIRED_SLIDE_HEIGHT}px.\n\n<i>Smaller images will be upscaled automatically but may lose quality.</i>`,
  sliderLinkInvalid: "❌ <b>Invalid Link</b>\n\nPlease send a valid HTTPS link pointing to an approved domain.",
  sliderMissingPhoto: "⚠️ <b>No Image Pending</b>\n\nNo image is pending. Please start again by sending the promo photo first.",
  sliderRemovePrompt: "🗑️ <b>Remove Slide</b>\n\nSend the slide ID you want to remove.\n\n<i>Example: promo-001</i>",
  sliderRemoveMissing: "❌ <b>Slide Not Found</b>\n\nNo slide matches that ID. Check the list and try again.",
  dailyTaskIntro:
    "📋 <b>Daily Task Channel</b>\n\nShare a channel mission in the daily checklist.\n\n⚠️ <i>Make sure the bot is already an admin before you send the invite link.</i>",
  dailyTaskPromptLink: "🔗 <b>Channel Invite Link</b>\n\nSend the public invite link of the channel.\n\n<i>Example: https://t.me/firewall_channel</i>\n\n⚠️ The bot must already be an administrator.",
  dailyTaskLinkInvalid: "❌ <b>Invalid Link</b>\n\nThe link must start with https://t.me/ or t.me/.\n\n<i>Please double-check that the bot is an admin and send a valid public link.</i>",
  dailyTaskPromptButton: '🏷️ <b>Button Label</b>\n\nGreat! Now send the button label you want users to see.\n\n<i>Example: "Join Security Briefings"</i>',
  dailyTaskButtonInvalid: "❌ <b>Invalid Button Label</b>\n\nThe button label cannot be empty. Please send a short call-to-action.",
  dailyTaskPromptDescription: '📝 <b>Mission Description</b>\n\nSend the description text that will appear under the mission.\n\n<i>Example: "Watch the daily hardening tips in Command Center"</i>',
  dailyTaskDescriptionInvalid: "❌ <b>Invalid Description</b>\n\nPlease send a short description for the mission.",
  dailyTaskPromptXp: "⭐ <b>XP Reward</b>\n\nFinally, send the XP reward (positive integer).\n\n<i>Recommended: 20-50 XP for daily tasks</i>",
  dailyTaskXpInvalid: "❌ <b>Invalid XP Value</b>\n\nPlease send a positive integer value for XP reward.",
  dailyTaskSaved: "✅ <b>Daily Task Saved</b>\n\nDaily task channel saved successfully!\n\n<i>Reload the missions dashboard to see the new button.</i>",
  banIntro: "🚫 <b>Ban List Management</b>\n\nBlock or unblock users from accessing the panel.\n\n<i>Banned users cannot access any panel features.</i>",
  banAddPrompt: "➕ <b>Ban User</b>\n\nSend the numeric Telegram user ID that should be banned.\n\n<i>Example: 123456789</i>",
  banRemovePrompt: "➖ <b>Unban User</b>\n\nSend the numeric Telegram user ID that should be removed from the ban list.\n\n<i>Example: 123456789</i>",
  banListEmpty: "📋 <b>Ban List Empty</b>\n\nThe ban list is currently empty. No users are banned.",
  banListHeader: "🚫 <b>Banned Users:</b>",
  banNotFound: "❌ <b>User Not Found</b>\n\nThat user ID is not currently banned. Check the list and try again."
};

const firewallSampleRule = JSON.stringify(
  {
    name: "Block spam links",
    scope: "global",
    enabled: true,
    priority: 100,
    matchAll: false,
    severity: 1,
    conditions: [
      {
        kind: "link_domain",
        domains: ["spam.example", "bad.example"]
      }
    ],
    actions: [
      { kind: "delete_message" },
      { kind: "warn", message: "Links from spam domains are not allowed." }
    ],
    escalation: {
      steps: [
        {
          threshold: 3,
          windowSeconds: 600,
          actions: [{ kind: "mute", durationSeconds: 3600 }]
        }
      ]
    }
  },
  null,
  2,
);

Object.assign(ownerMessages, {
  firewallIntro:
    "Firewall Rule Manager\nCreate, review, and adjust automated moderation rules. Rules run in order of priority (lowest first).",
  firewallNoRules: "No firewall rules have been configured yet.",
  firewallPromptCreate: `Send the JSON definition for the new rule (see example below). Remember to include scope ("global" or "group") and chatId for group rules.\n\n\`\`\`json\n${firewallSampleRule}\n\`\`\``,
  firewallPromptEdit:
    "Send the updated JSON payload for this rule. The entire object will replace the existing configuration.",
  firewallInvalidJson: "The payload must be valid JSON. Please try again or use the example as a template.",
  firewallInvalidPayload: "The payload is missing required fields (name, scope, conditions, actions). Please review and try again.",
  firewallSaved: "Firewall rule saved.",
  firewallDeleted: "Firewall rule deleted.",
  firewallToggledOn: "Rule enabled.",
  firewallToggledOff: "Rule disabled.",
});

type FirewallRuleSummary = {
  id: string;
  scope: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  matchAllConditions: boolean;
  severity: number;
  chatId: string | null;
  groupTitle: string | null;
  config: FirewallRuleConfig;
  updatedAt: Date;
};

type OwnerSession = OwnerSessionState;

let ownerSession: OwnerSession = readOwnerSessionState();

type RequestWithId = Request & { id?: string };

function setOwnerSession(next: OwnerSession): OwnerSession {
  ownerSession = writeOwnerSessionState(next);
  return ownerSession;
}

function resetOwnerSession() {
  setOwnerSession({ state: "idle" });
}
// Track last bot message per chat to edit instead of sending new ones
const lastMessageByChat = new Map<number, number>();

async function replyOrEditRoot(
  ctx: Context,
  text: string,
  keyboard: ReturnType<typeof Markup.inlineKeyboard>,
): Promise<void> {
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard.reply_markup, parse_mode: "HTML" });
      const msg = (ctx.callbackQuery as any).message as { message_id?: number; chat?: { id?: number } } | undefined;
      if (msg?.message_id && msg.chat?.id) {
        lastMessageByChat.set(msg.chat.id, msg.message_id);
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("message is not modified")) {
        logger.warn("replyOrEditRoot edit failed, will try edit by id or send", { message });
      }
    }
  }

  const chatId = (ctx.chat as any)?.id as number | undefined;
  const lastId = chatId ? lastMessageByChat.get(chatId) : undefined;
  if (chatId && lastId) {
    try {
      await ctx.telegram.editMessageText(chatId, lastId, undefined, text, {
        reply_markup: keyboard.reply_markup,
        parse_mode: "HTML",
      } as any);
      return;
    } catch {
      // fall through
    }
  }

  const sent = await ctx.replyWithHTML(text, keyboard as any);
  if (chatId && (sent as any)?.message_id) {
    lastMessageByChat.set(chatId, (sent as any).message_id as number);
  }
}

function nextPromoSlideId(): string {
  const slides = getPromoSlides();
  const maxSerial = slides.reduce((acc, slide) => {
    const match = /promo-(\d+)/.exec(slide.id);
    if (match) {
      const value = Number.parseInt(match[1], 10);
      return Number.isFinite(value) ? Math.max(acc, value) : acc;
    }
    return acc;
  }, 0);
  return `promo-${(maxSerial + 1).toString().padStart(3, "0")}`;
}

function normalizeChannelLink(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('https://t.me/')) {
    return trimmed;
  }
  if (trimmed.startsWith('http://t.me/')) {
    return trimmed.replace('http://', 'https://');
  }
  if (trimmed.startsWith('t.me/')) {
    return `https://${trimmed}`;
  }
  return null;
}

const EMPTY_PROMO_ANALYTICS: { impressions: number; clicks: number; ctr: number } = {
  impressions: 0,
  clicks: 0,
  ctr: 0,
};

function formatSliderSummary(): string {
  const slides = getPromoSlides();
  if (slides.length === 0) {
    return ownerMessages.sliderViewEmpty;
  }

  const details = slides
    .map((slide, index) => {
      const status = slide.active ? "active" : "inactive";
      const scheduleParts: string[] = [];
      if (slide.startsAt) {
        scheduleParts.push(`from ${new Date(slide.startsAt).toLocaleString()}`);
      }
      if (slide.endsAt) {
        scheduleParts.push(`until ${new Date(slide.endsAt).toLocaleString()}`);
      }
      const scheduleLabel = scheduleParts.length > 0 ? scheduleParts.join(" ") : "no schedule";
      const analytics = slide.analytics ?? EMPTY_PROMO_ANALYTICS;
      const ctrPercent = (analytics.ctr * 100).toFixed(2);
      const variantLabel = slide.abTestGroupId
        ? `${slide.variant ?? "G"} (group ${slide.abTestGroupId})`
        : slide.variant ?? "G";

      return `${index + 1}. ${slide.id} - ${status}
Link: ${slide.linkUrl ?? "n/a"}
CTA: ${slide.ctaLabel ?? "n/a"} ${slide.ctaLink ? `| ${slide.ctaLink}` : ""}
Variant: ${variantLabel}
Schedule: ${scheduleLabel}
Image: ${slide.imageUrl}
Analytics: impressions ${analytics.impressions} | clicks ${analytics.clicks} | ctr ${ctrPercent}%`;
    })
    .join("\n\n");

  return `${ownerMessages.sliderViewHeader}\n\n${details}\n\nUse "Remove Slide" to delete an entry.`;
}

function formatBanSummary(): string {
  const banned = listBannedUsers();
  if (banned.length === 0) {
    return ownerMessages.banListEmpty;
  }

  const entries = banned.map((id, index) => `${index + 1}. ${id}`).join("\n");

  return `${ownerMessages.banListHeader}\n${entries}`;
}

function formatAdminsSummary(): string {
  const admins = listPanelAdmins();
  const ownerLine = `Bot owner: ${ownerUserId}`;
  if (admins.length === 0) {
    return `${ownerLine}\nNo additional panel administrators are configured yet.`;
  }
  return `${ownerLine}\nAdditional panel administrators:\n${admins.map((id, index) => `${index + 1}. ${id}`).join("\n")}`;
}

async function fetchFirewallRules(): Promise<FirewallRuleSummary[]> {
  const { listFirewallRules } = await import("../server/db/firewallRepository.js");
  const records = await listFirewallRules();
  return records.map((rule) => ({
    id: rule.id,
    scope: rule.scope,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    priority: rule.priority,
    matchAllConditions: rule.matchAllConditions,
    severity: rule.severity,
    chatId: rule.chatId,
    groupTitle: rule.groupTitle ?? null,
    config: rule.config,
    updatedAt: rule.updatedAt,
  }));
}

function truncateLabel(value: string, max = 28): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
}

function renderFirewallOverviewMessage(rules: FirewallRuleSummary[]): string {
  if (rules.length === 0) {
    return `${ownerMessages.firewallIntro}\n\n${ownerMessages.firewallNoRules}`;
  }

  const lines = rules.map((rule, index) => {
    const status = rule.enabled ? "[ON]" : "[OFF]";
    const scopeLabel =
      rule.scope === "global" ? "Global" : `Group ${rule.chatId ?? "?"}${rule.groupTitle ? ` (${rule.groupTitle})` : ""}`;
    return `${index + 1}. ${status} ${rule.name} | ${scopeLabel} | priority ${rule.priority}`;
  });

  return `${ownerMessages.firewallIntro}\n\n${lines.join("\n")}\n\nSelect a rule below to view details or make changes.`;
}

function buildOwnerFirewallMenuKeyboard(rules: FirewallRuleSummary[]): InlineKeyboard {
  const listButtons = rules.slice(0, 10).map((rule) => [
    Markup.button.callback(
      `${rule.enabled ? "[ON]" : "[OFF]"} ${truncateLabel(rule.name)}`,
      `${actionId("ownerFirewallView")}:${rule.id}`,
    ),
  ]);

  const rows = [
    [Markup.button.callback("Add New Rule", actionId("ownerFirewallAdd"))],
    ...listButtons,
  ];

  if (rules.length > 10) {
    rows.push([Markup.button.callback(`+ ${rules.length - 10} more...`, actionId("ownerFirewallRefresh"))]);
  }

  rows.push([Markup.button.callback("Refresh", actionId("ownerFirewallRefresh"))]);
  rows.push(ownerNavigationRow());

  return Markup.inlineKeyboard(rows);
}

function buildOwnerFirewallDetailKeyboard(rule: FirewallRuleSummary): InlineKeyboard {
  const toggleLabel = rule.enabled ? "Disable Rule" : "Enable Rule";
  const rows = [
    [Markup.button.callback(toggleLabel, `${actionId("ownerFirewallToggle")}:${rule.id}`)],
    [Markup.button.callback("Edit Rule JSON", `${actionId("ownerFirewallEdit")}:${rule.id}`)],
    [Markup.button.callback("Delete Rule", `${actionId("ownerFirewallDelete")}:${rule.id}`)],
    [Markup.button.callback("Back to Rules", actionId("ownerFirewallMenu"))],
    ownerNavigationRow(),
  ];
  return Markup.inlineKeyboard(rows);
}

function formatFirewallRuleDetails(rule: FirewallRuleSummary): string {
  const scopeLabel =
    rule.scope === "global" ? "Global" : `Group ${rule.chatId ?? "?"}${rule.groupTitle ? ` (${rule.groupTitle})` : ""}`;
  const lines = [
    `Rule: ${rule.name}`,
    `Scope: ${scopeLabel}`,
    `Status: ${rule.enabled ? "Enabled" : "Disabled"}`,
    `Priority: ${rule.priority}`,
    `Match all conditions: ${rule.matchAllConditions ? "Yes" : "No"}`,
    `Severity: ${rule.severity}`,
    rule.description ? `Description: ${rule.description}` : null,
    "",
    "Conditions:",
    ...rule.config.conditions.map((condition, index) => `  ${index + 1}. ${JSON.stringify(condition)}`),
    "",
    "Actions:",
    ...rule.config.actions.map((action, index) => `  ${index + 1}. ${JSON.stringify(action)}`),
  ].filter(Boolean);

  if (rule.config.escalation && rule.config.escalation.steps?.length) {
    lines.push("", "Escalation steps:");
    rule.config.escalation.steps.forEach((step, index) => {
      lines.push(
        `  ${index + 1}. threshold ${step.threshold} within ${step.windowSeconds}s -> ${step.actions
          .map((action) => action.kind)
          .join(", ")}`,
      );
    });
  }

  return lines.join("\n");
}

async function showOwnerFirewallMenu(ctx: Context, flashMessage?: string): Promise<void> {
  const rules = await fetchFirewallRules();
  const overview = renderFirewallOverviewMessage(rules);
  const message = flashMessage ? `${flashMessage}\n\n${overview}` : overview;
  await respondWithOwnerView(ctx, message, buildOwnerFirewallMenuKeyboard(rules));
}

function mapRuleDetailToSummary(rule: {
  id: string;
  scope: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  matchAllConditions: boolean;
  severity: number;
  chatId: string | null;
  groupTitle: string | null;
  config: FirewallRuleConfig;
  updatedAt: Date;
}): FirewallRuleSummary {
  return {
    id: rule.id,
    scope: rule.scope,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    priority: rule.priority,
    matchAllConditions: rule.matchAllConditions,
    severity: rule.severity,
    chatId: rule.chatId,
    groupTitle: rule.groupTitle ?? null,
    config: rule.config,
    updatedAt: rule.updatedAt,
  };
}

async function showOwnerFirewallDetail(ctx: Context, ruleId: string, flashMessage?: string): Promise<void> {
  const { findFirewallRuleById } = await import("../server/db/firewallRepository.js");
  const rule = await findFirewallRuleById(ruleId);
  if (!rule) {
    await showOwnerFirewallMenu(ctx, "The selected rule no longer exists.");
    return;
  }
  const summaryData = mapRuleDetailToSummary(rule);
  const summary = formatFirewallRuleDetails(summaryData);
  const text = flashMessage ? `${flashMessage}\n\n${summary}` : summary;
  await respondWithOwnerView(ctx, text, buildOwnerFirewallDetailKeyboard(summaryData));
}

type RuleJsonInput = {
  id?: string;
  chatId?: string | null;
  scope?: string;
  name?: string;
  description?: string | null;
  enabled?: boolean;
  priority?: number;
  matchAll?: boolean;
  severity?: number;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
  escalation?: RuleEscalation;
  legacy?: {
    type?: string | null;
    pattern?: string | null;
    action?: string | null;
  };
};

type NormalizedRulePayload = {
  id?: string;
  groupChatId?: string | null;
  scope: "group" | "global";
  name: string;
  description?: string | null;
  enabled?: boolean;
  priority?: number;
  matchAll?: boolean;
  severity?: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
  escalation?: RuleEscalation;
  createdBy?: string | null;
  legacy?: {
    type?: string | null;
    pattern?: string | null;
    action?: string | null;
  };
};

function normalizeRulePayloadFromJson(
  input: unknown,
  options: { mode: "create" } | { mode: "edit"; ruleId: string; chatId: string | null },
  actorId: string | null,
): NormalizedRulePayload {
  if (!input || typeof input !== "object") {
    throw new Error(ownerMessages.firewallInvalidPayload);
  }

  const raw = input as RuleJsonInput;
  const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : null;
  if (!name) {
    throw new Error(ownerMessages.firewallInvalidPayload);
  }

  const scope = raw.scope === "global" ? "global" : "group";
  const chatId =
    scope === "group"
      ? raw.chatId && typeof raw.chatId === "string" && raw.chatId.trim().length > 0
        ? raw.chatId.trim()
        : options.mode === "edit"
          ? options.chatId
          : null
      : null;

  if (scope === "group" && !chatId) {
    throw new Error("Group rules must specify chatId.");
  }

  const conditions = Array.isArray(raw.conditions) ? (raw.conditions as RuleCondition[]) : [];
  const actions = Array.isArray(raw.actions) ? (raw.actions as RuleAction[]) : [];

  if (!actions.length) {
    throw new Error("At least one action is required.");
  }

  const escalation =
    raw.escalation && typeof raw.escalation === "object" ? (raw.escalation as RuleEscalation) : undefined;

  return {
    id: options.mode === "edit" ? options.ruleId : raw.id,
    groupChatId: chatId ?? undefined,
    scope,
    name,
    description: typeof raw.description === "string" ? raw.description : undefined,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    priority:
      typeof raw.priority === "number" && Number.isFinite(raw.priority) ? Math.trunc(raw.priority) : undefined,
    matchAll: typeof raw.matchAll === "boolean" ? raw.matchAll : undefined,
    severity:
      typeof raw.severity === "number" && Number.isFinite(raw.severity) ? Math.max(1, Math.trunc(raw.severity)) : undefined,
    conditions,
    actions,
    escalation,
    createdBy: actorId,
    legacy: raw.legacy,
  };
}

function buildPayloadFromStoredRule(
  rule: FirewallRuleSummary,
  overrides: Partial<NormalizedRulePayload> = {},
  actorId?: string | null,
): NormalizedRulePayload {
  return {
    id: rule.id,
    groupChatId: rule.scope === "group" ? rule.chatId ?? undefined : undefined,
    scope: rule.scope as "group" | "global",
    name: overrides.name ?? rule.config.name,
    description: overrides.description ?? rule.config.description ?? undefined,
    enabled: overrides.enabled ?? rule.enabled,
    priority: overrides.priority ?? rule.priority,
    matchAll: overrides.matchAll ?? rule.matchAllConditions,
    severity: overrides.severity ?? rule.severity,
    conditions: overrides.conditions ?? rule.config.conditions,
    actions: overrides.actions ?? rule.config.actions,
    escalation: overrides.escalation ?? rule.config.escalation,
    createdBy: overrides.createdBy ?? actorId ?? null,
    legacy: overrides.legacy,
  };
}

async function handleFirewallRuleInput(
  ctx: Context,
  rawText: string,
  options: { mode: "create" } | { mode: "edit"; ruleId: string; chatId: string | null },
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    await ctx.reply(ownerMessages.firewallInvalidJson, buildOwnerNavigationKeyboard());
    return;
  }

  const actor = actorId(ctx);
  let payload: NormalizedRulePayload;
  try {
    payload = normalizeRulePayloadFromJson(parsed, options, actor);
  } catch (error) {
    await ctx.reply(
      error instanceof Error ? error.message : ownerMessages.firewallInvalidPayload,
      buildOwnerNavigationKeyboard(),
    );
    return;
  }

  const { upsertFirewallRule } = await import("../server/db/firewallRepository.js");
  await upsertFirewallRule(payload);
  await invalidateFirewallCache(payload.groupChatId ?? (options.mode === "edit" ? options.chatId ?? null : null));
  resetOwnerSession();
  await showOwnerFirewallMenu(ctx, ownerMessages.firewallSaved);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FIREWALL_VIEW_REGEX = new RegExp(`^${escapeRegExp(actionId("ownerFirewallView"))}:(.+)$`);
const FIREWALL_TOGGLE_REGEX = new RegExp(`^${escapeRegExp(actionId("ownerFirewallToggle"))}:(.+)$`);
const FIREWALL_DELETE_REGEX = new RegExp(`^${escapeRegExp(actionId("ownerFirewallDelete"))}:(.+)$`);
const FIREWALL_EDIT_REGEX = new RegExp(`^${escapeRegExp(actionId("ownerFirewallEdit"))}:(.+)$`);
const VERIFY_MEMBER_REGEX = /^fw_verify_member:(-?\d+):(-?\d+)$/;
// Incoming verification captcha patterns
const VERIFY_CAPTCHA_REGEX = /^fw_verify_captcha:(-?\d+):(\d+)$/;

// In-memory session for incoming verification captcha
const incomingVerificationSessions = new Map<string, {
  chatId: string;
  correctAnswer: number;
  createdAt: number;
}>();

function generateMathCaptcha(): { question: string; answer: number; options: number[] } {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const answer = a + b;
  const question = `What is ${a} + ${b}?`;

  // Generate 7 wrong answers
  const wrongAnswers = new Set<number>();
  while (wrongAnswers.size < 7) {
    const wrong = answer + Math.floor(Math.random() * 21) - 10;
    if (wrong !== answer && wrong > 0) {
      wrongAnswers.add(wrong);
    }
  }

  // Combine and shuffle
  const options = [...wrongAnswers, answer].sort(() => Math.random() - 0.5);
  return { question, answer, options };
}

// Handle /start deep link for incoming verification (start=-chatId)
async function handleIncomingVerificationStart(ctx: Context, chatId: string): Promise<boolean> {
  const userId = ctx.from?.id?.toString();
  if (!userId) return false;

  // Check if this group has incoming verification enabled
  try {
    const generalSettings = await loadGeneralSettingsByChatId(chatId);
    const rawSettings = generalSettings as Record<string, unknown>;
    const verificationMode = (rawSettings.userVerificationMode as string) ?? "disabled";

    if (verificationMode !== "incoming") {
      return false;
    }
  } catch (error) {
    logger.warn("failed to check incoming verification settings", { chatId, error });
    return false;
  }

  // Generate captcha
  const captcha = generateMathCaptcha();
  const userDisplayName = resolveUserDisplayName(ctx.from!);

  // Store session
  incomingVerificationSessions.set(userId, {
    chatId,
    correctAnswer: captcha.answer,
    createdAt: Date.now(),
  });

  // Build answer buttons (2 per row)
  const rows: any[] = [];
  for (let i = 0; i < captcha.options.length; i += 2) {
    const row: any[] = [];
    row.push(Markup.button.callback(
      String(captcha.options[i]),
      `fw_verify_captcha:${chatId}:${captcha.options[i]}`
    ));
    if (captcha.options[i + 1] !== undefined) {
      row.push(Markup.button.callback(
        String(captcha.options[i + 1]),
        `fw_verify_captcha:${chatId}:${captcha.options[i + 1]}`
      ));
    }
    rows.push(row);
  }

  const message = `👋 Hello <b>${userDisplayName}</b>!\n\n` +
    `To verify your membership request, please answer the following question:\n\n` +
    `<b>${captcha.question}</b>`;

  await ctx.reply(message, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard(rows),
  });

  return true;
}

// Captcha answer callback handler
bot.action(VERIFY_CAPTCHA_REGEX, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(VERIFY_CAPTCHA_REGEX);
  const chatId = match?.[1];
  const selectedAnswer = match?.[2];
  if (!chatId || !selectedAnswer) return;

  const userId = ctx.from?.id?.toString();
  if (!userId) return;

  const session = incomingVerificationSessions.get(userId);
  if (!session || session.chatId !== chatId) {
    await ctx.answerCbQuery("Session expired. Please try again.", { show_alert: true });
    return;
  }

  const selectedNum = parseInt(selectedAnswer, 10);
  if (selectedNum !== session.correctAnswer) {
    await ctx.answerCbQuery("❌ Incorrect answer. Please try again.", { show_alert: true });

    // Generate new captcha
    const captcha = generateMathCaptcha();
    session.correctAnswer = captcha.answer;

    const rows: any[] = [];
    for (let i = 0; i < captcha.options.length; i += 2) {
      const row: any[] = [];
      row.push(Markup.button.callback(
        String(captcha.options[i]),
        `fw_verify_captcha:${chatId}:${captcha.options[i]}`
      ));
      if (captcha.options[i + 1] !== undefined) {
        row.push(Markup.button.callback(
          String(captcha.options[i + 1]),
          `fw_verify_captcha:${chatId}:${captcha.options[i + 1]}`
        ));
      }
      rows.push(row);
    }

    const userDisplayName = resolveUserDisplayName(ctx.from!);
    const message = `👋 Hello <b>${userDisplayName}</b>!\n\n` +
      `To verify your membership request, please answer the following question:\n\n` +
      `<b>${captcha.question}</b>`;

    try {
      await ctx.editMessageText(message, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup,
      });
    } catch {
      // Ignore edit errors
    }
    return;
  }

  // Correct answer - generate one-time invite link
  await ctx.answerCbQuery("✅ Correct!", { show_alert: false });
  incomingVerificationSessions.delete(userId);

  try {
    const numericChatId = parseInt(chatId, 10);
    const inviteLink = await ctx.telegram.createChatInviteLink(numericChatId, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 86400, // 24 hours
    });

    const successMessage = `✅ <b>Your request has been approved!</b>\n\n` +
      `You can join the group using the temporary link below.\n` +
      `This link can only be used once and will expire after that.\n\n` +
      `🔗 <b>Temporary Link:</b>\n${inviteLink.invite_link}`;

    await ctx.editMessageText(successMessage, {
      parse_mode: "HTML",
    });

    logger.info("incoming verification completed, invite link generated", {
      chatId,
      userId,
    });
  } catch (error) {
    logger.error("failed to generate invite link for incoming verification", { chatId, userId, error });
    await ctx.editMessageText(
      "❌ Sorry, there was an error generating the invite link. Please contact the group admin.",
      { parse_mode: "HTML" }
    );
  }
});

// Inline panel callback patterns
const INLINE_GROUP_REGEX = /^fw_inline_group:(-?\d+)$/;
const INLINE_MENU_REGEX = /^fw_inline_menu:(-?\d+)$/;
const INLINE_BACK_TO_GROUPS = "fw_inline_back_to_groups";
const INLINE_LOCKS_REGEX = /^fw_inline_locks:(-?\d+):(\d+)$/;
const INLINE_LOCK_TOGGLE_REGEX = /^fw_inline_lock:(-?\d+):(\d+):([a-z0-9_]+)$/;
const INLINE_LISTS_REGEX = /^fw_inline_lists:(-?\d+)$/;
const INLINE_LIST_DETAIL_REGEX = /^fw_inline_list:(-?\d+):([a-z0-9_]+)$/;
const INLINE_LIST_ADD_REGEX = /^fw_inline_add:(-?\d+):([a-z0-9_]+)$/;
const INLINE_HELP_REGEX = /^fw_inline_help:(.+)$/;
const INLINE_ADVANCED_REGEX = /^fw_inline_advanced:(-?\d+)$/;

// UserPanel callback patterns
const USER_PANEL_MAIN_REGEX = /^fw_userpanel:(-?\d+):(\d+)$/;
const USER_PANEL_LOCKS_REGEX = /^fw_up_locks:(-?\d+):(\d+)$/;
const USER_PANEL_LOCK_TOGGLE_REGEX = /^fw_up_lock_toggle:(-?\d+):(\d+):([a-z0-9_]+)$/;
const USER_PANEL_PUNISHMENTS_REGEX = /^fw_up_punish:(-?\d+):(\d+)$/;
const USER_PANEL_PROMOTE_REGEX = /^fw_up_promote:(-?\d+):(\d+)$/;
const USER_PANEL_BAN_REGEX = /^fw_up_ban:(-?\d+):(\d+)$/;
const USER_PANEL_MUTE_REGEX = /^fw_up_mute:(-?\d+):(\d+)$/;
const USER_PANEL_VIP_REGEX = /^fw_up_vip:(-?\d+):(\d+)$/;
const USER_PANEL_ADMIN_REGEX = /^fw_up_admin:(-?\d+):(\d+)$/;
const USER_PANEL_LOCK_GUIDE_REGEX = /^fw_up_lock_guide:(-?\d+):(\d+)$/;

function formatGroupSnapshot(): string {
  const groups = listGroups();
  if (groups.length === 0) {
    return "No groups have been registered yet. Adjust credits to create a new record.";
  }
  const lines = groups.map((group) => {
    return `- ${group.chatId} (${group.title}) - credit: ${group.creditBalance}`;
  });
  return lines.join("\n");
}

async function getManageableGroupsForUser(userId: string): Promise<GroupRecord[]> {
  const includeAll = userId === ownerUserId || isPanelAdmin(userId);
  const groups = await loadGroupsSnapshot(userId, { includeAll });
  return groups;
}

function buildInlineGroupSelectionKeyboard(groups: GroupRecord[]): InlineKeyboard {
  const rows: any[] = [];
  for (const group of groups) {
    const label = truncateLabel(`📂 ${group.title}`, 38);
    rows.push([Markup.button.callback(label, `fw_inline_group:${group.chatId}`)]);
  }
  rows.push([Markup.button.callback("◀️ Back", actionId("managementBack"))]);
  return Markup.inlineKeyboard(rows);
}

async function showInlineGroupSelection(ctx: Context): Promise<void> {
  const id = actorId(ctx);
  if (!id) {
    await ctx.reply("Unable to determine your account.");
    return;
  }

  const groups = await getManageableGroupsForUser(id);
  if (groups.length === 0) {
    const message =
      "⚠️ No manageable groups were found for your account.\n\n" +
      "Make sure the bot is an admin in your group and that you are a group owner or admin.";
    await replyOrEditRoot(ctx, message, Markup.inlineKeyboard([[Markup.button.callback("◀️ Back", actionId("managementBack"))]]));
    return;
  }

  const message = "📋 Select a group to manage:\n\nChoose a group from the list below to access its inline management panel.";
  await replyOrEditRoot(ctx, message, buildInlineGroupSelectionKeyboard(groups));
}

function buildInlineGroupMenuKeyboard(chatId: string): InlineKeyboard {
  const locksCallback = `fw_inline_locks:${chatId}:1`;
  const listsCallback = `fw_inline_lists:${chatId}`;
  const helpCallback = `fw_inline_help:${chatId}`;
  const advancedCallback = `fw_inline_advanced:${chatId}`;

  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🔒 Locks", locksCallback),
      Markup.button.callback("📋 Lists", listsCallback),
    ],
    [
      Markup.button.callback("⭐ Upgrade to Premium", `group_setup:premium:${chatId}`),
      Markup.button.callback("⚙️ Advanced", advancedCallback),
    ],
    [Markup.button.callback("◀️ Back to Groups", INLINE_BACK_TO_GROUPS)],
  ]);
}

async function showInlineGroupMenu(ctx: Context, chatId: string): Promise<void> {
  const groups = listGroups();
  const group = groups.find((g) => g.chatId === chatId) ?? null;
  const title = group?.title ?? chatId;
  const message = `🛠 Group Management Panel\n\nGroup: ${title}\n\nChoose a section to manage:`;
  await replyOrEditRoot(ctx, message, buildInlineGroupMenuKeyboard(chatId));
}

// ============================================
// HELP SECTION KEYBOARDS AND DISPLAY FUNCTIONS
// ============================================

function buildInlineHelpKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];

  // Only show implemented sections
  const implementedSections = HELP_SECTIONS.filter((s) => s.implemented);

  // Build help section buttons (2 per row)
  for (let i = 0; i < implementedSections.length; i += 2) {
    const row: any[] = [];
    for (let j = 0; j < 2 && i + j < implementedSections.length; j++) {
      const section = implementedSections[i + j];
      const label = `${section.icon} ${section.title}`;
      row.push(Markup.button.callback(label, `fw_help_section:${chatId}:${section.id}`));
    }
    rows.push(row);
  }

  rows.push([
    chatId === 'global'
      ? Markup.button.callback("◀️ Back to Main Menu", actionId("managementBack"))
      : Markup.button.callback("◀️ Back to Panel", `fw_inline_menu:${chatId}`)
  ]);
  return Markup.inlineKeyboard(rows);
}

async function showInlineHelp(ctx: Context, chatId: string): Promise<void> {
  let title = chatId;
  if (chatId !== 'global') {
    const groups = listGroups();
    const group = groups.find((g) => g.chatId === chatId) ?? null;
    title = group?.title ?? chatId;
  } else {
    title = "General Help";
  }

  const message = `❓ <b>Help Center</b>\n\nContext: ${title}\n\nSelect a topic to learn more:`;
  await replyOrEditRoot(ctx, message, buildInlineHelpKeyboard(chatId));
}

function buildHelpLocksKeyboard(chatId: string, page: number): InlineKeyboard {
  const totalPages = Math.ceil(LOCK_HELP_DATA.length / HELP_LOCKS_PAGE_SIZE);
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * HELP_LOCKS_PAGE_SIZE;
  const endIndex = Math.min(startIndex + HELP_LOCKS_PAGE_SIZE, LOCK_HELP_DATA.length);
  const pageItems = LOCK_HELP_DATA.slice(startIndex, endIndex);

  const rows: any[] = [];

  // Build lock buttons (2 per row)
  for (let i = 0; i < pageItems.length; i += 2) {
    const row: any[] = [];
    for (let j = 0; j < 2 && i + j < pageItems.length; j++) {
      const lock = pageItems[i + j];
      const label = `${lock.icon} ${lock.name}`;
      row.push(Markup.button.callback(label, `fw_help_lock:${chatId}:${lock.id}`));
    }
    rows.push(row);
  }

  // Navigation row
  const navRow: any[] = [];
  if (currentPage > 1) {
    navRow.push(Markup.button.callback("◀️ Previous", `fw_help_locks:${chatId}:${currentPage - 1}`));
  }
  if (currentPage < totalPages) {
    navRow.push(Markup.button.callback("▶️ Next", `fw_help_locks:${chatId}:${currentPage + 1}`));
  }
  if (navRow.length > 0) {
    rows.push(navRow);
  }

  rows.push([Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showHelpLocks(ctx: Context, chatId: string, page: number): Promise<void> {
  const totalPages = Math.ceil(LOCK_HELP_DATA.length / HELP_LOCKS_PAGE_SIZE);
  const currentPage = Math.min(Math.max(page, 1), totalPages);

  const message = `🔒 <b>Lock Management Help</b>\n\nPage ${currentPage}/${totalPages}\n\nSelect a lock to learn more about it:`;
  await replyOrEditRoot(ctx, message, buildHelpLocksKeyboard(chatId, currentPage));
}

async function showHelpLockDetail(ctx: Context, chatId: string, lockId: string): Promise<void> {
  const lock = LOCK_HELP_DATA.find((l) => l.id === lockId);
  if (!lock) {
    await replyOrEditRoot(ctx, "Lock not found.", buildHelpLocksKeyboard(chatId, 1));
    return;
  }

  const lines: string[] = [];
  lines.push(`${lock.icon} <b>${lock.name}</b>`);
  lines.push("");
  lines.push(`<b>📝 What does it do?</b>`);
  lines.push(lock.whatItDoes);
  lines.push("");
  lines.push(`<b>📌 Example:</b>`);
  lines.push(`<code>${lock.example}</code>`);
  lines.push("");
  lines.push(`<b>✅ How to Enable:</b>`);
  lines.push(`• Inline: Settings → Locks → ${lock.name}`);
  lines.push(`• Command: <code>!lock ${lock.commandAlias}</code>`);
  lines.push("");
  lines.push(`<b>❌ How to Disable:</b>`);
  lines.push(`• Command: <code>!unlock ${lock.commandAlias}</code>`);
  lines.push("");
  lines.push(`<b>📱 Mini App Path:</b>`);
  lines.push(lock.miniAppPath);
  lines.push("");
  lines.push(`<b>💡 When to Use:</b>`);
  lines.push(lock.whenToUse);
  lines.push("");
  lines.push(`<b>⚠️ Limitations:</b>`);
  lines.push(lock.limitations);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Locks", `fw_help_locks:${chatId}:1`)],
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// ============================================
// USER PENALTIES HELP KEYBOARDS AND DISPLAY
// ============================================

function buildHelpPenaltiesKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];

  // Build penalty buttons (2 per row)
  for (let i = 0; i < PENALTY_HELP_DATA.length; i += 2) {
    const row: any[] = [];
    for (let j = 0; j < 2 && i + j < PENALTY_HELP_DATA.length; j++) {
      const penalty = PENALTY_HELP_DATA[i + j];
      const label = `${penalty.icon} ${penalty.name}`;
      row.push(Markup.button.callback(label, `fw_help_penalty:${chatId}:${penalty.id}`));
    }
    rows.push(row);
  }

  rows.push([Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showHelpPenalties(ctx: Context, chatId: string): Promise<void> {
  const message = `⚠️ <b>User Penalties Help</b>\n\nLearn about commands for managing users:\n\nSelect a penalty type to see usage details:`;
  await replyOrEditRoot(ctx, message, buildHelpPenaltiesKeyboard(chatId));
}

async function showHelpPenaltyDetail(ctx: Context, chatId: string, penaltyId: string): Promise<void> {
  const penalty = PENALTY_HELP_DATA.find((p) => p.id === penaltyId);
  if (!penalty) {
    await replyOrEditRoot(ctx, "Penalty not found.", buildHelpPenaltiesKeyboard(chatId));
    return;
  }

  const lines: string[] = [];
  lines.push(`${penalty.icon} <b>${penalty.name}</b>`);
  lines.push("");
  lines.push(`<b>📝 What does it do?</b>`);
  lines.push(penalty.whatItDoes);
  lines.push("");
  lines.push(`<b>📌 Example:</b>`);
  lines.push(penalty.example);
  lines.push("");
  lines.push(`<b>✅ Command:</b>`);
  lines.push(`<code>${penalty.commandEnable}</code>`);
  if (penalty.commandDisable) {
    lines.push("");
    lines.push(`<b>↩️ To Undo:</b>`);
    lines.push(`<code>${penalty.commandDisable}</code>`);
  }
  lines.push("");
  lines.push(`<b>📋 Requires Reply:</b> ${penalty.requiresReply ? "Yes - reply to user's message" : "No"}`);
  lines.push("");
  lines.push(`<b>💡 When to Use:</b>`);
  lines.push(penalty.whenToUse);
  lines.push("");
  lines.push(`<b>📝 Notes:</b>`);
  lines.push(penalty.notes);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Penalties", `fw_help_penalties:${chatId}`)],
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// ============================================
// TABCHI HELP SECTION
// ============================================

async function showHelpTabchi(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];

  lines.push("🚫 <b>Understanding & Combating Tabchi (Spam Bots)</b>");
  lines.push("");
  lines.push("<i>Tabchi refers to fraudulent bot accounts or user accounts that join groups primarily for advertising purposes. This guide helps you identify different types of tabchi and how to combat them.</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📋 Types of Tabchi:</b>");
  lines.push("");
  lines.push("➊ <b>Advertisers</b>");
  lines.push("These tabchis send links, files, and promotional messages. If you check your busy group's activity, you'll see many ads being sent and deleted by the bot. 99% of these ads are from tabchi accounts.");
  lines.push("");
  lines.push("➋ <b>Bot Adders</b>");
  lines.push("After joining your group, these tabchis add other bots for advertising and member recruitment purposes.");
  lines.push("");
  lines.push("➌ <b>Member Recruiters</b>");
  lines.push("These tabchis use fake profiles, especially with female names and photos, to lure users into private chats and then redirect them to promotional groups or channels.");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>🛡️ Prevention Methods:</b>");
  lines.push("");
  lines.push("➊ <b>Enable Tabchi Lock</b>");
  lines.push("By activating the tabchi lock, entry and activity of tabchis in your group will be severely restricted.");
  lines.push("");
  lines.push("➋ <b>Restrict Membership (Private Groups)</b>");
  lines.push("For private groups, limit membership to invite links to prevent bot adders from adding their bots.");
  lines.push("");
  lines.push("➌ <b>Cross-Group Detection</b>");
  lines.push("Our AI system tracks user behavior across all groups. If a user triggers violations in 3+ groups, they are automatically flagged as tabchi.");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📝 Commands:</b>");
  lines.push("");
  lines.push("<code>!lock tabchi</code> - Enable tabchi detection");
  lines.push("<code>!lock advertiser</code> - Enable advertiser detection");
  lines.push("<code>!lock bio</code> - Enable suspicious bio detection");
  lines.push("");
  lines.push("<code>!unlock tabchi</code> - Disable tabchi detection");
  lines.push("<code>!unlock advertiser</code> - Disable advertiser detection");
  lines.push("<code>!unlock bio</code> - Disable suspicious bio detection");
  lines.push("");
  lines.push("<b>🔧 Management Commands:</b>");
  lines.push("");
  lines.push("<code>!untabchi</code> - Remove replied user from tabchi list");
  lines.push("<code>!tabchiwhitelist</code> - Add user to permanent whitelist");
  lines.push("<code>!tabchiinfo</code> - Check tabchi info for replied user");

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// ============================================
// USER PANEL HELP SECTION
// ============================================

async function showHelpUserPanel(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];

  lines.push("👤 <b>User Panel</b>");
  lines.push("");
  lines.push("<i>With the User Panel command, you can apply all settings and restrictions to a specific user. Including restrictions on sending messages, promotions and demotions, and more...</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📋 What is User Panel?</b>");
  lines.push("");
  lines.push("User Panel allows you to manage individual users within your group. You can:");
  lines.push("• View detailed user information");
  lines.push("• Set user-specific lock overrides");
  lines.push("• Apply punishments (Ban, Mute)");
  lines.push("• Promote users to VIP or Bot Admin");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>🔒 User-Specific Locks</b>");
  lines.push("");
  lines.push("Each lock has 3 states:");
  lines.push("");
  lines.push("➊ <b>✗ (Default)</b>");
  lines.push("Uses the group's general settings. No special treatment for this user.");
  lines.push("");
  lines.push("➋ <b>Open</b>");
  lines.push("Content is allowed for this user even if locked in group settings.");
  lines.push("");
  lines.push("➌ <b>🔐 (Locked)</b>");
  lines.push("Content is blocked for this user even if allowed in group settings.");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📝 Commands</b>");
  lines.push("");
  lines.push("The following commands work with reply, username, or numeric ID:");
  lines.push("");
  lines.push("<code>!userpanel</code> - Open user panel (reply to user)");
  lines.push("<code>!userpanel @username</code> - By username");
  lines.push("<code>!userpanel 123456789</code> - By numeric ID");
  lines.push("");
  lines.push("<b>Aliases:</b> <code>!up</code>, <code>!panel</code>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📍 Mini App Path:</b>");
  lines.push("My Groups → Group Manage → Members → Select User");

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// ============================================
// CLEANUP HELP SECTION
// ============================================

function buildHelpCleanupKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];

  // Build cleanup buttons (2 per row)
  for (let i = 0; i < CLEANUP_HELP_DATA.length; i += 2) {
    const row: any[] = [];
    for (let j = 0; j < 2 && i + j < CLEANUP_HELP_DATA.length; j++) {
      const item = CLEANUP_HELP_DATA[i + j];
      const label = `${item.icon} ${item.name}`;
      row.push(Markup.button.callback(label, `fw_help_cleanup_item:${chatId}:${item.id}`));
    }
    rows.push(row);
  }

  rows.push([Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showHelpCleanup(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];

  lines.push("🧹 <b>Bot Cleanup Section Guide</b>");
  lines.push("");
  lines.push("<i>Clean up your group by removing inactive members, clearing lists, and managing bot data. Select a topic below to learn more.</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("Select a cleanup category below to view detailed information and available commands:");

  const keyboard = buildHelpCleanupKeyboard(chatId);
  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

async function showHelpCleanupDetail(ctx: Context, chatId: string, itemId: string): Promise<void> {
  const item = CLEANUP_HELP_DATA.find((i) => i.id === itemId);
  if (!item) {
    await ctx.answerCbQuery("Item not found", { show_alert: true });
    return;
  }

  const lines: string[] = [];

  lines.push(`${item.icon} <b>${item.name}</b>`);
  lines.push("");
  lines.push(item.description);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📝 Commands:</b>");
  lines.push("");
  for (const cmd of item.commands) {
    lines.push(`› <code>${cmd}</code>`);
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Cleanup", `fw_help_cleanup:${chatId}`)],
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// ============================================
// WELCOME HELP SECTION
// ============================================

async function showHelpWelcome(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];

  lines.push("👋 <b>Welcome Message</b>");
  lines.push("");
  lines.push("<i>When this feature is enabled, the bot welcomes users who join the group via link with a customizable message.</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📋 Available Variables:</b>");
  lines.push("");
  lines.push("⇝ <code>!mention</code> - User mention (clickable)");
  lines.push("⇝ <code>!firstname</code> - User's first name");
  lines.push("⇝ <code>!lastname</code> - User's last name");
  lines.push("⇝ <code>!username</code> - User's @username");
  lines.push("⇝ <code>!userid</code> - User's numeric ID");
  lines.push("⇝ <code>!grouplink</code> - Group invite link");
  lines.push("⇝ <code>!grouprules</code> - Group rules");
  lines.push("⇝ <code>!groupname</code> - Group name");
  lines.push("⇝ <code>!date</code> - Current date");
  lines.push("⇝ <code>!time</code> - Current time");
  lines.push("⇝ <code>!emoji</code> - Random emoji");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>💡 Example:</b>");
  lines.push("");
  lines.push("If your welcome message is:");
  lines.push("<i>\"Hello !mention, welcome to !groupname!\"</i>");
  lines.push("");
  lines.push("When user \"John\" joins group \"Chat Room\", the bot sends:");
  lines.push("<i>\"Hello John, welcome to Chat Room!\"</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>🖼️ Welcome with Media:</b>");
  lines.push("");
  lines.push("You can set a welcome message with media (photo, video, audio, voice, GIF, sticker, video note). The welcome text will be used as the caption.");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📝 Commands:</b>");
  lines.push("");
  lines.push("<code>!welcome on</code> - Enable welcome message");
  lines.push("<code>!welcome off</code> - Disable welcome message");
  lines.push("<code>!setwelcome</code> - Set welcome message text");
  lines.push("<code>!getwelcome</code> - View current welcome message");
  lines.push("<code>!resetwelcome</code> - Reset to default");
  lines.push("<code>!setwelcometime 30</code> - Auto-delete after 30 sec");
  lines.push("<code>!setwelcomemedia</code> - Set welcome media (reply to media)");
  lines.push("");
  lines.push("<b>Note:</b> Commands also work with <code>.</code> prefix (e.g., <code>.welcome on</code>)");

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// ============================================
// WORD FILTER HELP SECTION
// ============================================

function buildHelpWordFilterKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];

  // Build word filter buttons (1 per row for better readability)
  for (const item of WORDFILTER_HELP_DATA) {
    const label = `${item.icon} ${item.name}`;
    rows.push([Markup.button.callback(label, `fw_help_wordfilter_item:${chatId}:${item.id}`)]);
  }

  rows.push([Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showHelpWordFilter(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];

  lines.push("🚷 <b>Word Filter Guide</b>");
  lines.push("");
  lines.push("<i>Using this feature, group admins can filter (block) specific words in the group. When a filtered word is sent, the bot will delete the message. Optionally, you can set a punishment for the sender.</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("Select a filtering method below to view detailed information and available commands:");

  const keyboard = buildHelpWordFilterKeyboard(chatId);
  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

async function showHelpWordFilterDetail(ctx: Context, chatId: string, itemId: string): Promise<void> {
  const item = WORDFILTER_HELP_DATA.find((i) => i.id === itemId);
  if (!item) {
    await ctx.answerCbQuery("Item not found", { show_alert: true });
    return;
  }

  const lines: string[] = [];

  lines.push(`${item.icon} <b>${item.name}</b>`);
  lines.push("");
  lines.push(`<i>${item.summary}</i>`);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push(item.description);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📝 Commands:</b>");
  lines.push("");
  for (const cmd of item.commands) {
    lines.push(`› <code>${cmd.command}</code>`);
  }

  if (item.examples && item.examples.length > 0) {
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("");
    lines.push("<b>💡 Examples:</b>");
    lines.push("");
    for (const ex of item.examples) {
      lines.push(`• ${ex.description}`);
      lines.push(`  ⮨ <code>${ex.command}</code>`);
    }
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Word Filter", `fw_help_wordfilter:${chatId}`)],
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// ============================================
// ACTIVITY STATISTICS HELP SECTION
// ============================================

function buildHelpStatsKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];

  // Build stats buttons (2 per row for better layout)
  for (let i = 0; i < STATS_HELP_DATA.length; i += 2) {
    const row: any[] = [];
    for (let j = 0; j < 2 && i + j < STATS_HELP_DATA.length; j++) {
      const item = STATS_HELP_DATA[i + j];
      const label = `${item.icon} ${item.name}`;
      row.push(Markup.button.callback(label, `fw_help_stats_item:${chatId}:${item.id}`));
    }
    rows.push(row);
  }

  rows.push([Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showHelpStats(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];

  lines.push("📊 <b>Activity Statistics Guide</b>");
  lines.push("");
  lines.push("<i>Using this feature, group admins can view and manage chat statistics for all users. Track activity, invites, and set up automatic stats posting.</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>✨ Key Features:</b>");
  lines.push("• View user chat activity and rankings");
  lines.push("• Track member invitations (adds)");
  lines.push("• Check weekly or total statistics");
  lines.push("• Set up automatic scheduled stats");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("Select a statistics type below to view commands:");

  const keyboard = buildHelpStatsKeyboard(chatId);
  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

async function showHelpStatsDetail(ctx: Context, chatId: string, itemId: string): Promise<void> {
  const item = STATS_HELP_DATA.find((i) => i.id === itemId);
  if (!item) {
    await ctx.answerCbQuery("Item not found", { show_alert: true });
    return;
  }

  const lines: string[] = [];

  lines.push(`${item.icon} <b>${item.name}</b>`);
  lines.push("");
  lines.push(`<i>${item.summary}</i>`);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push(item.description);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📝 Commands:</b>");
  lines.push("");
  for (const cmd of item.commands) {
    lines.push(`› <code>${cmd.command}</code>`);
  }

  if (item.examples && item.examples.length > 0) {
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("");
    lines.push("<b>💡 Examples:</b>");
    lines.push("");
    for (const ex of item.examples) {
      lines.push(`• ${ex.description}`);
      lines.push(`  ⮨ <code>${ex.command}</code>`);
    }
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Stats", `fw_help_stats:${chatId}`)],
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// ============================================
// SETTINGS HELP SECTION
// ============================================

function buildHelpSettingsKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];

  // Build settings buttons (2 per row)
  for (let i = 0; i < SETTINGS_HELP_DATA.length; i += 2) {
    const row: any[] = [];
    for (let j = 0; j < 2 && i + j < SETTINGS_HELP_DATA.length; j++) {
      const setting = SETTINGS_HELP_DATA[i + j];
      const label = `${setting.icon} ${setting.name}`;
      row.push(Markup.button.callback(label, `fw_help_setting:${chatId}:${setting.id}`));
    }
    rows.push(row);
  }

  rows.push([Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showHelpSettings(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];

  lines.push("⚙️ <b>Settings Help</b>");
  lines.push("");
  lines.push("<i>Configure your group's behavior with these essential settings. Each option controls a specific aspect of bot functionality.</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("Select a category below to learn more:");

  await replyOrEditRoot(ctx, lines.join("\n"), buildHelpSettingsKeyboard(chatId));
}

async function showHelpSettingDetail(ctx: Context, chatId: string, settingId: string): Promise<void> {
  const setting = SETTINGS_HELP_DATA.find((s) => s.id === settingId);
  if (!setting) {
    await replyOrEditRoot(ctx, "Setting not found.", buildHelpSettingsKeyboard(chatId));
    return;
  }

  const lines: string[] = [];
  lines.push(`${setting.icon} <b>${setting.name}</b>`);
  lines.push("");
  lines.push(`<i>${setting.whatItDoes}</i>`);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📝 Commands:</b>");
  lines.push("");
  for (const cmd of setting.commands) {
    lines.push(`› <code>${cmd}</code>`);
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Settings", `fw_help_settings:${chatId}`)],
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// ============================================
// PROMOTE & DEMOTE HELP KEYBOARDS AND DISPLAY
// ============================================

function buildHelpPromoteKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];

  // Build rank buttons (2 per row)
  for (let i = 0; i < RANK_HELP_DATA.length; i += 2) {
    const row: any[] = [];
    for (let j = 0; j < 2 && i + j < RANK_HELP_DATA.length; j++) {
      const rank = RANK_HELP_DATA[i + j];
      const label = `• ${rank.name} ${rank.icon}`;
      row.push(Markup.button.callback(label, `fw_help_rank:${chatId}:${rank.id}`));
    }
    rows.push(row);
  }

  rows.push([Markup.button.callback("◀️ Back", `fw_inline_help:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showHelpPromote(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];

  lines.push("👑 <b>Promote & Demote Help</b>");
  lines.push("");
  lines.push("<i>Manage user ranks and permissions in your group. Promote trusted members or demote when needed.</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("Select a rank to view details:");

  await replyOrEditRoot(ctx, lines.join("\n"), buildHelpPromoteKeyboard(chatId));
}

async function showHelpRankDetail(ctx: Context, chatId: string, rankId: string): Promise<void> {
  const rank = RANK_HELP_DATA.find((r) => r.id === rankId);
  if (!rank) {
    await replyOrEditRoot(ctx, "Rank not found.", buildHelpPromoteKeyboard(chatId));
    return;
  }

  const lines: string[] = [];
  lines.push(`${rank.icon} <b>${rank.name}</b>`);
  lines.push("");
  lines.push(`<i>${rank.description}</i>`);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📝 Commands:</b>");
  lines.push("");
  for (const cmd of rank.commands) {
    lines.push(`› <code>${cmd.command}</code> — ${cmd.label}`);
  }
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push(`💡 <b>Note:</b> ${rank.notes}`);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Ranks", `fw_help_promote:${chatId}`)],
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

function buildInlineLocksKeyboard(chatId: string, page: number, settings: GroupBanSettingsRecord): InlineKeyboard {
  const totalPages = 3; // We have 3 pages now
  const currentPage = Math.min(Math.max(page, 1), totalPages);

  // Filter items by page
  const pageItems = INLINE_LOCK_ITEMS.filter(item => item.page === currentPage);

  const rows: any[] = [];

  // Build lock buttons in pairs (2 per row)
  for (let i = 0; i < pageItems.length; i += 2) {
    const row: any[] = [];

    for (let j = 0; j < 2 && i + j < pageItems.length; j++) {
      const item = pageItems[i + j];
      const isOn = item.keys.some((key) => settings.rules[key]?.enabled);
      const statusIcon = isOn ? "✅" : "❌";
      const label = `${statusIcon} ${item.label}`;
      row.push(Markup.button.callback(label, `fw_inline_lock:${chatId}:${currentPage}:${item.id}`));
    }

    rows.push(row);
  }

  // Navigation row
  const navRow: any[] = [];
  if (currentPage > 1) {
    navRow.push(Markup.button.callback("◀️ Previous", `fw_inline_locks:${chatId}:${currentPage - 1}`));
  }
  if (currentPage < totalPages) {
    navRow.push(Markup.button.callback("▶️ Next Page", `fw_inline_locks:${chatId}:${currentPage + 1}`));
  }

  if (navRow.length > 0) {
    rows.push(navRow);
  }

  // Back button
  rows.push([Markup.button.callback("◀️ Back to Panel", `fw_inline_menu:${chatId}`)]);

  return Markup.inlineKeyboard(rows);
}

async function showInlineLocksPage(ctx: Context, chatId: string, page: number): Promise<void> {
  let settings: GroupBanSettingsRecord;
  try {
    settings = await loadBanSettingsByChatId(chatId);
  } catch {
    await replyOrEditRoot(
      ctx,
      "Unable to load lock settings for this group right now.",
      Markup.inlineKeyboard([[Markup.button.callback("◀️ Back to Panel", `fw_inline_menu:${chatId}`)]]),
    );
    return;
  }

  const totalPages = 3; // We have 3 pages now
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const groups = listGroups();
  const group = groups.find((g) => g.chatId === chatId) ?? null;
  const title = group?.title ?? chatId;

  // Page titles
  const pageTitles = [
    "Links & Content",
    "Media & Files",
    "Bots & Advanced"
  ];
  const pageTitle = pageTitles[currentPage - 1] || "Locks";

  const message = `🔐 Locks — Group: ${title}\nPage ${currentPage}/${totalPages} — ${pageTitle}\n\nTap a lock to toggle it on or off.`;
  await replyOrEditRoot(ctx, message, buildInlineLocksKeyboard(chatId, currentPage, settings));
}

function getInlineListConfig(id: string): InlineListConfig | undefined {
  return INLINE_LIST_CONFIGS.find((cfg) => cfg.id === (id as InlineListId));
}

function buildInlineListsKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];

  // Build list buttons in pairs (2 per row)
  for (let i = 0; i < INLINE_LIST_CONFIGS.length; i += 2) {
    const row: any[] = [];

    for (let j = 0; j < 2 && i + j < INLINE_LIST_CONFIGS.length; j++) {
      const cfg = INLINE_LIST_CONFIGS[i + j];
      row.push(Markup.button.callback(cfg.title, `fw_inline_list:${chatId}:${cfg.id}`));
    }

    rows.push(row);
  }

  rows.push([Markup.button.callback("◀️ Back to Panel", `fw_inline_menu:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showInlineListsOverview(ctx: Context, chatId: string): Promise<void> {
  let banSettings: GroupBanSettingsRecord | null = null;
  try {
    banSettings = await loadBanSettingsByChatId(chatId);
  } catch (loadError) {
    logger.error("Failed to load ban settings", { chatId, error: loadError });
    banSettings = null;
  }

  // Get raw settings for accessing all fields
  const rawSettings = banSettings as unknown as Record<string, unknown> | null;



  // Extract counts from banSettings directly
  const filterCount = banSettings?.blacklist?.length ?? 0;
  const allowCount = banSettings?.whitelist?.length ?? 0;
  const vipCount = Array.isArray(rawSettings?.vipMembers) ? (rawSettings.vipMembers as unknown[]).length : 0;
  const exemptCount = Array.isArray(rawSettings?.exemptUsers) ? (rawSettings.exemptUsers as unknown[]).length : 0;
  const forwardWhitelistCount = Array.isArray(rawSettings?.forwardWhitelist) ? (rawSettings.forwardWhitelist as unknown[]).length : 0;
  const autoRepliesCount = Array.isArray(rawSettings?.autoReplies) ? (rawSettings.autoReplies as unknown[]).length : 0;
  const scheduledPostsCount = Array.isArray(rawSettings?.scheduledPosts) ? (rawSettings.scheduledPosts as unknown[]).length : 0;

  // Load other statistics from database (admins, warnings, muted, banned)
  const stats = await loadGroupListStats(chatId);

  // Fetch owner/admin counts from Telegram API (more reliable)
  let ownersCount = 0;
  let adminsCount = 0;
  try {
    const numericChatId = parseInt(chatId, 10);
    if (!isNaN(numericChatId)) {
      const admins = await ctx.telegram.getChatAdministrators(numericChatId);
      ownersCount = admins.filter(a => a.status === "creator").length;
      adminsCount = admins.filter(a => a.status === "administrator").length;
    }
  } catch (error) {
    logger.debug("Failed to fetch chat administrators for overview", { chatId, error: (error as Error).message });
    // Fall back to stats from database
    ownersCount = stats.ownersCount;
    adminsCount = stats.adminsCount;
  }

  const groups = listGroups();
  const group = groups.find((g) => g.chatId === chatId) ?? null;
  const title = group?.title ?? chatId;

  const lines: string[] = [];
  lines.push(`📂 Lists Section — Group: ${title}`);
  lines.push("");
  lines.push("📊 Current Statistics:");
  lines.push(`├─ 👑 Owners: ${ownersCount}`);
  lines.push(`├─ 👥 Admins: ${adminsCount}`);
  lines.push(`├─ ⭐ VIP Members: ${vipCount}`);
  lines.push(`├─ 🔇 Muted: ${stats.mutedCount}`);
  lines.push(`├─ 🚫 Banned: ${stats.bannedCount}`);
  lines.push(`├─ ⚠️ Warnings: ${stats.warningsCount}`);
  lines.push(`├─ ✅ Exempt: ${exemptCount}`);
  lines.push(`├─ 🚷 Filtered Keywords: ${filterCount}`);
  lines.push(`├─ ✔️ Allowed Keywords: ${allowCount}`);
  lines.push(`├─ ↪️ Allowed Forwards: ${forwardWhitelistCount}`);
  lines.push(`├─ 🤖 Auto Replies: ${autoRepliesCount}`);
  lines.push(`└─ ⏰ Scheduled Posts: ${scheduledPostsCount}`);
  lines.push("");
  lines.push("Tap a list to view details.");

  const message = lines.join("\n");
  await replyOrEditRoot(ctx, message, buildInlineListsKeyboard(chatId));
}

async function showInlineListDetail(ctx: Context, chatId: string, listId: string): Promise<void> {
  const cfg = getInlineListConfig(listId);
  if (!cfg) {
    await replyOrEditRoot(ctx, "Unknown list.", buildInlineListsKeyboard(chatId));
    return;
  }

  let banSettings: GroupBanSettingsRecord | null = null;
  // Load ban settings for lists that use them
  const listsNeedingBanSettings = ["filters", "whitelist", "vip", "exempt", "forward_whitelist", "auto_replies", "scheduled_posts"];
  if (listsNeedingBanSettings.includes(cfg.id)) {
    try {
      banSettings = await loadBanSettingsByChatId(chatId);
    } catch {
      banSettings = null;
    }
  }

  const groups = listGroups();
  const group = groups.find((g) => g.chatId === chatId) ?? null;
  const title = group?.title ?? chatId;

  const lines: string[] = [];
  lines.push(`${cfg.title} — Group: ${title}`);
  lines.push("");

  if (cfg.id === "filters" || cfg.id === "whitelist") {
    const items = cfg.id === "filters" ? banSettings?.blacklist ?? [] : banSettings?.whitelist ?? [];
    if (!items.length) {
      lines.push("⚠️ This list is empty.");
    } else {
      lines.push(`📊 Total items: ${items.length}`);
      lines.push("");
      for (const entry of items) {
        lines.push(`• ${entry}`);
      }
    }

    if (cfg.commandUsage && cfg.commandExample) {
      lines.push("");
      lines.push("💡 You can also use commands in the group:");
      lines.push(`   ${cfg.commandUsage}`);
      lines.push(`   Example: ${cfg.commandExample}`);
    }
  } else if (cfg.id === "vip") {
    // Display VIP members from banSettings
    const rawSettings = banSettings as unknown as Record<string, unknown>;
    const vipMembers = Array.isArray(rawSettings?.vipMembers) ? rawSettings.vipMembers as string[] : [];

    if (!vipMembers.length) {
      lines.push("⚠️ No VIP members yet.");
      lines.push("");
      lines.push("💡 VIP members bypass all content restrictions.");
    } else {
      lines.push(`📊 Total VIP members: ${vipMembers.length}`);
      lines.push("");
      for (const member of vipMembers) {
        lines.push(`• ${member}`);
      }
      lines.push("");
      lines.push("💡 VIP members bypass all content restrictions.");
    }

    if (cfg.commandUsage && cfg.commandExample) {
      lines.push("");
      lines.push("💡 You can also use commands in the group:");
      lines.push(`   ${cfg.commandUsage}`);
      lines.push(`   Example: ${cfg.commandExample}`);
    }
  } else if (cfg.id === "owners" || cfg.id === "admins") {
    // Fetch real admins from Telegram API
    if (cfg.description) {
      lines.push(`ℹ️ ${cfg.description}`);
      lines.push("");
    }

    try {
      const numericChatId = parseInt(chatId, 10);
      if (!isNaN(numericChatId)) {
        const admins = await ctx.telegram.getChatAdministrators(numericChatId);

        if (cfg.id === "owners") {
          const owners = admins.filter(a => a.status === "creator");
          lines.push(`📊 Total owners: ${owners.length}`);
          lines.push("");
          for (const owner of owners) {
            const name = owner.user.first_name + (owner.user.last_name ? ` ${owner.user.last_name}` : "");
            const username = owner.user.username ? ` (@${owner.user.username})` : "";
            lines.push(`• ${name}${username}`);
            lines.push(`  ID: ${owner.user.id}`);
          }
        } else {
          const adminsList = admins.filter(a => a.status === "administrator");
          lines.push(`📊 Total admins: ${adminsList.length}`);
          lines.push("");
          for (const admin of adminsList) {
            const name = admin.user.first_name + (admin.user.last_name ? ` ${admin.user.last_name}` : "");
            const username = admin.user.username ? ` (@${admin.user.username})` : "";
            const customTitle = 'custom_title' in admin && admin.custom_title ? ` [${admin.custom_title}]` : "";
            lines.push(`• ${name}${username}${customTitle}`);
          }
        }
      } else {
        lines.push("⚠️ Unable to fetch administrators for this chat.");
      }
    } catch (error) {
      logger.debug("Failed to fetch chat administrators", { chatId, error: (error as Error).message });
      lines.push("⚠️ Unable to fetch administrators. Bot may not have permission.");
    }
    lines.push("");
    lines.push("ℹ️ Owner and admin management is handled through Telegram's group settings.");
  } else if (cfg.id === "warnings") {
    const stats = await loadGroupListStats(chatId);
    lines.push(`📊 Active warnings: ${stats.warningsCount}`);
    lines.push("");
    lines.push("ℹ️ Warnings are issued automatically when users violate rules.");
    lines.push("Use <code>!reset</code> (reply) to clear a user's warnings.");
  } else if (cfg.id === "muted" || cfg.id === "banned") {
    const stats = await loadGroupListStats(chatId);
    const count = cfg.id === "muted" ? stats.mutedCount : stats.bannedCount;
    const label = cfg.id === "muted" ? "muted" : "banned";
    lines.push(`📊 Recently ${label}: ${count} (last 30 days)`);
    lines.push("");
    lines.push(`ℹ️ Use <code>!${cfg.id === "muted" ? "mute" : "ban"} [hours]</code> (reply) to ${label} users.`);
    lines.push(`Use <code>!unmute</code> (reply) to remove restrictions.`);
    lines.push("");
    lines.push("💡 <b>How to add:</b>");
    lines.push(`   In your group, reply to a user's message and send:`);
    lines.push(`   <code>${cfg.commandUsage}</code>`);
    lines.push(`   Example: <code>${cfg.commandExample}</code>`);
  } else if (cfg.id === "exempt") {
    // Display exempt users from banSettings
    const rawSettings = banSettings as unknown as Record<string, unknown>;
    const exemptUsers = Array.isArray(rawSettings?.exemptUsers) ? rawSettings.exemptUsers as string[] : [];

    if (!exemptUsers.length) {
      lines.push("⚠️ No exempt users yet.");
      lines.push("");
      lines.push("💡 Exempt users bypass content restrictions.");
    } else {
      lines.push(`📊 Total exempt users: ${exemptUsers.length}`);
      lines.push("");
      for (const user of exemptUsers) {
        lines.push(`• ${user}`);
      }
      lines.push("");
      lines.push("💡 Exempt users bypass content restrictions.");
    }

    if (cfg.commandUsage && cfg.commandExample) {
      lines.push("");
      lines.push("💡 <b>How to add:</b>");
      lines.push(`   In your group, use: <code>${cfg.commandUsage}</code>`);
      lines.push(`   Example: <code>${cfg.commandExample}</code>`);
    }
  } else if (cfg.id === "forward_whitelist") {
    // Display forward whitelist from banSettings
    const rawSettings = banSettings as unknown as Record<string, unknown>;
    const forwardWhitelist = Array.isArray(rawSettings?.forwardWhitelist) ? rawSettings.forwardWhitelist as string[] : [];

    if (!forwardWhitelist.length) {
      lines.push("⚠️ No allowed forward channels yet.");
      lines.push("");
      lines.push("💡 Add channels to allow forwarding messages from them.");
    } else {
      lines.push(`📊 Total allowed channels: ${forwardWhitelist.length}`);
      lines.push("");
      for (const channel of forwardWhitelist) {
        lines.push(`• ${channel}`);
      }
      lines.push("");
      lines.push("💡 Messages forwarded from these channels won't be blocked.");
    }

    if (cfg.commandUsage && cfg.commandExample) {
      lines.push("");
      lines.push("💡 <b>How to add:</b>");
      lines.push(`   In your group, use: <code>${cfg.commandUsage}</code>`);
      lines.push(`   Example: <code>${cfg.commandExample}</code>`);
    }
  } else if (cfg.id === "auto_replies") {
    // Display auto replies from banSettings
    const rawSettings = banSettings as unknown as Record<string, unknown>;
    const autoReplies = Array.isArray(rawSettings?.autoReplies) ? rawSettings.autoReplies as Array<{ trigger?: string; response?: string }> : [];

    if (!autoReplies.length) {
      lines.push("⚠️ No auto replies configured yet.");
      lines.push("");
      lines.push("💡 Auto replies automatically respond to specific triggers.");
    } else {
      lines.push(`📊 Total auto replies: ${autoReplies.length}`);
      lines.push("");
      for (const reply of autoReplies.slice(0, 10)) {
        const trigger = reply.trigger ?? "(unknown)";
        const response = reply.response ?? "(no response)";
        const truncatedResponse = response.length > 30 ? response.substring(0, 27) + "..." : response;
        lines.push(`• <b>${trigger}</b> → ${truncatedResponse}`);
      }
      if (autoReplies.length > 10) {
        lines.push(`... and ${autoReplies.length - 10} more`);
      }
    }

    lines.push("");
    lines.push("💡 <b>How to add:</b>");
    lines.push(`   Use the ➕ Add button below.`);
    lines.push(`   Step 1: Enter trigger keyword`);
    lines.push(`   Step 2: Enter response message`);
  } else if (cfg.id === "scheduled_posts") {
    // Display scheduled posts from banSettings
    const rawSettings = banSettings as unknown as Record<string, unknown>;
    const scheduledPosts = Array.isArray(rawSettings?.scheduledPosts) ? rawSettings.scheduledPosts as Array<{
      message?: string;
      scheduleTime?: string;
      scheduleType?: string;
      scheduleDayOfWeek?: number;
      scheduleDate?: string;
      enabled?: boolean;
    }> : [];

    if (!scheduledPosts.length) {
      lines.push("⚠️ No scheduled posts yet.");
      lines.push("");
      lines.push("💡 Schedule posts to be sent at specific times.");
    } else {
      lines.push(`📊 Total scheduled posts: ${scheduledPosts.length}`);
      lines.push("");
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      for (const post of scheduledPosts.slice(0, 5)) {
        const message = post.message ?? "(no content)";
        const truncatedMessage = message.length > 25 ? message.substring(0, 22) + "..." : message;

        let scheduleDisplay = post.scheduleTime ?? "(unknown time)";
        if (post.scheduleType === "weekly" && post.scheduleDayOfWeek !== undefined) {
          scheduleDisplay = `${dayNames[post.scheduleDayOfWeek]} ${post.scheduleTime}`;
        } else if (post.scheduleType === "once" && post.scheduleDate) {
          scheduleDisplay = `${post.scheduleDate} ${post.scheduleTime}`;
        } else if (post.scheduleType === "daily") {
          scheduleDisplay = `Daily ${post.scheduleTime}`;
        }

        const statusIcon = post.enabled !== false ? "✅" : "⏸️";
        lines.push(`${statusIcon} ${scheduleDisplay}: ${truncatedMessage}`);
      }
      if (scheduledPosts.length > 5) {
        lines.push(`... and ${scheduledPosts.length - 5} more`);
      }
    }

    lines.push("");
    lines.push("💡 <b>How to add:</b>");
    lines.push(`   Use the ➕ Add button below.`);
    lines.push(`   Step 1: Enter message content`);
    lines.push(`   Step 2: Set schedule time`);
  } else {
    lines.push("ℹ️ This list is not available in the inline panel yet.");
    lines.push("");
    lines.push("💡 Use the Mini App for full access to all features.");
  }

  const rows: any[] = [];
  if (cfg.supportsAdd) {
    rows.push([Markup.button.callback("➕ Add to List", `fw_inline_add:${chatId}:${cfg.id}`)]);
  }
  rows.push([Markup.button.callback("◀️ Back to Lists", `fw_inline_lists:${chatId}`)]);
  rows.push([Markup.button.callback("◀️ Back to Panel", `fw_inline_menu:${chatId}`)]);

  await replyOrEditRoot(ctx, lines.join("\n"), Markup.inlineKeyboard(rows));
}

export async function formatStatisticsSummary(): Promise<string> {
  const state = getState();
  const allGroups = await loadGroupsSnapshot(null, { includeAll: true });
  const totalCredit = allGroups.reduce((acc, group) => acc + group.creditBalance, 0);
  const lastBroadcast = state.broadcasts[0]?.createdAt ?? "Never";
  return [
    `Channels configured: ${state.promoSlides.length}`,
    `Panel admins: ${state.panelAdmins.length}`,
    `Banned users: ${state.bannedUserIds.length}`,
    `Groups tracked: ${allGroups.length}`,
    `Total credit balance: ${totalCredit}`,
    `Last broadcast: ${lastBroadcast}`
  ].join("\n");
}

function parseNumericUserId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function parseChatIdentifier(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return trimmed;
  }
  if (/^@[a-zA-Z0-9_]{5,}$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function extractChatIdAndPayload(raw: string): { chatId: string; payload: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const [first, ...rest] = trimmed.split(/\s+/);
  const chatId = parseChatIdentifier(first);
  if (!chatId) {
    return null;
  }
  return {
    chatId,
    payload: rest.join(" ").trim()
  };
}

function parseCreditPayload(raw: string): { chatId: string; amount: number } | null {
  const parsed = extractChatIdAndPayload(raw);
  if (!parsed || !parsed.payload) {
    return null;
  }
  const amount = Number.parseInt(parsed.payload, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return { chatId: parsed.chatId, amount };
}

function resolveHttpStatus(error: unknown): number {
  if (error && typeof error === "object" && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 600) {
      return statusCode;
    }
  }

  if (error instanceof Error) {
    if (/insufficient/i.test(error.message)) {
      return 400;
    }
    if (/not found/i.test(error.message)) {
      return 404;
    }
  }

  return 500;
}

function asyncHandler(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, _next: NextFunction) => {
    handler(req, res).catch((error) => {
      const status = resolveHttpStatus(error);
      const message = error instanceof Error ? error.message : "Unexpected server error";
      const safeMessage = status >= 500 ? "Internal server error" : message;
      if (status >= 500) {
        const reqWithId = req as RequestWithId;
        logger.error("[api] Handler error", { requestId: reqWithId.id, error });
      }
      res.status(status).json({ error: safeMessage });
    });
  };
}

function registerApiRoutes(app: express.Express): void {
  app.get(
    "/healthz",
    asyncHandler(async (_req, res) => {
      const database = await checkDatabaseHealth();
      const healthy = database.status === "ok";

      res.status(healthy ? 200 : 503).json({
        status: healthy ? "ok" : "error",
        uptime: Number(process.uptime().toFixed(2)),
        database,
      });
    }),
  );

  app.use("/api/v1", createApiRouter({
    ownerTelegramId: ownerUserId ?? null,
    telegram: bot.telegram
  }));

  app.get(
    "/api/stars/overview",
    asyncHandler(async (_req, res) => {
      const overview = await buildStarsOverview(ownerUserId ?? null);
      res.json(overview);
    }),
  );

  app.get(
    "/api/stars/search",
    asyncHandler(async (req, res) => {
      const query = typeof req.query.q === "string" ? req.query.q : "";
      const results = await searchGroupRecords(query, 30);
      res.json(results);
    }),
  );

  app.post(
    "/api/stars/purchase",
    asyncHandler(async (req, res) => {
      const { groupId, planId, metadata } = req.body ?? {};

      try {
        const ownerId = req.telegramAuth?.userId;
        if (!ownerId) {
          res.status(401).json({ error: "Telegram authentication required" });
          return;
        }
        if (typeof groupId !== "string" || groupId.trim().length === 0) {
          res.status(400).json({ error: "groupId is required" });
          return;
        }
        if (typeof planId !== "string" || planId.trim().length === 0) {
          res.status(400).json({ error: "planId is required" });
          return;
        }

        const payload = await purchaseStars({
          ownerTelegramId: ownerId,
          groupId: groupId.trim(),
          planId: planId.trim(),
          gifted: false,
          metadata,
          managed: true,
        });

        res.json(payload);
      } catch (error) {
        const status = resolveHttpStatus(error);
        const message = error instanceof Error ? error.message : "Failed to record purchase";
        const safeMessage = status >= 500 ? "Internal server error" : message;
        res.status(status).json({ error: safeMessage });
      }
    }),
  );

  app.post(
    "/api/stars/gift",
    asyncHandler(async (req, res) => {
      const { planId, group } = req.body ?? {};
      if (!group || typeof group !== "object") {
        res.status(400).json({ error: "group is required" });
        return;
      }

      const ownerId = req.telegramAuth?.userId;
      if (!ownerId) {
        res.status(401).json({ error: "Telegram authentication required" });
        return;
      }
      const rawGroup = group as {
        id?: unknown;
        title?: unknown;
        membersCount?: unknown;
        inviteLink?: unknown;
        photoUrl?: unknown;
        canManage?: unknown;
      };

      const groupId =
        typeof rawGroup.id === "string" && rawGroup.id.trim().length > 0
          ? rawGroup.id.trim()
          : typeof rawGroup.id === "number"
            ? rawGroup.id.toString()
            : "";

      if (groupId.length === 0) {
        res.status(400).json({ error: "group.id is required" });
        return;
      }

      if (typeof planId !== "string" || planId.trim().length === 0) {
        res.status(400).json({ error: "planId is required" });
        return;
      }

      try {
        const result = await purchaseStars({
          ownerTelegramId: ownerId,
          groupId,
          planId: planId.trim(),
          metadata: {
            title: rawGroup.title,
            membersCount: rawGroup.membersCount,
            inviteLink: rawGroup.inviteLink,
            photoUrl: rawGroup.photoUrl,
          },
          managed: Boolean(rawGroup.canManage),
          gifted: true,
        });
        res.json(result);
      } catch (error) {
        const status = resolveHttpStatus(error);
        const message = error instanceof Error ? error.message : "Failed to complete gift";
        const safeMessage = status >= 500 ? "Internal server error" : message;
        res.status(status).json({ error: safeMessage });
      }
    }),
  );

  app.get(
    "/api/stars/wallet",
    asyncHandler(async (req, res) => {
      const ownerId = req.telegramAuth?.userId ?? null;
      const limit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
      const summary = await getStarsWalletSummary(ownerId, { limit: Number.isFinite(limit) ? limit : undefined });
      res.json(summary);
    }),
  );

  app.post(
    "/api/stars/transactions/:id/refund",
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { reason } = req.body ?? {};
      const result = await refundStarsTransaction(id, {
        operatorTelegramId: req.telegramAuth?.userId,
        reason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : undefined,
      });
      res.json(result);
    }),
  );

  app.get(
    "/api/firewall/audits/:chatId",
    asyncHandler(async (req, res) => {
      const chatId = req.params.chatId;
      if (!chatId) {
        res.status(400).json({ error: "chatId is required" });
        return;
      }

      const { listRuleAudits } = await import("../server/db/firewallRepository.js");
      const audits = await listRuleAudits(chatId, 200);
      res.json({ chatId, audits });
    }),
  );

}

function isValidHttpUrl(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function respondWithOwnerView(ctx: Context, text: string, keyboard: InlineKeyboard): Promise<void> {
  if (ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery();
    } catch {
      // Ignore secondary acknowledgement errors.
    }

    try {
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: keyboard.reply_markup
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("message is not modified")) {
        logger.warn("bot falling back to a new message in the owner panel flow", { message });
      }
    }
  }

  // send owner panel replies as HTML so stored content can include <b>/<i> tags
  // `keyboard` is a Markup.inlineKeyboard() return value which includes reply_markup
  await ctx.replyWithHTML(text, keyboard as any);
}

bot.start(async (ctx) => {
  // Handle referral tracking
  // Support both formats: ref_<userId> and ref=<userId>
  const startPayload = ctx.message?.text?.split(' ')[1];
  if (startPayload) {
    try {
      let referrerId: string | null = null;

      // Format 1: ref_<userId> (from MissionsPage referral links)
      if (startPayload.startsWith('ref_')) {
        referrerId = startPayload.substring(4).split('&')[0];
      }
      // Format 2: ref=<userId> (legacy format)
      else if (startPayload.includes('ref=')) {
        referrerId = startPayload.split('ref=')[1]?.split('&')[0] ?? null;
      }

      if (referrerId && referrerId.trim().length > 0) {
        referrerId = referrerId.trim();
        const newUserId = ctx.from?.id?.toString();

        if (newUserId && referrerId !== newUserId) {
          logger.info('processing referral', { referrerId, newUserId, payload: startPayload });

          // Track referral via API
          await fetch(`http://localhost:${process.env.PORT || 3000}/api/referrals/track`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              referrerId,
              newUserId,
              source: 'bot-start'
            })
          }).catch(error => {
            logger.warn('Failed to track referral', { referrerId, newUserId, error });
          });
        }
      }
    } catch (error) {
      logger.warn('Error processing referral', { payload: startPayload, error });
    }
  }

  await sendStartMenu(ctx);
});

bot.command("panel", async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  if (!isPrivateChat(ctx)) {
    await ctx.reply("Open a private chat with the bot to access the owner panel.");
    return;
  }

  resetOwnerSession();
  await respondWithOwnerView(ctx, ownerMessages.panelIntro, buildOwnerPanelKeyboard());
});

bot.action(actionId("managementPanel"), async (ctx) => {
  await ctx.answerCbQuery();

  const id = actorId(ctx);
  if (id && id !== ownerUserId && isUserBanned(id)) {
    await ctx.reply("You are blocked from opening the management panel.");
    return;
  }

  const settings = getPanelSettings();
  const labels = settings.buttonLabels ?? {};
  const miniAppLabel = labels.panel_mini_app ?? content.buttons.miniApp;
  const inlineLabel = labels.panel_inline_panel ?? content.buttons.inlinePanel;
  const backLabel = labels.panel_back ?? "\u{1F519} Back";

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp(miniAppLabel, miniAppUrl)],
    [Markup.button.callback(inlineLabel, actionId("inlinePanel"))],
    [Markup.button.callback(backLabel, actionId("managementBack"))]
  ]);

  // send management panel as HTML so content can include <b>/<i> tags and render correctly
  const managementMessage = `${content.messages.managementPanel}\n\n<i>${content.messages.managementQuestion}</i>`;

  await replyOrEditRoot(ctx, managementMessage, keyboard);
});

bot.action(actionId("inlinePanel"), async (ctx) => {
  await ctx.answerCbQuery();
  await showInlineGroupSelection(ctx);
});

bot.action(actionId("managementBack"), async (ctx) => {
  await ctx.answerCbQuery();
  await sendStartMenu(ctx);
});

bot.action(INLINE_GROUP_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? (ctx.callbackQuery as any).data
      : "";
  const match = data.match(INLINE_GROUP_REGEX);
  const chatId = match?.[1];
  if (!chatId) {
    await showInlineGroupSelection(ctx);
    return;
  }
  await showInlineGroupMenu(ctx, chatId);
});

bot.action(INLINE_BACK_TO_GROUPS, async (ctx) => {
  await ctx.answerCbQuery();
  await showInlineGroupSelection(ctx);
});

bot.action(INLINE_MENU_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? (ctx.callbackQuery as any).data
      : "";
  const match = data.match(INLINE_MENU_REGEX);
  const chatId = match?.[1];
  if (!chatId) {
    await showInlineGroupSelection(ctx);
    return;
  }
  await showInlineGroupMenu(ctx, chatId);
});

bot.action(INLINE_HELP_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(INLINE_HELP_REGEX);
  const chatId = match?.[1];
  if (!chatId) return;

  // Show comprehensive help center with all sections
  await showInlineHelp(ctx, chatId);
});

bot.action(INLINE_ADVANCED_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(INLINE_ADVANCED_REGEX);
  const chatId = match?.[1];
  if (!chatId) return;

  await showInlineAdvanced(ctx, chatId);
});

// Advanced Settings sub-feature regex patterns
const ADV_TEMPMEDIA_REGEX = /^fw_adv_tempmedia:(-?\d+)$/;
const ADV_TEMPMEDIA_TOGGLE_REGEX = /^fw_adv_tm_toggle:(-?\d+):([a-z]+)$/;
const ADV_TEMPMEDIA_TIME_REGEX = /^fw_adv_tm_time:(-?\d+):(up|down|upfast|downfast)$/;
const ADV_TOGGLE_REGEX = /^fw_adv_toggle:(-?\d+):([a-z_]+)$/;
const ADV_WELCOME_REGEX = /^fw_adv_welcome:(-?\d+)$/;
const ADV_WARNING_REGEX = /^fw_adv_warning:(-?\d+)$/;
const ADV_FLOOD_REGEX = /^fw_adv_flood:(-?\d+)$/;
const ADV_MANDATORY_REGEX = /^fw_adv_mandatory:(-?\d+)$/;
const ADV_CLEANUP_REGEX = /^fw_adv_cleanup:(-?\d+)$/;
const ADV_REPORTS_REGEX = /^fw_adv_reports:(-?\d+)$/;

// Advanced Settings Types
type AdvancedFeature = {
  id: string;
  title: string;
  icon: string;
  settingsKey?: string;         // Key in generalSettings
  banSettingsKey?: string;      // Key in banSettings.rules
  banSettingsRootKey?: string;  // Key at root level of banSettings (not in rules)
  hasSubMenu?: boolean;
};

const ADVANCED_FEATURES: AdvancedFeature[] = [
  // Row 1
  { id: "temp_media", title: "Temp Media", icon: "⏰", hasSubMenu: true },
  { id: "verification", title: "Verification", icon: "✅", hasSubMenu: true },
  { id: "anti_betrayal", title: "Anti-Betrayal", icon: "🛡️", banSettingsRootKey: "antiBetrayal", hasSubMenu: true },
  // Row 2
  { id: "mandatory_join", title: "Mandatory Join", icon: "📋", hasSubMenu: true },
  { id: "mandatory_add", title: "Mandatory Add", icon: "➕", banSettingsRootKey: "mandatoryAdd", hasSubMenu: true },
  { id: "welcome", title: "Welcome", icon: "👋", settingsKey: "welcomeEnabled", hasSubMenu: true },
  // Row 3
  { id: "warning", title: "Warnings", icon: "⚠️", settingsKey: "warningEnabled", hasSubMenu: true },
  { id: "anti_ad", title: "Anti-Ad", icon: "🚫", banSettingsKey: "blockLinks" },
  { id: "strict_mode", title: "Strict Lock", icon: "🔒", hasSubMenu: true },
  // Row 4
  { id: "auto_lock", title: "Auto Lock", icon: "🔐", hasSubMenu: true },
  { id: "flood", title: "Flood Protection", icon: "💬", hasSubMenu: true },
  { id: "lock_limit", title: "Lock Limit", icon: "📊", hasSubMenu: true },
  // Row 5
  { id: "permissions", title: "Permissions", icon: "⚙️", hasSubMenu: true },
  { id: "cleanup", title: "Cleanup", icon: "🧹", hasSubMenu: true },
  { id: "lock_features", title: "Lock Features", icon: "🔒", banSettingsRootKey: "lockFeatures" },
  // Row 6
  { id: "timezone", title: "Time Zone", icon: "🕐", hasSubMenu: true },
  { id: "reports", title: "Reports", icon: "📈", hasSubMenu: true },
];

async function showInlineAdvanced(ctx: Context, chatId: string): Promise<void> {
  let generalSettings;
  let banSettings;

  try {
    generalSettings = await loadGeneralSettingsByChatId(chatId);
  } catch {
    generalSettings = null;
  }

  try {
    banSettings = await loadBanSettingsByChatId(chatId);
  } catch {
    banSettings = null;
  }

  const rawGeneral = generalSettings as Record<string, unknown> | null;
  const rawBan = banSettings as unknown as Record<string, unknown> | null;

  // Check if group is premium
  const isPremium = isGroupPremium(chatId);
  const premiumOnlyFeatureIds = ["mandatory_join", "mandatory_add", "auto_lock"];

  // Build status line - count enabled features
  const enabledCount = ADVANCED_FEATURES.filter(f => {
    if (f.settingsKey && rawGeneral) {
      return rawGeneral[f.settingsKey] === true;
    }
    if (f.banSettingsKey && rawBan?.rules) {
      const rules = rawBan.rules as Record<string, unknown>;
      return rules[f.banSettingsKey] === true;
    }
    if (f.banSettingsRootKey && rawBan) {
      return rawBan[f.banSettingsRootKey] === true;
    }
    if (f.id === "temp_media" && rawBan) {
      return (rawBan as any).tempMediaEnabled === true;
    }
    return false;
  }).length;

  const message = `⚙️ <b>Advanced Settings</b>

Configure advanced protection features for your group.

📊 <b>Status:</b> ${enabledCount} features enabled
${!isPremium ? `\n⭐ Features marked with ⭐ require Premium` : ""}

<i>Tap a feature to configure it.</i>`;

  const rows: any[] = [];

  // Build 2-column layout - NO status emojis on buttons
  for (let i = 0; i < ADVANCED_FEATURES.length; i += 2) {
    const f1 = ADVANCED_FEATURES[i];
    const f2 = ADVANCED_FEATURES[i + 1];

    const row: any[] = [];

    // Add premium lock badge for premium-only features
    const isPremiumOnly1 = premiumOnlyFeatureIds.includes(f1.id);
    const premiumBadge1 = isPremiumOnly1 && !isPremium ? " ⭐" : "";

    // All features now go to submenu (hasSubMenu = true for all)
    const callback1 = `fw_adv_${f1.id}:${chatId}`;
    row.push(Markup.button.callback(`${f1.icon} ${f1.title}${premiumBadge1}`, callback1));

    // Feature 2 (if exists)
    if (f2) {
      const isPremiumOnly2 = premiumOnlyFeatureIds.includes(f2.id);
      const premiumBadge2 = isPremiumOnly2 && !isPremium ? " ⭐" : "";

      const callback2 = `fw_adv_${f2.id}:${chatId}`;
      row.push(Markup.button.callback(`${f2.icon} ${f2.title}${premiumBadge2}`, callback2));
    }

    rows.push(row);
  }

  // Back button
  rows.push([Markup.button.callback("◀️ Back to Panel", `fw_inline_menu:${chatId}`)]);

  const keyboard = Markup.inlineKeyboard(rows);
  await replyOrEditRoot(ctx, message, keyboard);
}

// Old toggle handler removed - now handled by general router below

// ========== TEMP MEDIA HANDLERS (before general router) ==========
// Temp Media master toggle - MUST be before general router
bot.action(/^fw_adv_tm_master:(-?\d+):(on|off)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_tm_master:(-?\d+):(on|off)$/);
  const chatId = match?.[1];
  const action = match?.[2];

  if (!chatId || !action) {
    await ctx.answerCbQuery("Error: missing parameters");
    return;
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    rawSettings.tempMediaEnabled = action === "on";

    // Initialize tempMedia settings if enabling
    if (action === "on" && !rawSettings.tempMedia) {
      rawSettings.tempMedia = {
        deleteMinutes: 20,
        gif: true,
        sticker: true,
        video: true,
        photo: true,
        file: false,
        audio: false,
        userType: "nonadmin",
      };
    }

    await saveBanSettingsByChatId(chatId, settings);

    if (action === "on") {
      await ctx.answerCbQuery("✅ Temp Media enabled!", { show_alert: false });
    } else {
      await ctx.answerCbQuery("❌ Temp Media disabled!", { show_alert: false });
    }
  } catch (error) {
    logger.error("Failed to toggle temp media", { chatId, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
    return;
  }

  await showTempMediaSettings(ctx, chatId);
});

// Temp Media user type toggle - MUST be before general router
bot.action(/^fw_adv_tm_usertype:(-?\d+)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_tm_usertype:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.tempMedia) {
      rawSettings.tempMedia = { userType: "nonadmin" };
    }
    const tempMedia = rawSettings.tempMedia as Record<string, unknown>;

    // Toggle between "all" and "nonadmin"
    const currentType = (tempMedia.userType as string) ?? "nonadmin";
    const newType = currentType === "all" ? "nonadmin" : "all";
    tempMedia.userType = newType;

    await saveBanSettingsByChatId(chatId, settings);

    // Show notification with alert for important change
    if (newType === "all") {
      await ctx.answerCbQuery(
        "Set to All Members!\n\nIn this mode, media sent by bot admins will also be automatically deleted",
        { show_alert: true }
      );
    } else {
      await ctx.answerCbQuery(
        "Set to Non-Admins!\n\nAdmin media will not be deleted",
        { show_alert: true }
      );
    }
  } catch (error) {
    logger.error("Failed to toggle temp media user type", { chatId, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
  }

  await showTempMediaSettings(ctx, chatId);
});

// General handler router for all advanced features
bot.action(/^fw_adv_([a-z_]+):(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_([a-z_]+):(-?\d+)$/);
  const featureId = match?.[1];
  const chatId = match?.[2];
  if (!chatId || !featureId) return;

  const feature = ADVANCED_FEATURES.find(f => f.id === featureId);
  if (!feature) {
    await ctx.reply("Unknown feature");
    return;
  }

  // Route to appropriate handler based on feature
  if (feature.hasSubMenu) {
    // Route to specific submenu handlers
    switch (featureId) {
      case "temp_media":
        await showTempMediaSettings(ctx, chatId);
        break;
      case "verification":
        await showVerificationSettings(ctx, chatId);
        break;
      case "welcome":
        await showWelcomeSettings(ctx, chatId);
        break;
      case "warning":
        await showWarningSettings(ctx, chatId);
        break;
      case "flood":
        await showFloodSettings(ctx, chatId);
        break;
      case "mandatory_join":
        await showMandatoryJoinSettings(ctx, chatId);
        break;
      case "anti_betrayal":
        await showAntiBetrayalSettings(ctx, chatId);
        break;
      case "mandatory_add":
        await showMandatoryAddSettings(ctx, chatId);
        break;
      case "strict_mode":
        await showStrictLockSettings(ctx, chatId);
        break;
      case "lock_limit":
      case "auto_lock":
      case "permissions":
      case "cleanup":
      case "timezone":
      case "reports":
        // These have placeholder implementations - will show their existing handlers
        await ctx.reply(`⚙️ <b>${feature.title}</b>\n\nThis feature configuration is available. Check the existing handlers.`, { parse_mode: "HTML" });
        break;
      default:
        await ctx.reply(`⚙️ <b>${feature.title}</b>\n\nThis feature configuration is coming soon!`, { parse_mode: "HTML" });
    }
    return;
  } else {
    // Simple toggle features - handle here
    // Premium-only features - block activation for free groups
    const premiumOnlyFeatures = ["mandatory_join", "mandatory_add"];
    if (premiumOnlyFeatures.includes(featureId) && !isGroupPremium(chatId)) {
      await ctx.answerCbQuery(
        "⭐ This is a Premium feature. Upgrade to enable it!",
        { show_alert: true }
      );
      return;
    }

    try {
      if (feature.settingsKey) {
        const settings = await loadGeneralSettingsByChatId(chatId);
        const rawSettings = settings as Record<string, unknown>;
        const currentValue = rawSettings[feature.settingsKey] === true;
        rawSettings[feature.settingsKey] = !currentValue;
        await saveGeneralSettingsByChatId(chatId, settings);

        await ctx.answerCbQuery(`${feature.title} ${!currentValue ? "enabled" : "disabled"}!`);
      } else if (feature.banSettingsKey) {
        const settings = await loadBanSettingsByChatId(chatId);
        const rawSettings = settings as unknown as Record<string, unknown>;
        if (!rawSettings.rules) {
          rawSettings.rules = {};
        }
        const rules = rawSettings.rules as Record<string, unknown>;
        const currentValue = rules[feature.banSettingsKey] === true;
        rules[feature.banSettingsKey] = !currentValue;
        await saveBanSettingsByChatId(chatId, settings);

        await ctx.answerCbQuery(`${feature.title} ${!currentValue ? "enabled" : "disabled"}!`);
      } else if (feature.banSettingsRootKey) {
        // Save at root level of banSettings (not in rules)
        const settings = await loadBanSettingsByChatId(chatId);
        const rawSettings = settings as unknown as Record<string, unknown>;
        const currentValue = rawSettings[feature.banSettingsRootKey] === true;
        rawSettings[feature.banSettingsRootKey] = !currentValue;
        await saveBanSettingsByChatId(chatId, settings);

        await ctx.answerCbQuery(`${feature.title} ${!currentValue ? "enabled" : "disabled"}!`);
      }
    } catch (error) {
      logger.error("Failed to toggle advanced feature", { chatId, featureId, error });
      await ctx.answerCbQuery("Failed to save settings.");
    }

    // Refresh the advanced menu
    await showInlineAdvanced(ctx, chatId);
  }
});

// ========== TEMP MEDIA SUB-MENU ==========
// Handler is now managed by the general router above

async function showTempMediaSettings(ctx: Context, chatId: string): Promise<void> {
  let banSettings;
  try {
    banSettings = await loadBanSettingsByChatId(chatId);
  } catch {
    banSettings = null;
  }

  const rawBan = banSettings as unknown as Record<string, unknown> | null;
  const tempMediaEnabled = rawBan?.tempMediaEnabled === true;
  const tempMediaSettings = (rawBan?.tempMedia as Record<string, unknown>) ?? {};

  const deleteMinutes = (tempMediaSettings.deleteMinutes as number) ?? 20;
  // userType: "all" = all members, "nonadmin" = non-admins only (default)
  const userType = (tempMediaSettings.userType as string) ?? "nonadmin";
  const mediaTypes = {
    gif: tempMediaSettings.gif !== false,
    sticker: tempMediaSettings.sticker !== false,
    video: tempMediaSettings.video !== false,
    photo: tempMediaSettings.photo !== false,
    file: tempMediaSettings.file === true,
    audio: tempMediaSettings.audio === true,
  };

  if (!tempMediaEnabled) {
    // Show enable prompt with nice description
    const message = `⏰ <b>Temporary Media</b>

• By enabling this feature
• Media will be auto-deleted after a set time
• This helps prevent group filtering issues

<b>Status:</b> ❌ Disabled

<i>Enable this feature to configure media types and delete time.</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("Temp Media ❌", `fw_adv_tm_master:${chatId}:on`)],
      [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
    ]);

    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }

  // Show full settings when enabled
  const userTypeLabel = userType === "all" ? "All Members" : "Non-Admins";
  const message = `⏰ <b>Temporary Media</b>

• By enabling this feature
• Media will be auto-deleted after a set time
• This helps prevent group filtering issues`;

  const rows: any[] = [];

  // Master toggle
  rows.push([Markup.button.callback(`Temp Media ✅`, `fw_adv_tm_master:${chatId}:off`)]);

  // Media type toggles (2 per row)
  rows.push([
    Markup.button.callback(`GIF ${mediaTypes.gif ? "✅" : "❌"}`, `fw_adv_tm_type:${chatId}:gif`),
    Markup.button.callback(`Sticker ${mediaTypes.sticker ? "✅" : "❌"}`, `fw_adv_tm_type:${chatId}:sticker`),
  ]);
  rows.push([
    Markup.button.callback(`Video ${mediaTypes.video ? "✅" : "❌"}`, `fw_adv_tm_type:${chatId}:video`),
    Markup.button.callback(`Photo ${mediaTypes.photo ? "✅" : "❌"}`, `fw_adv_tm_type:${chatId}:photo`),
  ]);
  rows.push([
    Markup.button.callback(`File ${mediaTypes.file ? "✅" : "❌"}`, `fw_adv_tm_type:${chatId}:file`),
    Markup.button.callback(`Audio ${mediaTypes.audio ? "✅" : "❌"}`, `fw_adv_tm_type:${chatId}:audio`),
  ]);

  // Time selector
  rows.push([Markup.button.callback(`Delete Time: ${deleteMinutes} min`, `fw_adv_tm_time_show:${chatId}`)]);
  rows.push([
    Markup.button.callback("《", `fw_adv_tm_time:${chatId}:downfast`),
    Markup.button.callback("〈", `fw_adv_tm_time:${chatId}:down`),
    Markup.button.callback("〉", `fw_adv_tm_time:${chatId}:up`),
    Markup.button.callback("》", `fw_adv_tm_time:${chatId}:upfast`),
  ]);

  // User type toggle
  rows.push([Markup.button.callback(`User Type: ${userTypeLabel}`, `fw_adv_tm_usertype:${chatId}`)]);

  // Back button
  rows.push([Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]);

  const keyboard = Markup.inlineKeyboard(rows);
  await replyOrEditRoot(ctx, message, keyboard);
}

// NOTE: fw_adv_tm_master handler is now registered BEFORE general router (line ~2678)

// Temp Media type toggle
bot.action(/^fw_adv_tm_type:(-?\d+):([a-z]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_tm_type:(-?\d+):([a-z]+)$/);
  const chatId = match?.[1];
  const mediaType = match?.[2];
  if (!chatId || !mediaType) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.tempMedia) {
      rawSettings.tempMedia = {};
    }
    const tempMedia = rawSettings.tempMedia as Record<string, unknown>;

    // Toggle the media type
    const currentValue = tempMedia[mediaType] === true || (tempMedia[mediaType] !== false && ["gif", "sticker", "video", "photo"].includes(mediaType));
    tempMedia[mediaType] = !currentValue;

    await saveBanSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to toggle temp media type", { chatId, mediaType, error });
  }

  await showTempMediaSettings(ctx, chatId);
});

// Temp Media time adjustment
bot.action(/^fw_adv_tm_time:(-?\d+):(up|down|upfast|downfast)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_tm_time:(-?\d+):(up|down|upfast|downfast)$/);
  const chatId = match?.[1];
  const direction = match?.[2];
  if (!chatId || !direction) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.tempMedia) {
      rawSettings.tempMedia = { deleteMinutes: 20 };
    }
    const tempMedia = rawSettings.tempMedia as Record<string, unknown>;
    let currentMinutes = (tempMedia.deleteMinutes as number) ?? 20;

    // Adjust time
    const adjustments: Record<string, number> = {
      up: 5,
      down: -5,
      upfast: 30,
      downfast: -30,
    };

    currentMinutes += adjustments[direction] ?? 0;
    currentMinutes = Math.max(1, Math.min(1440, currentMinutes)); // 1 min to 24 hours
    tempMedia.deleteMinutes = currentMinutes;

    await saveBanSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to adjust temp media time", { chatId, direction, error });
  }

  await showTempMediaSettings(ctx, chatId);
});

// NOTE: fw_adv_tm_usertype handler is now registered BEFORE general router (line ~2726)

// ========== VERIFICATION SUB-MENU ==========
bot.action(/^fw_adv_verification:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_verification:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showVerificationSettings(ctx, chatId);
});

async function showVerificationSettings(ctx: Context, chatId: string): Promise<void> {
  let generalSettings;
  try {
    generalSettings = await loadGeneralSettingsByChatId(chatId);
  } catch {
    generalSettings = null;
  }

  const rawGeneral = generalSettings as Record<string, unknown> | null;
  const verificationMode = (rawGeneral?.userVerificationMode as string) ?? "disabled";

  const isAllUsers = verificationMode === "all";
  const isIncoming = verificationMode === "incoming";

  const message = `✅ <b>User Verification</b>

With this feature you can:
• Verify all users currently in the group
• Verify new users before they can join

<b>Verification type (captcha)</b> is a simple question.
Bots usually cannot answer it accurately.

<b>Status:</b> ${verificationMode === "disabled" ? "❌ Disabled" : verificationMode === "all" ? "✅ All Users" : "✅ Incoming Users"}`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(
      `${isAllUsers ? "✅ " : ""}Verify All Group Members`,
      `fw_adv_verification_mode:${chatId}:all`
    )],
    [Markup.button.callback(
      `${isIncoming ? "✅ " : ""}Verify Incoming Users`,
      `fw_adv_verification_mode:${chatId}:incoming`
    )],
    [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
}

bot.action(/^fw_adv_verification_mode:(-?\d+):(all|incoming|disabled)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_verification_mode:(-?\d+):(all|incoming|disabled)$/);
  const chatId = match?.[1];
  const mode = match?.[2] as "all" | "incoming" | "disabled";
  if (!chatId || !mode) return;

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    const rawSettings = settings as Record<string, unknown>;

    // If clicking the same mode, toggle it off
    const currentMode = (rawSettings.userVerificationMode as string) ?? "disabled";
    if (currentMode === mode) {
      rawSettings.userVerificationMode = "disabled";
      rawSettings.userVerificationEnabled = false;
    } else {
      rawSettings.userVerificationMode = mode;
      rawSettings.userVerificationEnabled = true;
    }

    await saveGeneralSettingsByChatId(chatId, settings);

    // Show success message for incoming mode with gateway link
    if (rawSettings.userVerificationMode === "incoming") {
      const botInfo = await ctx.telegram.getMe();
      const gatewayLink = `https://t.me/${botInfo.username}?start=-${chatId}`;

      await ctx.answerCbQuery("Incoming users verification enabled!", { show_alert: true });

      // Show the gateway link info
      const infoMessage = `✅ <b>Incoming Users Verification Enabled</b>

• From now on, you can use the gateway link instead of your group's regular invite link.
• Place this gateway link in your public channels and groups.
• Using the gateway link instead of regular invite helps prevent bot accounts from joining.

<b>Gateway Link:</b>
<code>${gatewayLink}</code>

<i>Share this link to verify new members before they can join.</i>`;

      await ctx.editMessageText(infoMessage, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("◀️ Back to Verification", `fw_adv_verification:${chatId}`)]
        ]).reply_markup
      });
      return;
    }
  } catch (error) {
    logger.error("Failed to toggle verification mode", { chatId, error });
  }

  await showVerificationSettings(ctx, chatId);
});

// ========== ANTI-BETRAYAL SUB-MENU ==========
bot.action(/^fw_adv_anti_betrayal:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_anti_betrayal:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showAntiBetrayalSettings(ctx, chatId);
});

async function showAntiBetrayalSettings(ctx: Context, chatId: string): Promise<void> {
  let banSettings;
  try {
    banSettings = await loadBanSettingsByChatId(chatId);
  } catch {
    banSettings = null;
  }

  const rawBan = banSettings as unknown as Record<string, unknown> | null;
  const antiBetrayalEnabled = rawBan?.antiBetrayal === true;
  const antiBetrayalSettings = (rawBan?.antiBetrayalSettings as Record<string, unknown>) ?? {};

  // Default values
  const detectionMode = (antiBetrayalSettings.detectionMode as string) ?? "simple";
  const betrayalType = (antiBetrayalSettings.betrayalType as string) ?? "ban";
  const timeBase = (antiBetrayalSettings.timeBase as number) ?? 10;
  const allowedCount = (antiBetrayalSettings.allowedCount as number) ?? 8;

  if (!antiBetrayalEnabled) {
    // Show enable prompt with description
    const message = `🛡️ <b>Anti-Betrayal Lock</b>

• In this section, the owner can:
• Set the limit for banning members
★ Admins who ban more than the allowed number
~ will be <b>demoted</b> by the bot!

<b>Status:</b> ❌ Disabled

<i>Enable this feature to configure anti-betrayal settings.</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("Anti-Betrayal Lock ❌", `fw_adv_ab_master:${chatId}:on`)],
      [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
    ]);

    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }

  // Show full settings when enabled
  const detectionModeLabel = detectionMode === "simple" ? "Simple" : "Advanced";
  const betrayalTypeLabel = betrayalType === "ban" ? "Ban" : betrayalType === "mute" ? "Mute" : "Silence";

  const message = `🛡️ <b>Anti-Betrayal Lock</b>

• In this section, the owner can:
• Set the limit for banning members
★ Admins who ban more than the allowed number
~ will be <b>demoted</b> by the bot!

<b>Status:</b> ✅ Enabled`;

  const rows: any[] = [];

  // Master toggle
  rows.push([Markup.button.callback(`Anti-Betrayal Lock ✅`, `fw_adv_ab_master:${chatId}:off`)]);

  // Detection Mode
  rows.push([Markup.button.callback(`Detection Mode: ${detectionModeLabel}`, `fw_adv_ab_detection:${chatId}`)]);

  // Betrayal Type
  rows.push([Markup.button.callback(`Betrayal Type: ${betrayalTypeLabel}`, `fw_adv_ab_type:${chatId}`)]);

  // Time Base
  rows.push([Markup.button.callback(`Time Base: ${timeBase} min`, `fw_adv_ab_time_show:${chatId}`)]);
  rows.push([
    Markup.button.callback("《", `fw_adv_ab_time:${chatId}:downfast`),
    Markup.button.callback("〈", `fw_adv_ab_time:${chatId}:down`),
    Markup.button.callback("〉", `fw_adv_ab_time:${chatId}:up`),
    Markup.button.callback("》", `fw_adv_ab_time:${chatId}:upfast`),
  ]);

  // Allowed Count
  rows.push([Markup.button.callback(`Allowed Count: ${allowedCount}`, `fw_adv_ab_count_show:${chatId}`)]);
  rows.push([
    Markup.button.callback("《", `fw_adv_ab_count:${chatId}:downfast`),
    Markup.button.callback("〈", `fw_adv_ab_count:${chatId}:down`),
    Markup.button.callback("〉", `fw_adv_ab_count:${chatId}:up`),
    Markup.button.callback("》", `fw_adv_ab_count:${chatId}:upfast`),
  ]);

  // Back button
  rows.push([Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]);

  const keyboard = Markup.inlineKeyboard(rows);
  await replyOrEditRoot(ctx, message, keyboard);
}

// Anti-Betrayal master toggle
bot.action(/^fw_adv_ab_master:(-?\d+):(on|off)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_ab_master:(-?\d+):(on|off)$/);
  const chatId = match?.[1];
  const action = match?.[2];

  if (!chatId || !action) {
    await ctx.answerCbQuery("Error: missing parameters");
    return;
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    rawSettings.antiBetrayal = action === "on";

    // Initialize antiBetrayalSettings if enabling
    if (action === "on" && !rawSettings.antiBetrayalSettings) {
      rawSettings.antiBetrayalSettings = {
        detectionMode: "simple",
        betrayalType: "ban",
        timeBase: 10,
        allowedCount: 8,
      };
    }

    await saveBanSettingsByChatId(chatId, settings);

    if (action === "on") {
      await ctx.answerCbQuery("✅ Anti-Betrayal Lock enabled!", { show_alert: false });
    } else {
      await ctx.answerCbQuery("❌ Anti-Betrayal Lock disabled!", { show_alert: false });
    }
  } catch (error) {
    logger.error("Failed to toggle anti-betrayal", { chatId, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
    return;
  }

  await showAntiBetrayalSettings(ctx, chatId);
});

// Anti-Betrayal detection mode toggle
bot.action(/^fw_adv_ab_detection:(-?\d+)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_ab_detection:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.antiBetrayalSettings) {
      rawSettings.antiBetrayalSettings = { detectionMode: "simple" };
    }
    const abSettings = rawSettings.antiBetrayalSettings as Record<string, unknown>;

    // Toggle between "simple" and "advanced"
    const currentMode = (abSettings.detectionMode as string) ?? "simple";
    const newMode = currentMode === "simple" ? "advanced" : "simple";
    abSettings.detectionMode = newMode;

    await saveBanSettingsByChatId(chatId, settings);

    if (newMode === "advanced") {
      await ctx.answerCbQuery(
        "Set to Advanced Mode!\n\nIn this mode, bans are tracked with more detailed analysis",
        { show_alert: true }
      );
    } else {
      await ctx.answerCbQuery(
        "Set to Simple Mode!\n\nBasic ban counting within the time window",
        { show_alert: true }
      );
    }
  } catch (error) {
    logger.error("Failed to toggle anti-betrayal detection mode", { chatId, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
  }

  await showAntiBetrayalSettings(ctx, chatId);
});

// Anti-Betrayal type toggle
bot.action(/^fw_adv_ab_type:(-?\d+)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_ab_type:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.antiBetrayalSettings) {
      rawSettings.antiBetrayalSettings = { betrayalType: "ban" };
    }
    const abSettings = rawSettings.antiBetrayalSettings as Record<string, unknown>;

    // Cycle through types: ban -> mute -> silence -> ban
    const types = ["ban", "mute", "silence"];
    const currentType = (abSettings.betrayalType as string) ?? "ban";
    const currentIndex = types.indexOf(currentType);
    const nextIndex = (currentIndex + 1) % types.length;
    abSettings.betrayalType = types[nextIndex];

    await saveBanSettingsByChatId(chatId, settings);

    await ctx.answerCbQuery(
      `Betrayal Type set to: ${types[nextIndex].charAt(0).toUpperCase() + types[nextIndex].slice(1)}`,
      { show_alert: false }
    );
  } catch (error) {
    logger.error("Failed to toggle anti-betrayal type", { chatId, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
  }

  await showAntiBetrayalSettings(ctx, chatId);
});

// Anti-Betrayal time adjustment
bot.action(/^fw_adv_ab_time:(-?\d+):(up|down|upfast|downfast)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_ab_time:(-?\d+):(up|down|upfast|downfast)$/);
  const chatId = match?.[1];
  const direction = match?.[2];
  if (!chatId || !direction) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.antiBetrayalSettings) {
      rawSettings.antiBetrayalSettings = { timeBase: 10 };
    }
    const abSettings = rawSettings.antiBetrayalSettings as Record<string, unknown>;
    let currentMinutes = (abSettings.timeBase as number) ?? 10;

    // Adjust time
    const adjustments: Record<string, number> = {
      up: 5,
      down: -5,
      upfast: 30,
      downfast: -30,
    };

    currentMinutes += adjustments[direction] ?? 0;
    currentMinutes = Math.max(1, Math.min(1440, currentMinutes)); // 1 min to 24 hours
    abSettings.timeBase = currentMinutes;

    await saveBanSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to adjust anti-betrayal time", { chatId, direction, error });
  }

  await showAntiBetrayalSettings(ctx, chatId);
});

// Anti-Betrayal allowed count adjustment
bot.action(/^fw_adv_ab_count:(-?\d+):(up|down|upfast|downfast)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_ab_count:(-?\d+):(up|down|upfast|downfast)$/);
  const chatId = match?.[1];
  const direction = match?.[2];
  if (!chatId || !direction) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.antiBetrayalSettings) {
      rawSettings.antiBetrayalSettings = { allowedCount: 8 };
    }
    const abSettings = rawSettings.antiBetrayalSettings as Record<string, unknown>;
    let currentCount = (abSettings.allowedCount as number) ?? 8;

    // Adjust count
    const adjustments: Record<string, number> = {
      up: 1,
      down: -1,
      upfast: 5,
      downfast: -5,
    };

    currentCount += adjustments[direction] ?? 0;
    currentCount = Math.max(1, Math.min(100, currentCount)); // 1 to 100
    const oldCount = (abSettings.allowedCount as number) ?? 8;
    abSettings.allowedCount = currentCount;

    await saveBanSettingsByChatId(chatId, settings);

    // Show alert when count changes
    const change = currentCount - oldCount;
    if (change !== 0) {
      const changeText = change > 0 ? `increased by ${change}` : `decreased by ${Math.abs(change)}`;
      await ctx.answerCbQuery(
        `📊 Allowed ban count ${changeText}!\n\n📌 Group admins can ban up to ${currentCount} users within the ${(abSettings.timeBase as number) ?? 10} minute time window`,
        { show_alert: true }
      );
    } else {
      await ctx.answerCbQuery();
    }
  } catch (error) {
    logger.error("Failed to adjust anti-betrayal count", { chatId, direction, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
  }

  await showAntiBetrayalSettings(ctx, chatId);
});

// ========== MANDATORY ADD SUB-MENU ==========
bot.action(/^fw_adv_mandatory_add:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_mandatory_add:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showMandatoryAddSettings(ctx, chatId);
});

async function showMandatoryAddSettings(ctx: Context, chatId: string): Promise<void> {
  // Check premium status first
  if (!isGroupPremium(chatId)) {
    const message = `➕ <b>Mandatory Add Lock</b>

• By enabling this feature
★ The bot forces group users to add members
★ To have permission to chat in the group

⭐ <b>This is a Premium feature</b>

<i>Upgrade to Premium to enable this feature.</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("⭐ Upgrade to Premium", `fw_inline_menu:${chatId}`)],
      [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
    ]);

    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }

  let banSettings;
  try {
    banSettings = await loadBanSettingsByChatId(chatId);
  } catch {
    banSettings = null;
  }

  const rawBan = banSettings as unknown as Record<string, unknown> | null;
  const mandatoryAddEnabled = rawBan?.mandatoryAdd === true;
  const mandatoryAddSettings = (rawBan?.mandatoryAddSettings as Record<string, unknown>) ?? {};

  // Default values
  const requiredCount = (mandatoryAddSettings.requiredCount as number) ?? 3;
  const deleteTime = (mandatoryAddSettings.deleteTime as number) ?? 1;
  const addMode = (mandatoryAddSettings.addMode as string) ?? "all";
  const messageText = (mandatoryAddSettings.messageText as string) ?? "default";

  if (!mandatoryAddEnabled) {
    // Show enable prompt with description
    const message = `➕ <b>Mandatory Add Lock</b>

• By enabling this feature
★ The bot forces group users to add members
★ To have permission to chat in the group

<b>Status:</b> ❌ Disabled

<i>Enable this feature to configure mandatory add settings.</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("Mandatory Add Lock ❌", `fw_adv_ma_master:${chatId}:on`)],
      [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
    ]);

    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }

  // Show full settings when enabled
  const addModeLabel = addMode === "all" ? "All Messages" : addMode === "media" ? "Media Only" : "Text Only";
  const messageTextLabel = messageText === "default" ? "Default" : "Custom";

  const message = `➕ <b>Mandatory Add Lock</b>

• By enabling this feature
★ The bot forces group users to add members
★ To have permission to chat in the group

<b>Status:</b> ✅ Enabled`;

  const rows: any[] = [];

  // Master toggle
  rows.push([Markup.button.callback(`Mandatory Add Lock ✅`, `fw_adv_ma_master:${chatId}:off`)]);

  // Required Count section
  rows.push([Markup.button.callback(`Required Count`, `fw_adv_ma_count_show:${chatId}`)]);
  rows.push([
    Markup.button.callback("−", `fw_adv_ma_count:${chatId}:down`),
    Markup.button.callback(`Count: ${requiredCount}`, `fw_adv_ma_count_show:${chatId}`),
    Markup.button.callback("+", `fw_adv_ma_count:${chatId}:up`),
  ]);

  // Bot Message Delete Time section
  rows.push([Markup.button.callback(`Bot Message Delete Time`, `fw_adv_ma_time_show:${chatId}`)]);
  rows.push([
    Markup.button.callback("−", `fw_adv_ma_time:${chatId}:down`),
    Markup.button.callback(`${deleteTime} min`, `fw_adv_ma_time_show:${chatId}`),
    Markup.button.callback("+", `fw_adv_ma_time:${chatId}:up`),
  ]);

  // Add Mode
  rows.push([Markup.button.callback(`Mandatory Add Mode: ${addModeLabel}`, `fw_adv_ma_mode:${chatId}`)]);

  // Message Text
  rows.push([Markup.button.callback(`• Mandatory Add Message: ${messageTextLabel}`, `fw_adv_ma_text:${chatId}`)]);

  // Back button
  rows.push([Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]);

  const keyboard = Markup.inlineKeyboard(rows);
  await replyOrEditRoot(ctx, message, keyboard);
}

// Mandatory Add master toggle
bot.action(/^fw_adv_ma_master:(-?\d+):(on|off)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_ma_master:(-?\d+):(on|off)$/);
  const chatId = match?.[1];
  const action = match?.[2];

  if (!chatId || !action) {
    await ctx.answerCbQuery("Error: missing parameters");
    return;
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    rawSettings.mandatoryAdd = action === "on";

    // Initialize mandatoryAddSettings if enabling
    if (action === "on" && !rawSettings.mandatoryAddSettings) {
      rawSettings.mandatoryAddSettings = {
        requiredCount: 3,
        deleteTime: 1,
        addMode: "all",
        messageText: "default",
      };
    }

    await saveBanSettingsByChatId(chatId, settings);

    if (action === "on") {
      await ctx.answerCbQuery("✅ Mandatory Add Lock enabled!", { show_alert: false });
    } else {
      await ctx.answerCbQuery("❌ Mandatory Add Lock disabled!", { show_alert: false });
    }
  } catch (error) {
    logger.error("Failed to toggle mandatory add", { chatId, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
    return;
  }

  await showMandatoryAddSettings(ctx, chatId);
});

// Mandatory Add required count adjustment
bot.action(/^fw_adv_ma_count:(-?\d+):(up|down)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_ma_count:(-?\d+):(up|down)$/);
  const chatId = match?.[1];
  const direction = match?.[2];
  if (!chatId || !direction) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.mandatoryAddSettings) {
      rawSettings.mandatoryAddSettings = { requiredCount: 3 };
    }
    const maSettings = rawSettings.mandatoryAddSettings as Record<string, unknown>;
    let currentCount = (maSettings.requiredCount as number) ?? 3;

    // Adjust count
    currentCount += direction === "up" ? 1 : -1;
    currentCount = Math.max(1, Math.min(20, currentCount)); // 1 to 20
    maSettings.requiredCount = currentCount;

    await saveBanSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to adjust mandatory add count", { chatId, direction, error });
  }

  await showMandatoryAddSettings(ctx, chatId);
});

// Mandatory Add delete time adjustment
bot.action(/^fw_adv_ma_time:(-?\d+):(up|down)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_ma_time:(-?\d+):(up|down)$/);
  const chatId = match?.[1];
  const direction = match?.[2];
  if (!chatId || !direction) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.mandatoryAddSettings) {
      rawSettings.mandatoryAddSettings = { deleteTime: 1 };
    }
    const maSettings = rawSettings.mandatoryAddSettings as Record<string, unknown>;
    let currentTime = (maSettings.deleteTime as number) ?? 1;

    // Adjust time
    currentTime += direction === "up" ? 1 : -1;
    currentTime = Math.max(1, Math.min(60, currentTime)); // 1 to 60 minutes
    maSettings.deleteTime = currentTime;

    await saveBanSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to adjust mandatory add delete time", { chatId, direction, error });
  }

  await showMandatoryAddSettings(ctx, chatId);
});

// Mandatory Add mode toggle
bot.action(/^fw_adv_ma_mode:(-?\d+)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_ma_mode:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.mandatoryAddSettings) {
      rawSettings.mandatoryAddSettings = { addMode: "all" };
    }
    const maSettings = rawSettings.mandatoryAddSettings as Record<string, unknown>;

    // Cycle through modes: all -> media -> text -> all
    const modes = ["all", "media", "text"];
    const currentMode = (maSettings.addMode as string) ?? "all";
    const currentIndex = modes.indexOf(currentMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    maSettings.addMode = modes[nextIndex];

    await saveBanSettingsByChatId(chatId, settings);

    const modeLabels: Record<string, string> = {
      all: "All Messages",
      media: "Media Only",
      text: "Text Only",
    };
    await ctx.answerCbQuery(
      `Mandatory Add Mode set to: ${modeLabels[modes[nextIndex]]}`,
      { show_alert: false }
    );
  } catch (error) {
    logger.error("Failed to toggle mandatory add mode", { chatId, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
  }

  await showMandatoryAddSettings(ctx, chatId);
});

// Mandatory Add message text toggle
bot.action(/^fw_adv_ma_text:(-?\d+)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_ma_text:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.mandatoryAddSettings) {
      rawSettings.mandatoryAddSettings = { messageText: "default" };
    }
    const maSettings = rawSettings.mandatoryAddSettings as Record<string, unknown>;

    // Toggle between default and custom (for now just toggle)
    const currentText = (maSettings.messageText as string) ?? "default";
    const newText = currentText === "default" ? "custom" : "default";
    maSettings.messageText = newText;

    await saveBanSettingsByChatId(chatId, settings);

    if (newText === "custom") {
      await ctx.answerCbQuery(
        "Custom message mode enabled!\n\nUse /setmandatorymsg command to set your custom message.",
        { show_alert: true }
      );
    } else {
      await ctx.answerCbQuery(
        "Default message restored!",
        { show_alert: false }
      );
    }
  } catch (error) {
    logger.error("Failed to toggle mandatory add message text", { chatId, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
  }

  await showMandatoryAddSettings(ctx, chatId);
});

// ========== STRICT LOCK (REPEATED MESSAGE) SUB-MENU ==========
bot.action(/^fw_adv_strict_mode:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_strict_mode:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showStrictLockSettings(ctx, chatId);
});

async function showStrictLockSettings(ctx: Context, chatId: string): Promise<void> {
  let banSettings;
  try {
    banSettings = await loadBanSettingsByChatId(chatId);
  } catch {
    banSettings = null;
  }

  const rawBan = banSettings as unknown as Record<string, unknown> | null;
  const strictLockEnabled = rawBan?.strictLock === true;
  const strictLockSettings = (rawBan?.strictLockSettings as Record<string, unknown>) ?? {};

  // Default values
  const punishmentMode = (strictLockSettings.punishmentMode as string) ?? "mute";
  const messageCount = (strictLockSettings.messageCount as number) ?? 7;

  if (!strictLockEnabled) {
    // Show enable prompt with description
    const message = `🔒 <b>Strict Lock (Repeated Messages)</b>

• By enabling this feature
★ You can set the repeated message limit
★ Users who send more than the allowed limit
★ Will be punished as configured
★ Time unit for repeated messages is 3 seconds

<b>Status:</b> ❌ Disabled

<i>Enable this feature to configure settings.</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("Repeated Message Lock ❌", `fw_adv_sl_master:${chatId}:on`)],
      [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
    ]);

    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }

  // Show full settings when enabled
  const message = `🔒 <b>Strict Lock (Repeated Messages)</b>

• By enabling this feature
★ You can set the repeated message limit
★ Users who send more than the allowed limit
★ Will be punished as configured
★ Time unit for repeated messages is 3 seconds

<b>Status:</b> ✅ Enabled`;

  const rows: any[] = [];

  // Master toggle
  rows.push([Markup.button.callback(`Repeated Message Lock ✅`, `fw_adv_sl_master:${chatId}:off`)]);

  // Punishment mode options (radio buttons style)
  const modes = [
    { id: "ban", label: "Ban" },
    { id: "mute", label: "Mute" },
    { id: "warn", label: "Warn" },
    { id: "tempmute", label: "Temp Mute" },
  ];

  for (const mode of modes) {
    const isSelected = punishmentMode === mode.id;
    const icon = isSelected ? "✅" : "❌";
    rows.push([Markup.button.callback(`• Repeated Message Mode: ${mode.label} ${icon}`, `fw_adv_sl_mode:${chatId}:${mode.id}`)]);
  }

  // Message count
  rows.push([Markup.button.callback(`• Repeated Message Count: ${messageCount}`, `fw_adv_sl_count_show:${chatId}`)]);
  rows.push([
    Markup.button.callback("−", `fw_adv_sl_count:${chatId}:down`),
    Markup.button.callback("+", `fw_adv_sl_count:${chatId}:up`),
  ]);

  // Back button
  rows.push([Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]);

  const keyboard = Markup.inlineKeyboard(rows);
  await replyOrEditRoot(ctx, message, keyboard);
}

// Strict Lock master toggle
bot.action(/^fw_adv_sl_master:(-?\d+):(on|off)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_sl_master:(-?\d+):(on|off)$/);
  const chatId = match?.[1];
  const action = match?.[2];

  if (!chatId || !action) {
    await ctx.answerCbQuery("Error: missing parameters");
    return;
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    rawSettings.strictLock = action === "on";

    // Initialize strictLockSettings if enabling
    if (action === "on" && !rawSettings.strictLockSettings) {
      rawSettings.strictLockSettings = {
        punishmentMode: "mute",
        messageCount: 7,
      };
    }

    await saveBanSettingsByChatId(chatId, settings);

    if (action === "on") {
      await ctx.answerCbQuery("✅ Repeated Message Lock enabled!", { show_alert: false });
    } else {
      await ctx.answerCbQuery("❌ Repeated Message Lock disabled!", { show_alert: false });
    }
  } catch (error) {
    logger.error("Failed to toggle strict lock", { chatId, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
    return;
  }

  await showStrictLockSettings(ctx, chatId);
});

// Strict Lock punishment mode toggle
bot.action(/^fw_adv_sl_mode:(-?\d+):(ban|mute|warn|tempmute)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_sl_mode:(-?\d+):(ban|mute|warn|tempmute)$/);
  const chatId = match?.[1];
  const mode = match?.[2];
  if (!chatId || !mode) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.strictLockSettings) {
      rawSettings.strictLockSettings = { punishmentMode: "mute" };
    }
    const slSettings = rawSettings.strictLockSettings as Record<string, unknown>;
    slSettings.punishmentMode = mode;

    await saveBanSettingsByChatId(chatId, settings);

    const modeLabels: Record<string, string> = {
      ban: "Ban",
      mute: "Mute",
      warn: "Warn",
      tempmute: "Temp Mute",
    };
    await ctx.answerCbQuery(
      `Punishment mode set to: ${modeLabels[mode]}`,
      { show_alert: false }
    );
  } catch (error) {
    logger.error("Failed to set strict lock mode", { chatId, mode, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
  }

  await showStrictLockSettings(ctx, chatId);
});

// Strict Lock message count adjustment
bot.action(/^fw_adv_sl_count:(-?\d+):(up|down)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_sl_count:(-?\d+):(up|down)$/);
  const chatId = match?.[1];
  const direction = match?.[2];
  if (!chatId || !direction) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.strictLockSettings) {
      rawSettings.strictLockSettings = { messageCount: 7 };
    }
    const slSettings = rawSettings.strictLockSettings as Record<string, unknown>;
    let currentCount = (slSettings.messageCount as number) ?? 7;

    // Adjust count
    currentCount += direction === "up" ? 1 : -1;
    currentCount = Math.max(2, Math.min(20, currentCount)); // 2 to 20
    slSettings.messageCount = currentCount;

    await saveBanSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to adjust strict lock count", { chatId, direction, error });
  }

  await showStrictLockSettings(ctx, chatId);
});

// ========== MANDATORY JOIN SUB-MENU ==========
bot.action(/^fw_adv_mandatory_join:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_mandatory_join:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showMandatoryJoinSettings(ctx, chatId);
});

async function showMandatoryJoinSettings(ctx: Context, chatId: string): Promise<void> {
  // Check premium status first
  const isPremium = isGroupPremium(chatId);

  if (!isPremium) {
    // Show premium upsell message
    const message = `📋 <b>Mandatory Membership</b>

• With this feature enabled:
• You can register a group or channel in the bot
• The bot forces users to join it
• Before they can chat in the group

⭐ <b>Premium Feature</b>
This is one of the premium features.
To use it, you need to get Premium for this group.

<i>Upgrade to Premium to unlock this feature.</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("⭐ Get Premium", `fw_premium:${chatId}`)],
      [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
    ]);

    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }

  // Premium group - load settings
  let banSettings;
  try {
    banSettings = await loadBanSettingsByChatId(chatId);
  } catch {
    banSettings = null;
  }

  const rawBan = banSettings as unknown as Record<string, unknown> | null;
  const mandatoryJoinEnabled = rawBan?.mandatoryJoinEnabled === true;
  const mandatorySettings = (rawBan?.mandatoryJoinSettings as Record<string, unknown>) ?? {};

  // Default values
  const targetChannel = (mandatorySettings.targetChannel as string) ?? "";
  const deleteTime = (mandatorySettings.deleteTime as number) ?? 45;
  const customMessage = (mandatorySettings.customMessage as string) ?? "";

  if (!mandatoryJoinEnabled) {
    // Show enable prompt with description
    const message = `📋 <b>Mandatory Membership</b>

• With this feature enabled:
• You can register a group or channel in the bot
• The bot forces users to join it
• Before they can chat in the group

<b>Status:</b> ❌ Disabled

<i>Enable this feature to configure mandatory membership settings.</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("Mandatory Membership ❌", `fw_adv_mj_master:${chatId}:on`)],
      [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
    ]);

    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }

  // Show full settings when enabled
  const targetLabel = targetChannel ? targetChannel : "Not set";
  const messageLabel = customMessage ? "Custom" : "Default";

  const message = `📋 <b>Mandatory Membership</b>

• With this feature enabled:
• You can register a group or channel in the bot
• The bot forces users to join it
• Before they can chat in the group

<b>Status:</b> ✅ Enabled`;

  const rows: any[] = [];

  // Master toggle
  rows.push([Markup.button.callback(`Mandatory Membership ✅`, `fw_adv_mj_master:${chatId}:off`)]);

  // Target channel
  rows.push([Markup.button.callback(`• Target: ${targetLabel}`, `fw_adv_mj_target_show:${chatId}`)]);

  // Navigation for target
  rows.push([
    Markup.button.callback("《", `fw_adv_mj_target:${chatId}:first`),
    Markup.button.callback("〈", `fw_adv_mj_target:${chatId}:prev`),
    Markup.button.callback("〉", `fw_adv_mj_target:${chatId}:next`),
    Markup.button.callback("》", `fw_adv_mj_target:${chatId}:last`),
  ]);

  // Delete time
  rows.push([Markup.button.callback(`• Bot Message Delete Time: ${deleteTime} sec`, `fw_adv_mj_time_show:${chatId}`)]);
  rows.push([
    Markup.button.callback("《", `fw_adv_mj_time:${chatId}:downfast`),
    Markup.button.callback("〈", `fw_adv_mj_time:${chatId}:down`),
    Markup.button.callback("〉", `fw_adv_mj_time:${chatId}:up`),
    Markup.button.callback("》", `fw_adv_mj_time:${chatId}:upfast`),
  ]);

  // Custom message
  rows.push([Markup.button.callback(`• Membership Message Text: ${messageLabel}`, `fw_adv_mj_message:${chatId}`)]);

  // Back button
  rows.push([Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]);

  const keyboard = Markup.inlineKeyboard(rows);
  await replyOrEditRoot(ctx, message, keyboard);
}

// Mandatory Join master toggle
bot.action(/^fw_adv_mj_master:(-?\d+):(on|off)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_mj_master:(-?\d+):(on|off)$/);
  const chatId = match?.[1];
  const action = match?.[2];

  if (!chatId || !action) {
    await ctx.answerCbQuery("Error: missing parameters");
    return;
  }

  // Check premium
  if (!isGroupPremium(chatId)) {
    await ctx.answerCbQuery("⭐ This is a Premium feature. Upgrade to enable it!", { show_alert: true });
    return;
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    rawSettings.mandatoryJoinEnabled = action === "on";

    // Initialize mandatoryJoinSettings if enabling
    if (action === "on" && !rawSettings.mandatoryJoinSettings) {
      rawSettings.mandatoryJoinSettings = {
        targetChannel: "",
        deleteTime: 45,
        customMessage: "",
      };
    }

    await saveBanSettingsByChatId(chatId, settings);

    if (action === "on") {
      await ctx.answerCbQuery("✅ Mandatory Membership enabled!", { show_alert: false });
    } else {
      await ctx.answerCbQuery("❌ Mandatory Membership disabled!", { show_alert: false });
    }
  } catch (error) {
    logger.error("Failed to toggle mandatory join", { chatId, error });
    await ctx.answerCbQuery("Failed to save settings", { show_alert: true });
    return;
  }

  await showMandatoryJoinSettings(ctx, chatId);
});

// Mandatory Join delete time adjustment
bot.action(/^fw_adv_mj_time:(-?\d+):(up|down|upfast|downfast)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_mj_time:(-?\d+):(up|down|upfast|downfast)$/);
  const chatId = match?.[1];
  const direction = match?.[2];
  if (!chatId || !direction) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!rawSettings.mandatoryJoinSettings) {
      rawSettings.mandatoryJoinSettings = { deleteTime: 45 };
    }
    const mjSettings = rawSettings.mandatoryJoinSettings as Record<string, unknown>;
    let currentSeconds = (mjSettings.deleteTime as number) ?? 45;

    // Adjust time
    const adjustments: Record<string, number> = {
      up: 5,
      down: -5,
      upfast: 30,
      downfast: -30,
    };

    currentSeconds += adjustments[direction] ?? 0;
    currentSeconds = Math.max(5, Math.min(300, currentSeconds)); // 5 sec to 5 minutes
    mjSettings.deleteTime = currentSeconds;

    await saveBanSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to adjust mandatory join time", { chatId, direction, error });
  }

  await showMandatoryJoinSettings(ctx, chatId);
});

// Mandatory Join target navigation (placeholder - shows alert since target selection needs more complex UI)
bot.action(/^fw_adv_mj_target:(-?\d+):(first|prev|next|last)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_mj_target:(-?\d+):(first|prev|next|last)$/);
  const chatId = match?.[1];
  const direction = match?.[2];
  if (!chatId || !direction) return;

  // For now, show an alert explaining how to set the target channel
  await ctx.answerCbQuery(
    "ℹ️ To set the target channel:\n1. Add the bot to your channel as admin\n2. Forward a message from that channel here\n\nThe bot will automatically detect the channel.",
    { show_alert: true }
  );
});

// Mandatory Join message configuration
bot.action(/^fw_adv_mj_message:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_mj_message:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  const message = `📝 <b>Configure Membership Message</b>

You can use the following placeholders:
• <code>{user}</code> - User's name
• <code>{group}</code> - Group name
• <code>{channel}</code> - Target channel name

<b>Example:</b>
<code>Hello {user}!
To chat in {group}, you must first join our channel.
Click below to join!</code>

Reply to this message with your custom message text.
Or send <code>default</code> to reset to the default message.`;

  // Set session state to wait for message input
  const userId = ctx.from?.id?.toString();
  if (userId) {
    mandatoryJoinMessageSessions.set(userId, { chatId, createdAt: Date.now() });
  }

  await ctx.reply(message, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback("❌ Cancel", `fw_adv_mandatory_join:${chatId}`)]
    ]).reply_markup
  });
});

// Store for mandatory join message config sessions
const mandatoryJoinMessageSessions = new Map<string, { chatId: string; createdAt: number }>();

// Clean up old sessions periodically (5 minute timeout)
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of mandatoryJoinMessageSessions.entries()) {
    if (now - session.createdAt > 5 * 60 * 1000) {
      mandatoryJoinMessageSessions.delete(userId);
    }
  }
}, 60000);

// ========== WELCOME SUB-MENU ==========
bot.action(/^fw_adv_welcome:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_welcome:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showWelcomeSettings(ctx, chatId);
});

async function showWelcomeSettings(ctx: Context, chatId: string): Promise<void> {
  let generalSettings;
  try {
    generalSettings = await loadGeneralSettingsByChatId(chatId);
  } catch {
    generalSettings = null;
  }

  const rawGeneral = generalSettings as Record<string, unknown> | null;
  const welcomeEnabled = rawGeneral?.welcomeEnabled === true;
  const welcomeSettings = (rawGeneral?.welcomeSettings as Record<string, unknown>) ?? {};
  const autoDeleteEnabled = (welcomeSettings.autoDeleteEnabled as boolean) ?? false;
  const customMessage = (welcomeSettings.customMessage as string) ?? "";

  if (!welcomeEnabled) {
    // Disabled state
    const message = `👋 <b>Welcome Message</b>

• In this section you can customize
• welcome messages to your liking!

<b>Status:</b> ❌ Disabled`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("• Welcome: ❌", `fw_adv_welcome_toggle:${chatId}:on`)],
      [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
    ]);

    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }

  // Enabled state - show current welcome message preview and settings
  // Get group info for preview
  let groupTitle = "Group Name";
  try {
    const chat = await ctx.telegram.getChat(parseInt(chatId, 10));
    if ("title" in chat) {
      groupTitle = chat.title;
    }
  } catch {
    // Use default
  }

  const userName = ctx.from?.first_name ?? "User";
  const currentDate = new Date();
  const timeStr = currentDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dateStr = currentDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  // Default welcome message template
  const defaultMessage = `Hello {user}
Welcome to {group} 🌿
Time: ${timeStr} (${dateStr})`;

  const previewMessage = customMessage || defaultMessage;
  const displayedPreview = previewMessage
    .replace("{user}", userName)
    .replace("{group}", groupTitle);

  const autoDeleteLabel = autoDeleteEnabled ? "Enabled" : "Disabled";

  const message = `<b>Current Welcome Message Text ↓</b>

${displayedPreview}`;

  const rows: any[] = [];

  // Master toggle
  rows.push([Markup.button.callback("• Welcome: ✅", `fw_adv_welcome_toggle:${chatId}:off`)]);

  // Configure message
  rows.push([Markup.button.callback("• Configure Welcome Message", `fw_adv_welcome_config:${chatId}`)]);

  // View/Preview message
  rows.push([Markup.button.callback("View Welcome Message", `fw_adv_welcome_preview:${chatId}`)]);

  // Auto-delete toggle
  rows.push([Markup.button.callback(`• Auto-Delete Welcome Message: ${autoDeleteLabel}`, `fw_adv_welcome_autodelete:${chatId}`)]);

  // Back button
  rows.push([Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]);

  const keyboard = Markup.inlineKeyboard(rows);
  await replyOrEditRoot(ctx, message, keyboard);
}

bot.action(/^fw_adv_welcome_toggle:(-?\d+):(on|off)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_welcome_toggle:(-?\d+):(on|off)$/);
  const chatId = match?.[1];
  const action = match?.[2];
  if (!chatId || !action) return;

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    const rawSettings = settings as Record<string, unknown>;
    rawSettings.welcomeEnabled = action === "on";

    // Initialize welcomeSettings if enabling
    if (action === "on" && !rawSettings.welcomeSettings) {
      rawSettings.welcomeSettings = {
        customMessage: "",
        autoDeleteEnabled: false,
        autoDeleteDelay: 60,
      };
    }

    await saveGeneralSettingsByChatId(chatId, settings);

    if (action === "on") {
      await ctx.answerCbQuery("✅ Welcome Message enabled!", { show_alert: false });
    } else {
      await ctx.answerCbQuery("❌ Welcome Message disabled!", { show_alert: false });
    }
  } catch (error) {
    logger.error("Failed to toggle welcome", { chatId, error });
  }

  await showWelcomeSettings(ctx, chatId);
});

// Welcome auto-delete toggle
bot.action(/^fw_adv_welcome_autodelete:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_welcome_autodelete:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    const rawSettings = settings as Record<string, unknown>;

    if (!rawSettings.welcomeSettings) {
      rawSettings.welcomeSettings = { autoDeleteEnabled: false };
    }
    const welcomeSettings = rawSettings.welcomeSettings as Record<string, unknown>;
    const currentValue = welcomeSettings.autoDeleteEnabled === true;
    welcomeSettings.autoDeleteEnabled = !currentValue;

    await saveGeneralSettingsByChatId(chatId, settings);

    if (!currentValue) {
      await ctx.answerCbQuery("✅ Auto-Delete enabled! Welcome messages will be deleted after 60 seconds.", { show_alert: true });
    } else {
      await ctx.answerCbQuery("❌ Auto-Delete disabled!", { show_alert: false });
    }
  } catch (error) {
    logger.error("Failed to toggle welcome auto-delete", { chatId, error });
  }

  await showWelcomeSettings(ctx, chatId);
});

// Welcome preview handler
bot.action(/^fw_adv_welcome_preview:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_welcome_preview:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  try {
    let generalSettings;
    try {
      generalSettings = await loadGeneralSettingsByChatId(chatId);
    } catch {
      generalSettings = null;
    }

    const rawGeneral = generalSettings as Record<string, unknown> | null;
    const welcomeSettings = (rawGeneral?.welcomeSettings as Record<string, unknown>) ?? {};
    const customMessage = (welcomeSettings.customMessage as string) ?? "";

    // Get group info
    let groupTitle = "Group Name";
    try {
      const chat = await ctx.telegram.getChat(parseInt(chatId, 10));
      if ("title" in chat) {
        groupTitle = chat.title;
      }
    } catch {
      // Use default
    }

    const userName = ctx.from?.first_name ?? "User";
    const currentDate = new Date();
    const timeStr = currentDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const dateStr = currentDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

    const defaultMessage = `Hello {user}
Welcome to {group} 🌿
Time: ${timeStr} (${dateStr})`;

    const previewMessage = customMessage || defaultMessage;
    const displayedPreview = previewMessage
      .replace("{user}", userName)
      .replace("{group}", groupTitle);

    // Send as a separate message (preview)
    await ctx.reply(displayedPreview, { parse_mode: "HTML" });
  } catch (error) {
    logger.error("Failed to preview welcome message", { chatId, error });
    await ctx.reply("Failed to generate preview.");
  }
});

// Welcome configure message handler
bot.action(/^fw_adv_welcome_config:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_welcome_config:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  const message = `📝 <b>Configure Welcome Message</b>

You can use the following placeholders in your message:
• <code>{user}</code> - User's name
• <code>{group}</code> - Group name

<b>Example:</b>
<code>Hello {user}!
Welcome to {group} 🎉
We're happy to have you here!</code>

Reply to this message with your custom welcome text.
Or send <code>default</code> to reset to the default message.`;

  // Set session state to wait for welcome message input
  const userId = ctx.from?.id?.toString();
  if (userId) {
    welcomeConfigSessions.set(userId, { chatId, createdAt: Date.now() });
  }

  await ctx.reply(message, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback("❌ Cancel", `fw_adv_welcome:${chatId}`)]
    ]).reply_markup
  });
});

// Store for welcome config sessions
const welcomeConfigSessions = new Map<string, { chatId: string; createdAt: number }>();

// Clean up old sessions periodically (5 minute timeout)
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of welcomeConfigSessions.entries()) {
    if (now - session.createdAt > 5 * 60 * 1000) {
      welcomeConfigSessions.delete(userId);
    }
  }
}, 60000);

// ========== WARNING SUB-MENU ==========
bot.action(/^fw_adv_warning:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_warning:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showWarningSettings(ctx, chatId);
});

async function showWarningSettings(ctx: Context, chatId: string): Promise<void> {
  let generalSettings;
  try {
    generalSettings = await loadGeneralSettingsByChatId(chatId);
  } catch {
    generalSettings = null;
  }

  const rawGeneral = generalSettings as Record<string, unknown> | null;
  const warningEnabled = rawGeneral?.warningEnabled === true;
  const autoWarning = rawGeneral?.autoWarning as Record<string, unknown> | null;
  const threshold = (autoWarning?.threshold as number) ?? 3;
  const penalty = (autoWarning?.penalty as string) ?? "mute";

  if (!warningEnabled) {
    const message = `⚠️ <b>Warning System</b>

• Track user violations with warnings
• Auto-punish after reaching threshold

<b>Status:</b> ❌ Disabled

<i>Enable this feature to configure warning settings.</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Enable Warnings", `fw_adv_warning_toggle:${chatId}:on`)],
      [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
    ]);

    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }

  const message = `⚠️ <b>Warning System</b>

• Threshold: <b>${threshold} warnings</b>
• Penalty: <b>${penalty}</b>

<b>Status:</b> ✅ Enabled`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⚠️ Warnings ✅", `fw_adv_warning_toggle:${chatId}:off`)],
    [
      Markup.button.callback("◁", `fw_adv_warning_thresh:${chatId}:down`),
      Markup.button.callback(`Threshold: ${threshold}`, `fw_adv_warning_thresh:${chatId}:show`),
      Markup.button.callback("▷", `fw_adv_warning_thresh:${chatId}:up`),
    ],
    [
      Markup.button.callback(`Penalty: ${penalty}`, `fw_adv_warning_penalty:${chatId}`),
    ],
    [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
}

bot.action(/^fw_adv_warning_toggle:(-?\d+):(on|off)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_warning_toggle:(-?\d+):(on|off)$/);
  const chatId = match?.[1];
  const action = match?.[2];
  if (!chatId || !action) return;

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    const rawSettings = settings as Record<string, unknown>;
    rawSettings.warningEnabled = action === "on";
    await saveGeneralSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to toggle warning", { chatId, error });
  }

  await showWarningSettings(ctx, chatId);
});

bot.action(/^fw_adv_warning_thresh:(-?\d+):(up|down|show)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_warning_thresh:(-?\d+):(up|down|show)$/);
  const chatId = match?.[1];
  const direction = match?.[2];
  if (!chatId || !direction || direction === "show") return;

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    const rawSettings = settings as Record<string, unknown>;
    let autoWarning = rawSettings.autoWarning as Record<string, unknown>;
    if (!autoWarning) {
      autoWarning = { threshold: 3, penalty: "mute" };
      rawSettings.autoWarning = autoWarning;
    }

    let threshold = (autoWarning.threshold as number) ?? 3;
    threshold += direction === "up" ? 1 : -1;
    threshold = Math.max(1, Math.min(10, threshold));
    autoWarning.threshold = threshold;

    await saveGeneralSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to adjust warning threshold", { chatId, error });
  }

  await showWarningSettings(ctx, chatId);
});

bot.action(/^fw_adv_warning_penalty:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_warning_penalty:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    const rawSettings = settings as Record<string, unknown>;
    let autoWarning = rawSettings.autoWarning as Record<string, unknown>;
    if (!autoWarning) {
      autoWarning = { threshold: 3, penalty: "mute" };
      rawSettings.autoWarning = autoWarning;
    }

    // Cycle through penalties
    const penalties = ["delete", "mute", "kick"];
    const currentPenalty = (autoWarning.penalty as string) ?? "mute";
    const currentIndex = penalties.indexOf(currentPenalty);
    const nextIndex = (currentIndex + 1) % penalties.length;
    autoWarning.penalty = penalties[nextIndex];

    await saveGeneralSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to cycle warning penalty", { chatId, error });
  }


  await showWarningSettings(ctx, chatId);
});

// ========== FLOOD PROTECTION SUB-MENU ==========
bot.action(/^fw_adv_flood:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_flood:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showFloodSettings(ctx, chatId);
});

async function showFloodSettings(ctx: Context, chatId: string): Promise<void> {
  let banSettings;
  try {
    banSettings = await loadBanSettingsByChatId(chatId);
  } catch {
    banSettings = null;
  }

  const rawBan = banSettings as unknown as Record<string, unknown> | null;
  const rules = rawBan?.rules as Record<string, unknown> | null;
  const floodEnabled = rules?.blockFlood === true;

  if (!floodEnabled) {
    const message = `💬 <b>Flood Protection</b>

• Prevent users from sending too many messages rapidly
• Auto-mute flood offenders

<b>Status:</b> ❌ Disabled

<i>Enable this feature to protect against message flooding.</i>`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Enable Flood Protection", `fw_adv_flood_toggle:${chatId}:on`)],
      [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
    ]);

    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }

  const message = `💬 <b>Flood Protection</b>

• Users sending too many messages will be muted
• Protects against spam attacks

<b>Status:</b> ✅ Enabled`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("💬 Flood Protection ✅", `fw_adv_flood_toggle:${chatId}:off`)],
    [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
}

bot.action(/^fw_adv_flood_toggle:(-?\d+):(on|off)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_flood_toggle:(-?\d+):(on|off)$/);
  const chatId = match?.[1];
  const action = match?.[2];
  if (!chatId || !action) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;
    if (!rawSettings.rules) {
      rawSettings.rules = {};
    }
    const rules = rawSettings.rules as Record<string, unknown>;
    rules.blockFlood = action === "on";
    await saveBanSettingsByChatId(chatId, settings);
  } catch (error) {
    logger.error("Failed to toggle flood protection", { chatId, error });
  }

  await showFloodSettings(ctx, chatId);
});

// ========== REPORTS SUB-MENU ==========
bot.action(/^fw_adv_reports:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_reports:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  const message = `📈 <b>Reports</b>

View moderation statistics and activity logs for your group.

<i>Reports are available in the Mini App for detailed analysis.</i>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp("📊 View Full Reports", miniAppUrl)],
    [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
});

// ========== LOCK LIMIT SUB-MENU ==========
bot.action(/^fw_adv_lock_limit:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_lock_limit:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  const message = `📊 <b>Lock Limit</b>

Configure message limits and word count restrictions.

• <b>Min/Max Words:</b> Set word count limits per message
• <b>Messages per Window:</b> Limit messages in time window
• <b>Duplicate Detection:</b> Block repeated messages

<i>Use the Mini App for detailed limit configuration.</i>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp("⚙️ Configure Limits", miniAppUrl)],
    [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
});

// ========== PERMISSIONS SUB-MENU ==========
bot.action(/^fw_adv_permissions:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_permissions:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  const message = `⚙️ <b>Group Permissions</b>

Configure what members can do in your group.

• <b>Send Messages:</b> Allow/block text messages
• <b>Send Media:</b> Allow/block photos, videos, stickers
• <b>Add Members:</b> Allow/block adding new members
• <b>Pin Messages:</b> Allow/block pinning messages

<i>These settings affect all non-admin members.</i>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp("⚙️ Configure Permissions", miniAppUrl)],
    [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
});

// ========== CLEANUP SUB-MENU ==========
bot.action(/^fw_adv_cleanup:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_cleanup:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  const message = `🧹 <b>Group Cleanup</b>

Clean up your group by removing inactive or unwanted members.

• <b>Remove Inactive:</b> Remove members who haven't messaged
• <b>Remove Deleted:</b> Remove deleted accounts
• <b>Remove Bots:</b> Remove bot accounts

⚠️ <b>Warning:</b> This action cannot be undone!`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🧹 Remove Deleted Accounts", `fw_adv_cleanup_action:${chatId}:deleted`)],
    [Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
});

// Cleanup action handler
bot.action(/^fw_adv_cleanup_action:(-?\d+):([a-z]+)$/, async (ctx) => {
  await ctx.answerCbQuery("Cleanup started...");
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_cleanup_action:(-?\d+):([a-z]+)$/);
  const chatId = match?.[1];
  const action = match?.[2];
  if (!chatId || !action) return;

  // Note: Actual cleanup would require iterating members - this is a placeholder
  await ctx.reply(`🧹 Cleanup action "${action}" has been queued. This may take a while for large groups.`);
});

// ========== TIMEZONE SUB-MENU ==========
bot.action(/^fw_adv_timezone:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_timezone:(-?\d+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  let generalSettings;
  try {
    generalSettings = await loadGeneralSettingsByChatId(chatId);
  } catch {
    generalSettings = null;
  }

  const currentTz = (generalSettings as any)?.timezone ?? "UTC";

  const message = `🕐 <b>Time Zone</b>

Current timezone: <b>${currentTz}</b>

The timezone affects:
• Silence window schedules
• Scheduled posts timing
• Activity reports

Select a timezone below:`;

  const timezones = [
    { name: "UTC", label: "🌍 UTC" },
    { name: "Asia/Tehran", label: "🇮🇷 Iran (Tehran)" },
    { name: "Asia/Dubai", label: "🇦🇪 Dubai" },
    { name: "Europe/London", label: "🇬🇧 London" },
    { name: "America/New_York", label: "🇺🇸 New York" },
  ];

  const rows: any[] = [];
  for (const tz of timezones) {
    const isSelected = currentTz === tz.name;
    rows.push([Markup.button.callback(
      `${tz.label} ${isSelected ? "✅" : ""}`,
      `fw_adv_tz_set:${chatId}:${tz.name}`
    )]);
  }
  rows.push([Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]);

  const keyboard = Markup.inlineKeyboard(rows);
  await replyOrEditRoot(ctx, message, keyboard);
});

// Timezone set handler
bot.action(/^fw_adv_tz_set:(-?\d+):(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_tz_set:(-?\d+):(.+)$/);
  const chatId = match?.[1];
  const timezone = match?.[2];
  if (!chatId || !timezone) return;

  try {
    const settings = await loadGeneralSettingsByChatId(chatId);
    (settings as any).timezone = timezone;
    await saveGeneralSettingsByChatId(chatId, settings);
    await ctx.answerCbQuery(`Timezone set to ${timezone}`);
  } catch (error) {
    logger.error("Failed to set timezone", { chatId, timezone, error });
    await ctx.answerCbQuery("Failed to set timezone");
  }

  // Refresh timezone menu
  const generalSettings = await loadGeneralSettingsByChatId(chatId);
  const currentTz = (generalSettings as any)?.timezone ?? "UTC";

  const message = `🕐 <b>Time Zone</b>

Current timezone: <b>${currentTz}</b>

The timezone affects:
• Silence window schedules
• Scheduled posts timing
• Activity reports

Select a timezone below:`;

  const timezones = [
    { name: "UTC", label: "🌍 UTC" },
    { name: "Asia/Tehran", label: "🇮🇷 Iran (Tehran)" },
    { name: "Asia/Dubai", label: "🇦🇪 Dubai" },
    { name: "Europe/London", label: "🇬🇧 London" },
    { name: "America/New_York", label: "🇺🇸 New York" },
  ];

  const rows: any[] = [];
  for (const tz of timezones) {
    const isSelected = currentTz === tz.name;
    rows.push([Markup.button.callback(
      `${tz.label} ${isSelected ? "✅" : ""}`,
      `fw_adv_tz_set:${chatId}:${tz.name}`
    )]);
  }
  rows.push([Markup.button.callback("◀️ Back", `fw_inline_advanced:${chatId}`)]);

  const keyboard = Markup.inlineKeyboard(rows);
  await replyOrEditRoot(ctx, message, keyboard);
});

// ========== DISPLAY-ONLY BUTTON HANDLERS ==========
// These buttons are for display purposes only (showing current values)
// They should show an alert when clicked

// Generic handler for all display-only (_show) buttons in advanced settings
bot.action(/^fw_adv_[a-z_]+_show:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery("ℹ️ This is a display button. Use the +/- buttons to adjust the value.", { show_alert: true });
});

// Specific handlers for count/time display buttons
bot.action(/^fw_adv_sl_count_show:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery("ℹ️ Use the − and + buttons below to adjust the count.", { show_alert: true });
});

bot.action(/^fw_adv_mj_target_show:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery("ℹ️ Use the navigation buttons below to select a target channel.", { show_alert: true });
});

bot.action(/^fw_adv_mj_time_show:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery("ℹ️ Use the arrow buttons below to adjust the delete time.", { show_alert: true });
});

bot.action(/^fw_adv_ma_count_show:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery("ℹ️ Use the − and + buttons to adjust the required count.", { show_alert: true });
});

bot.action(/^fw_adv_ma_time_show:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery("ℹ️ Use the − and + buttons to adjust the delete time.", { show_alert: true });
});

bot.action(/^fw_adv_sl_deltime_show:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery("ℹ️ Use the arrow buttons below to adjust the bot message delete time.", { show_alert: true });
});

// Catch-all for any fw_adv patterns that don't match specific handlers
bot.action(/^fw_adv_[a-z_]+:(-?\d+)$/, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_adv_([a-z_]+):(-?\d+)$/);
  const featureId = match?.[1];
  const chatId = match?.[2];

  if (!chatId || !featureId) {
    await ctx.answerCbQuery("Invalid button data");
    return;
  }

  // Check if this is a known feature that should have a handler
  const feature = ADVANCED_FEATURES.find(f => f.id === featureId);
  if (feature) {
    // If feature exists but handler wasn't found, show coming soon
    await ctx.answerCbQuery(`⚙️ ${feature.title} is coming soon!`, { show_alert: false });
  } else {
    // Unknown feature ID
    await ctx.answerCbQuery("ℹ️ This button is for display purposes only.", { show_alert: false });
  }
});

bot.action(INLINE_LIST_ADD_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(INLINE_LIST_ADD_REGEX);
  const chatId = match?.[1];
  const listId = match?.[2];

  if (!chatId || !listId) return;

  const cfg = getInlineListConfig(listId);
  if (!cfg || !cfg.supportsAdd) {
    await ctx.reply("This list does not support adding items via the inline panel.");
    return;
  }

  const userId = ctx.from?.id?.toString();
  if (userId) {
    // Determine the appropriate step based on listId
    let step: InlineSessionStep = "awaiting_add_input";
    if (listId === "auto_replies") {
      step = "awaiting_auto_reply_trigger";
    } else if (listId === "scheduled_posts") {
      step = "awaiting_scheduled_message";
    }

    setInlineSession(userId, {
      chatId,
      listId: listId as InlineListId,
      step,
      tempData: {}
    });
  }

  const prompt = cfg.addPrompt ?? "Please send the content you want to add:";
  const message = `➕ <b>Add to ${cfg.title}</b>

${prompt}

<i>Send your input as a text message now.</i>
<i>Type /cancel to cancel this operation.</i>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Cancel", `fw_inline_list:${chatId}:${listId}`)]
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
});

bot.action(INLINE_LOCKS_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? (ctx.callbackQuery as any).data
      : "";
  const match = data.match(INLINE_LOCKS_REGEX);
  const chatId = match?.[1];
  const pageRaw = match?.[2];
  const page = pageRaw ? Number.parseInt(pageRaw, 10) || 1 : 1;
  if (!chatId) {
    await showInlineGroupSelection(ctx);
    return;
  }
  await showInlineLocksPage(ctx, chatId, page);
});

bot.action(INLINE_LOCK_TOGGLE_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? (ctx.callbackQuery as any).data
      : "";
  const match = data.match(INLINE_LOCK_TOGGLE_REGEX);
  const chatId = match?.[1];
  const pageRaw = match?.[2];
  const lockId = match?.[3];
  const page = pageRaw ? Number.parseInt(pageRaw, 10) || 1 : 1;
  if (!chatId || !lockId) {
    await showInlineGroupSelection(ctx);
    return;
  }

  const item = INLINE_LOCK_ITEMS.find((entry) => entry.id === lockId);
  if (!item) {
    await showInlineLocksPage(ctx, chatId, page);
    return;
  }

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const anyEnabled = item.keys.some((key) => settings.rules[key]?.enabled);
    for (const key of item.keys) {
      if (!settings.rules[key]) {
        continue;
      }
      settings.rules[key].enabled = !anyEnabled;
    }
    await saveBanSettingsByChatId(chatId, settings as unknown as GroupBanSettingsRecord);
  } catch {
    await replyOrEditRoot(
      ctx,
      "Failed to toggle this lock. Please try again later.",
      Markup.inlineKeyboard([[Markup.button.callback("Back to panel", `fw_inline_menu:${chatId}`)]]),
    );
    return;
  }

  await showInlineLocksPage(ctx, chatId, page);
});

bot.action(INLINE_LISTS_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? (ctx.callbackQuery as any).data
      : "";
  const match = data.match(INLINE_LISTS_REGEX);
  const chatId = match?.[1];
  if (!chatId) {
    await showInlineGroupSelection(ctx);
    return;
  }
  await showInlineListsOverview(ctx, chatId);
});

bot.action(INLINE_LIST_DETAIL_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? (ctx.callbackQuery as any).data
      : "";
  const match = data.match(INLINE_LIST_DETAIL_REGEX);
  const chatId = match?.[1];
  const listId = match?.[2];
  if (!chatId || !listId) {
    await showInlineGroupSelection(ctx);
    return;
  }
  await showInlineListDetail(ctx, chatId, listId);
});

// ============================================
// HELP SECTION CALLBACK HANDLERS
// ============================================

// Main Help menu handler
bot.action(INLINE_HELP_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(INLINE_HELP_REGEX);
  const chatId = match?.[1];
  if (!chatId) {
    await showInlineGroupSelection(ctx);
    return;
  }
  await showInlineHelp(ctx, chatId);
});

// Help section handler (handles all 13 sections)
bot.action(/^fw_help_section:(-?\d+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_section:(-?\d+):([a-z_]+)$/);
  const chatId = match?.[1];
  const sectionId = match?.[2];
  if (!chatId || !sectionId) return;

  // Find the section
  const section = HELP_SECTIONS.find((s) => s.id === sectionId);
  if (!section) {
    await ctx.answerCbQuery("Section not found", { show_alert: true });
    return;
  }

  // If Lock Management, show the locks submenu
  if (sectionId === "lock_management") {
    await showHelpLocks(ctx, chatId, 1);
    return;
  }

  // If User Penalties, show the penalties submenu
  if (sectionId === "user_penalties") {
    await showHelpPenalties(ctx, chatId);
    return;
  }

  // If Tabchi, show the tabchi help
  if (sectionId === "tabchi") {
    await showHelpTabchi(ctx, chatId);
    return;
  }

  // If Settings, show the settings submenu
  if (sectionId === "settings") {
    await showHelpSettings(ctx, chatId);
    return;
  }

  // If User Panel, show the user panel help
  if (sectionId === "user_panel") {
    await showHelpUserPanel(ctx, chatId);
    return;
  }

  // If Promote & Demote, show the promote/demote help
  if (sectionId === "promote_demote") {
    await showHelpPromote(ctx, chatId);
    return;
  }

  // If Cleanup, show the cleanup help
  if (sectionId === "cleanup") {
    await showHelpCleanup(ctx, chatId);
    return;
  }

  // If Word Filter, show the word filter help
  if (sectionId === "word_filter") {
    await showHelpWordFilter(ctx, chatId);
    return;
  }

  // If Activity Statistics, show the stats help
  if (sectionId === "activity_stats") {
    await showHelpStats(ctx, chatId);
    return;
  }

  // If Entertainment & Utilities, show the entertainment help
  if (sectionId === "entertainment") {
    await showHelpEntertainment(ctx, chatId);
    return;
  }

  // If Welcome, show the welcome help
  if (sectionId === "welcome") {
    await showHelpWelcome(ctx, chatId);
    return;
  }

  // For unimplemented sections, show "coming soon" message
  if (!section.implemented) {
    const message = `${section.icon} <b>${section.title}</b>\n\n🚧 This help section is coming soon!\n\nWe're working on documenting this feature.`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
    ]);
    await replyOrEditRoot(ctx, message, keyboard);
    return;
  }
});

// Lock Management submenu handler (paginated list of locks)
bot.action(/^fw_help_locks:(.+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_locks:(.+):(\d+)$/);
  const chatId = match?.[1];
  const pageRaw = match?.[2];
  const page = pageRaw ? Number.parseInt(pageRaw, 10) || 1 : 1;
  if (!chatId) return;

  await showHelpLocks(ctx, chatId, page);
});

// Individual lock detail handler
bot.action(/^fw_help_lock:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_lock:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const lockId = match?.[2];
  if (!chatId || !lockId) return;

  await showHelpLockDetail(ctx, chatId, lockId);
});

// User Penalties submenu handler
bot.action(/^fw_help_penalties:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_penalties:(.+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showHelpPenalties(ctx, chatId);
});

// Individual penalty detail handler
bot.action(/^fw_help_penalty:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_penalty:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const penaltyId = match?.[2];
  if (!chatId || !penaltyId) return;

  await showHelpPenaltyDetail(ctx, chatId, penaltyId);
});

// Settings submenu handler
bot.action(/^fw_help_settings:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_settings:(.+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showHelpSettings(ctx, chatId);
});

// Individual setting detail handler
bot.action(/^fw_help_setting:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_setting:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const settingId = match?.[2];
  if (!chatId || !settingId) return;

  await showHelpSettingDetail(ctx, chatId, settingId);
});

// Promote & Demote submenu handler
bot.action(/^fw_help_promote:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_promote:(.+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showHelpPromote(ctx, chatId);
});

// Individual rank detail handler
bot.action(/^fw_help_rank:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_rank:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const rankId = match?.[2];
  if (!chatId || !rankId) return;

  await showHelpRankDetail(ctx, chatId, rankId);
});

// Cleanup menu handler
bot.action(/^fw_help_cleanup:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_cleanup:(.+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showHelpCleanup(ctx, chatId);
});

// Individual cleanup item detail handler
bot.action(/^fw_help_cleanup_item:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_cleanup_item:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const itemId = match?.[2];
  if (!chatId || !itemId) return;

  await showHelpCleanupDetail(ctx, chatId, itemId);
});

// Word Filter menu handler
bot.action(/^fw_help_wordfilter:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_wordfilter:(.+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showHelpWordFilter(ctx, chatId);
});

// Individual word filter item detail handler
bot.action(/^fw_help_wordfilter_item:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_wordfilter_item:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const itemId = match?.[2];
  if (!chatId || !itemId) return;

  await showHelpWordFilterDetail(ctx, chatId, itemId);
});

// Activity Statistics menu handler
bot.action(/^fw_help_stats:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_stats:(.+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showHelpStats(ctx, chatId);
});

// Individual stats item detail handler
bot.action(/^fw_help_stats_item:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_stats_item:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const itemId = match?.[2];
  if (!chatId || !itemId) return;

  await showHelpStatsDetail(ctx, chatId, itemId);
});

// ============================================
// ENTERTAINMENT & UTILITIES HELP KEYBOARDS AND DISPLAY
// ============================================

function buildHelpEntertainmentKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];

  // Build entertainment buttons (2 per row for better layout)
  for (let i = 0; i < ENTERTAINMENT_HELP_DATA.length; i += 2) {
    const row: any[] = [];
    for (let j = 0; j < 2 && i + j < ENTERTAINMENT_HELP_DATA.length; j++) {
      const item = ENTERTAINMENT_HELP_DATA[i + j];
      const label = `${item.icon} ${item.name}`;
      row.push(Markup.button.callback(label, `fw_help_entertainment_item:${chatId}:${item.id}`));
    }
    rows.push(row);
  }

  rows.push([Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showHelpEntertainment(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];

  lines.push("🎮 <b>Entertainment & Utilities Guide</b>");
  lines.push("");
  lines.push("<i>Using these commands, you can access various entertainment and utility features. All commands start with ! or . prefix.</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>✨ Key Features:</b>");
  lines.push("• Convert text to stylish fonts");
  lines.push("• Get current time based on timezone");
  lines.push("• Translation & dictionary lookup");
  lines.push("• Weather, news & currency info");
  lines.push("• User profiles & management");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("Select a feature below to view commands:");

  const keyboard = buildHelpEntertainmentKeyboard(chatId);
  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

async function showHelpEntertainmentDetail(ctx: Context, chatId: string, itemId: string): Promise<void> {
  const item = ENTERTAINMENT_HELP_DATA.find((i) => i.id === itemId);
  if (!item) {
    await ctx.answerCbQuery("Item not found", { show_alert: true });
    return;
  }

  const lines: string[] = [];

  lines.push(`${item.icon} <b>${item.name}</b>`);
  lines.push("");
  lines.push(`<i>${item.summary}</i>`);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push(item.description);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>❯❯ English Commands:</b>");
  lines.push("");
  for (const cmd of item.commands) {
    lines.push(`❯ <code>${cmd.command}</code>`);
  }

  if (item.examples && item.examples.length > 0) {
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("");
    lines.push("<b>💡 Examples:</b>");
    lines.push("");
    for (const ex of item.examples) {
      lines.push(`• ${ex.description}`);
      lines.push(`  ⮨ <code>${ex.command}</code>`);
    }
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Entertainment", `fw_help_entertainment:${chatId}`)],
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// Entertainment menu handler
bot.action(/^fw_help_entertainment:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_entertainment:(.+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showHelpEntertainment(ctx, chatId);
});

// Individual entertainment item detail handler
bot.action(/^fw_help_entertainment_item:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_entertainment_item:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const itemId = match?.[2];
  if (!chatId || !itemId) return;

  await showHelpEntertainmentDetail(ctx, chatId, itemId);
});

// ============================================
// MANDATORY ADD HELP KEYBOARDS AND DISPLAY
// ============================================

function buildHelpMandatoryAddKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];
  for (const item of MANDATORY_ADD_HELP_DATA) {
    const label = `${item.icon} ${item.name}`;
    rows.push([Markup.button.callback(label, `fw_help_mandatory_add_item:${chatId}:${item.id}`)]);
  }
  rows.push([Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showHelpMandatoryAdd(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];
  lines.push("➕ <b>Mandatory Add Guide</b>");
  lines.push("");
  lines.push("<i>Require members to add new users to the group before they can send messages.</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("Select a category below to see commands:");

  await replyOrEditRoot(ctx, lines.join("\n"), buildHelpMandatoryAddKeyboard(chatId));
}

async function showHelpMandatoryAddDetail(ctx: Context, chatId: string, itemId: string): Promise<void> {
  const item = MANDATORY_ADD_HELP_DATA.find((i) => i.id === itemId);
  if (!item) {
    await ctx.answerCbQuery("Item not found", { show_alert: true });
    return;
  }

  const lines: string[] = [];
  lines.push(`${item.icon} <b>${item.name}</b>`);
  lines.push("");
  lines.push(`<i>${item.summary}</i>`);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push(item.description);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📝 Commands:</b>");
  lines.push("");
  for (const cmd of item.commands) {
    lines.push(`› <code>${cmd.command}</code>`);
  }

  if (item.examples && item.examples.length > 0) {
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("");
    lines.push("<b>💡 Examples:</b>");
    lines.push("");
    for (const ex of item.examples) {
      lines.push(`• ${ex.description}`);
      lines.push(`  ⮨ <code>${ex.command}</code>`);
    }
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Mandatory Add", `fw_help_mandatory_add:${chatId}`)],
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// ============================================
// MANDATORY MEMBERSHIP HELP KEYBOARDS AND DISPLAY
// ============================================

function buildHelpMandatoryMembershipKeyboard(chatId: string): InlineKeyboard {
  const rows: any[] = [];
  for (const item of MANDATORY_MEMBERSHIP_HELP_DATA) {
    const label = `${item.icon} ${item.name}`;
    rows.push([Markup.button.callback(label, `fw_help_mandatory_membership_item:${chatId}:${item.id}`)]);
  }
  rows.push([Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)]);
  return Markup.inlineKeyboard(rows);
}

async function showHelpMandatoryMembership(ctx: Context, chatId: string): Promise<void> {
  const lines: string[] = [];
  lines.push("📌 <b>Mandatory Membership Guide</b>");
  lines.push("");
  lines.push("<i>Force users to join your target channel before they can chat in your group. This is great for cross-promoting channels.</i>");
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("Select a category below to see commands:");

  await replyOrEditRoot(ctx, lines.join("\n"), buildHelpMandatoryMembershipKeyboard(chatId));
}

async function showHelpMandatoryMembershipDetail(ctx: Context, chatId: string, itemId: string): Promise<void> {
  const item = MANDATORY_MEMBERSHIP_HELP_DATA.find((i) => i.id === itemId);
  if (!item) {
    await ctx.answerCbQuery("Item not found", { show_alert: true });
    return;
  }

  const lines: string[] = [];
  lines.push(`${item.icon} <b>${item.name}</b>`);
  lines.push("");
  lines.push(`<i>${item.summary}</i>`);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push(item.description);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("<b>📝 Commands:</b>");
  lines.push("");
  for (const cmd of item.commands) {
    lines.push(`› <code>${cmd.command}</code>`);
  }

  if (item.examples && item.examples.length > 0) {
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("");
    lines.push("<b>💡 Examples:</b>");
    lines.push("");
    for (const ex of item.examples) {
      lines.push(`• ${ex.description}`);
      lines.push(`  ⮨ <code>${ex.command}</code>`);
    }
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back to Mandatory Membership", `fw_help_mandatory_membership:${chatId}`)],
    [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)],
  ]);

  await replyOrEditRoot(ctx, lines.join("\n"), keyboard);
}

// Mandatory Add menu handler
bot.action(/^fw_help_mandatory_add:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_mandatory_add:(.+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showHelpMandatoryAdd(ctx, chatId);
});

// Mandatory Add item detail handler
bot.action(/^fw_help_mandatory_add_item:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_mandatory_add_item:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const itemId = match?.[2];
  if (!chatId || !itemId) return;

  await showHelpMandatoryAddDetail(ctx, chatId, itemId);
});

// Mandatory Membership menu handler
bot.action(/^fw_help_mandatory_membership:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_mandatory_membership:(.+)$/);
  const chatId = match?.[1];
  if (!chatId) return;

  await showHelpMandatoryMembership(ctx, chatId);
});

// Mandatory Membership item detail handler
bot.action(/^fw_help_mandatory_membership_item:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_mandatory_membership_item:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const itemId = match?.[2];
  if (!chatId || !itemId) return;

  await showHelpMandatoryMembershipDetail(ctx, chatId, itemId);
});

// Generic help section routing handler (Fix for missing handler)
bot.action(/^fw_help_section:(.+):([a-z_]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(/^fw_help_section:(.+):([a-z_]+)$/);
  const chatId = match?.[1];
  const sectionId = match?.[2];
  if (!chatId || !sectionId) return;

  switch (sectionId) {
    case "lock_management":
      await showHelpLocks(ctx, chatId, 1);
      break;
    case "settings":
      await showHelpSettings(ctx, chatId);
      break;
    case "tabchi":
      await showHelpTabchi(ctx, chatId);
      break;
    case "user_panel":
      await ctx.reply("To access the User Panel, use the command `!UserPanel` or click the button below.", Markup.inlineKeyboard([
        [Markup.button.callback("◀️ Back to Help", `fw_inline_help:${chatId}`)]
      ]));
      break;
    case "user_penalties":
      await showHelpPenalties(ctx, chatId);
      break;
    case "promote_demote":
      await showHelpPromote(ctx, chatId);
      break;
    case "word_filter":
      await showHelpWordFilter(ctx, chatId);
      break;
    case "cleanup":
      await showHelpCleanup(ctx, chatId);
      break;
    case "mandatory_add":
      await showHelpMandatoryAdd(ctx, chatId);
      break;
    case "welcome":
      // Assuming showHelpWelcome exists as it was implemented in previous session
      await showHelpWelcome(ctx, chatId);
      break;
    case "mandatory_membership":
      await showHelpMandatoryMembership(ctx, chatId);
      break;
    case "activity_stats":
      await showHelpStats(ctx, chatId);
      break;
    case "entertainment":
      await showHelpEntertainment(ctx, chatId);
      break;
    default:
      await ctx.answerCbQuery("Section not implemented yet", { show_alert: true });
  }
});

// ============================================
// USER PANEL IMPLEMENTATION
// ============================================

// Show User Panel Main View
async function showUserPanelMain(ctx: Context, chatId: string, targetUserId: string): Promise<void> {
  // Try to get user info from Telegram
  let userName = "Unknown User";
  let userUsername = "";
  let userStatus = "Member";
  let botRole = "Regular User";

  try {
    const numericChatId = parseInt(chatId, 10);
    const numericUserId = parseInt(targetUserId, 10);
    const member = await ctx.telegram.getChatMember(numericChatId, numericUserId);

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

  // Load user panel settings
  const settings = await getUserPanelSettings(chatId, targetUserId);
  const nickname = settings.nickname ?? "None";

  // Check ban/mute status
  let isBanned = false;
  let isMuted = false;
  try {
    const numericChatId = parseInt(chatId, 10);
    const numericUserId = parseInt(targetUserId, 10);
    const member = await ctx.telegram.getChatMember(numericChatId, numericUserId);
    isBanned = member.status === "kicked";
    isMuted = member.status === "restricted" && !member.can_send_messages;
  } catch {
    // ignore
  }

  // Get warning count
  let warningCount = 0;
  if (databaseAvailable) {
    try {
      const { prisma } = await import("../server/db/client.js");
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
⊹ Nickname: ${nickname}
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

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("• Locks & Restrictions", `fw_up_locks:${chatId}:${targetUserId}`)],
    [Markup.button.callback("• Punishments & Release", `fw_up_punish:${chatId}:${targetUserId}`)],
    [Markup.button.callback("• Promote & Demote", `fw_up_promote:${chatId}:${targetUserId}`)],
    [Markup.button.callback("• Confirm & Close", `fw_up_close:${chatId}:${targetUserId}`)],
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
}

// Show User Panel Locks Section
async function showUserPanelLocks(ctx: Context, chatId: string, targetUserId: string): Promise<void> {
  // Get user info for header
  let userUsername = "";
  try {
    const numericChatId = parseInt(chatId, 10);
    const numericUserId = parseInt(targetUserId, 10);
    const member = await ctx.telegram.getChatMember(numericChatId, numericUserId);
    userUsername = member.user.username ?? member.user.first_name;
  } catch {
    userUsername = targetUserId;
  }

  // Load user lock overrides
  const settings = await getUserPanelSettings(chatId, targetUserId);
  const overrides = settings.lockOverrides;

  const message = `⊹ Username: ${userUsername}
«Locks & Restrictions Section»`;

  const rows: any[] = [];

  // Guide button at top
  rows.push([Markup.button.callback("• Guide for Locks in this Section", `fw_up_lock_guide:${chatId}:${targetUserId}`)]);

  // Build lock toggle buttons (2 per row)
  for (let i = 0; i < USER_PANEL_LOCK_ITEMS.length; i += 2) {
    const row: any[] = [];

    for (let j = 0; j < 2 && i + j < USER_PANEL_LOCK_ITEMS.length; j++) {
      const item = USER_PANEL_LOCK_ITEMS[i + j];
      const state = (overrides[item.key] as UserLockOverrideState) ?? 'default';
      const stateIcon = getUserLockStateIcon(state);
      const label = `${item.label} ${stateIcon}`;
      row.push(Markup.button.callback(label, `fw_up_lock_toggle:${chatId}:${targetUserId}:${item.id}`));
    }

    rows.push(row);
  }

  // Back button
  rows.push([Markup.button.callback("◀️ Back", `fw_userpanel:${chatId}:${targetUserId}`)]);

  const keyboard = Markup.inlineKeyboard(rows);
  await replyOrEditRoot(ctx, message, keyboard);
}

// Show Lock Guide
async function showUserPanelLockGuide(ctx: Context, chatId: string, targetUserId: string): Promise<void> {
  const message = `◄ <b>Lock Guide for this Section</b>

The locks you saw on the previous page are specific to the selected user, and enabling or disabling them has <b>no effect</b> on «Group Settings or Other Users».

For example, if you set the Sticker lock to 🔐 on the previous page, the user is <b>not allowed to send stickers under any circumstances!</b>

Pay attention to the following examples:

<b>➊ Sticker ✗</b>
This means default sticker settings for this user.
No special settings are applied to this user.
After sending a sticker by this user, if stickers are locked in the general settings, this user's sticker will also be deleted. Otherwise, the sticker won't be deleted.

<b>➋ Sticker: Open</b>
This means stickers are exclusively open for this user.
In this case, stickers are open for this user even if stickers are locked in the general settings.

<b>➌ Sticker 🔐</b>
This means stickers are exclusively locked for this user.
In this case, stickers are locked for this user even if stickers are open in the general settings.
In special cases, with this feature, the group owner can restrict sending various content types even for high-ranking users and admins!!!`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Back", `fw_up_locks:${chatId}:${targetUserId}`)],
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
}

// Show Punishments Section
async function showUserPanelPunishments(ctx: Context, chatId: string, targetUserId: string): Promise<void> {
  // Get user info for header
  let userUsername = "";
  try {
    const numericChatId = parseInt(chatId, 10);
    const numericUserId = parseInt(targetUserId, 10);
    const member = await ctx.telegram.getChatMember(numericChatId, numericUserId);
    userUsername = member.user.username ?? member.user.first_name;
  } catch {
    userUsername = targetUserId;
  }

  const message = `⊹ Username: ${userUsername}
«Punishments & Release Section»`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("• Ban", `fw_up_ban:${chatId}:${targetUserId}`)],
    [Markup.button.callback("• Mute", `fw_up_mute:${chatId}:${targetUserId}`)],
    [Markup.button.callback("◀️ Back", `fw_userpanel:${chatId}:${targetUserId}`)],
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
}

// Show Promote Section
async function showUserPanelPromote(ctx: Context, chatId: string, targetUserId: string): Promise<void> {
  // Get user info for header
  let userUsername = "";
  try {
    const numericChatId = parseInt(chatId, 10);
    const numericUserId = parseInt(targetUserId, 10);
    const member = await ctx.telegram.getChatMember(numericChatId, numericUserId);
    userUsername = member.user.username ?? member.user.first_name;
  } catch {
    userUsername = targetUserId;
  }

  const message = `⊹ Username: ${userUsername}
«Promote & Demote Section»`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("• Promote to VIP Member", `fw_up_vip:${chatId}:${targetUserId}`)],
    [Markup.button.callback("• Promote to Bot Admin", `fw_up_admin:${chatId}:${targetUserId}`)],
    [Markup.button.callback("◀️ Back", `fw_userpanel:${chatId}:${targetUserId}`)],
  ]);

  await replyOrEditRoot(ctx, message, keyboard);
}

// UserPanel Main Handler
bot.action(USER_PANEL_MAIN_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(USER_PANEL_MAIN_REGEX);
  const chatId = match?.[1];
  const targetUserId = match?.[2];
  if (!chatId || !targetUserId) return;

  await showUserPanelMain(ctx, chatId, targetUserId);
});

// UserPanel Locks Handler
bot.action(USER_PANEL_LOCKS_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(USER_PANEL_LOCKS_REGEX);
  const chatId = match?.[1];
  const targetUserId = match?.[2];
  if (!chatId || !targetUserId) return;

  await showUserPanelLocks(ctx, chatId, targetUserId);
});

// UserPanel Lock Toggle Handler
bot.action(USER_PANEL_LOCK_TOGGLE_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(USER_PANEL_LOCK_TOGGLE_REGEX);
  const chatId = match?.[1];
  const targetUserId = match?.[2];
  const lockId = match?.[3];
  if (!chatId || !targetUserId || !lockId) return;

  // Find the lock item
  const item = USER_PANEL_LOCK_ITEMS.find(i => i.id === lockId);
  if (!item) {
    await ctx.answerCbQuery("Lock not found", { show_alert: true });
    return;
  }

  // Get current state and toggle to next
  const settings = await getUserPanelSettings(chatId, targetUserId);
  const currentState = (settings.lockOverrides[item.key] as UserLockOverrideState) ?? 'default';
  const nextState = getNextLockState(currentState);

  // Save the new state
  await setUserLockOverride(chatId, targetUserId, item.key, nextState);

  // Refresh the locks view
  await showUserPanelLocks(ctx, chatId, targetUserId);
});

// UserPanel Lock Guide Handler
bot.action(USER_PANEL_LOCK_GUIDE_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(USER_PANEL_LOCK_GUIDE_REGEX);
  const chatId = match?.[1];
  const targetUserId = match?.[2];
  if (!chatId || !targetUserId) return;

  await showUserPanelLockGuide(ctx, chatId, targetUserId);
});

// UserPanel Punishments Handler
bot.action(USER_PANEL_PUNISHMENTS_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(USER_PANEL_PUNISHMENTS_REGEX);
  const chatId = match?.[1];
  const targetUserId = match?.[2];
  if (!chatId || !targetUserId) return;

  await showUserPanelPunishments(ctx, chatId, targetUserId);
});

// UserPanel Promote Handler
bot.action(USER_PANEL_PROMOTE_REGEX, async (ctx) => {
  await ctx.answerCbQuery();
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(USER_PANEL_PROMOTE_REGEX);
  const chatId = match?.[1];
  const targetUserId = match?.[2];
  if (!chatId || !targetUserId) return;

  await showUserPanelPromote(ctx, chatId, targetUserId);
});

// UserPanel Ban Handler
bot.action(USER_PANEL_BAN_REGEX, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(USER_PANEL_BAN_REGEX);
  const chatId = match?.[1];
  const targetUserId = match?.[2];
  if (!chatId || !targetUserId) return;

  try {
    const numericChatId = parseInt(chatId, 10);
    const numericUserId = parseInt(targetUserId, 10);
    await ctx.telegram.banChatMember(numericChatId, numericUserId);
    await ctx.answerCbQuery("✅ User has been banned", { show_alert: true });
  } catch (error) {
    logger.error("Failed to ban user from UserPanel", { chatId, targetUserId, error });
    await ctx.answerCbQuery("❌ Failed to ban user", { show_alert: true });
  }

  // Refresh the punishments view
  await showUserPanelPunishments(ctx, chatId, targetUserId);
});

// UserPanel Mute Handler
bot.action(USER_PANEL_MUTE_REGEX, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(USER_PANEL_MUTE_REGEX);
  const chatId = match?.[1];
  const targetUserId = match?.[2];
  if (!chatId || !targetUserId) return;

  try {
    const numericChatId = parseInt(chatId, 10);
    const numericUserId = parseInt(targetUserId, 10);
    await ctx.telegram.restrictChatMember(numericChatId, numericUserId, {
      permissions: {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
        can_manage_topics: false,
      },
    });
    await ctx.answerCbQuery("✅ User has been muted", { show_alert: true });
  } catch (error) {
    logger.error("Failed to mute user from UserPanel", { chatId, targetUserId, error });
    await ctx.answerCbQuery("❌ Failed to mute user", { show_alert: true });
  }

  // Refresh the punishments view
  await showUserPanelPunishments(ctx, chatId, targetUserId);
});

// UserPanel VIP Handler
bot.action(USER_PANEL_VIP_REGEX, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(USER_PANEL_VIP_REGEX);
  const chatId = match?.[1];
  const targetUserId = match?.[2];
  if (!chatId || !targetUserId) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!Array.isArray(rawSettings.vipMembers)) {
      rawSettings.vipMembers = [];
    }

    const vipMembers = rawSettings.vipMembers as string[];

    if (vipMembers.includes(targetUserId)) {
      await ctx.answerCbQuery("⚠️ User is already a VIP member", { show_alert: true });
    } else {
      vipMembers.push(targetUserId);
      await saveBanSettingsByChatId(chatId, settings);
      await ctx.answerCbQuery("✅ User promoted to VIP Member", { show_alert: true });
    }
  } catch (error) {
    logger.error("Failed to promote user to VIP", { chatId, targetUserId, error });
    await ctx.answerCbQuery("❌ Failed to promote user", { show_alert: true });
  }

  // Refresh the promote view
  await showUserPanelPromote(ctx, chatId, targetUserId);
});

// UserPanel Bot Admin Handler
bot.action(USER_PANEL_ADMIN_REGEX, async (ctx) => {
  const data = (ctx.callbackQuery as any)?.data ?? "";
  const match = data.match(USER_PANEL_ADMIN_REGEX);
  const chatId = match?.[1];
  const targetUserId = match?.[2];
  if (!chatId || !targetUserId) return;

  try {
    const settings = await loadBanSettingsByChatId(chatId);
    const rawSettings = settings as unknown as Record<string, unknown>;

    if (!Array.isArray(rawSettings.botAdmins)) {
      rawSettings.botAdmins = [];
    }

    const botAdmins = rawSettings.botAdmins as string[];

    if (botAdmins.includes(targetUserId)) {
      await ctx.answerCbQuery("⚠️ User is already a Bot Admin", { show_alert: true });
    } else {
      botAdmins.push(targetUserId);
      await saveBanSettingsByChatId(chatId, settings);
      await ctx.answerCbQuery("✅ User promoted to Bot Admin", { show_alert: true });
    }
  } catch (error) {
    logger.error("Failed to promote user to Bot Admin", { chatId, targetUserId, error });
    await ctx.answerCbQuery("❌ Failed to promote user", { show_alert: true });
  }

  // Refresh the promote view
  await showUserPanelPromote(ctx, chatId, targetUserId);
});

// UserPanel Close Handler
bot.action(/^fw_up_close:(-?\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery("✅ User panel closed");
  try {
    await ctx.deleteMessage();
  } catch {
    // Message might already be deleted
  }
});

// Note: The INLINE_LIST_ADD_REGEX handler with interactive session is defined earlier in the file

bot.action(actionId("channel"), async (ctx) => {
  await ctx.answerCbQuery();
  const settings = getPanelSettings();
  const message =
    settings.channelAnnouncement && settings.channelAnnouncement.trim().length > 0
      ? settings.channelAnnouncement
      : content.messages.channel;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("\u{1F519} Back", actionId("managementBack"))]
  ]);
  await replyOrEditRoot(ctx, message, keyboard);
});

bot.action(actionId("commands"), async (ctx) => {
  await ctx.answerCbQuery();
  const { EXTENDED_COMMANDS } = await import("./content.js");

  // Always show the full command reference as 5 separate messages
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("\u{1F519} Back", actionId("managementBack"))]
  ]);
  await replyOrEditRoot(ctx, EXTENDED_COMMANDS[0], keyboard);

  for (let i = 1; i < EXTENDED_COMMANDS.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500)); // Avoid rate limit
    await ctx.reply(EXTENDED_COMMANDS[i], { parse_mode: "HTML" });
  }
});

bot.action(actionId("info"), async (ctx) => {
  await ctx.answerCbQuery();
  const settings = getPanelSettings();
  const custom = settings.infoCommands?.trim();
  const message = custom && custom.length > 0 ? custom : content.messages.info;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("\u{1F519} Back", actionId("managementBack"))]
  ]);

  await ctx.reply(message, { parse_mode: "HTML", ...keyboard });
});

bot.action(actionId("missingAddToGroup"), async (ctx) => {
  await ctx.answerCbQuery();

  if (botUsername) {
    await ctx.reply(
      "Update BOT_USERNAME or ADD_TO_GROUP_URL in your environment so the add-to-group button can generate a valid link."
    );
    return;
  }

  await ctx.reply("Please configure BOT_USERNAME or ADD_TO_GROUP_URL so the add-to-group shortcut can be enabled.");
});

bot.action(actionId("ownerBackToPanel"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  await respondWithOwnerView(ctx, ownerMessages.panelIntro, buildOwnerPanelKeyboard());
});

bot.action(actionId("ownerManageAdmins"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  const summary = formatAdminsSummary();
  await respondWithOwnerView(ctx, `${ownerMessages.adminsIntro}\n\n${summary}`, buildOwnerAdminsKeyboard());
});

bot.action(actionId("ownerAddAdmin"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingAddAdmin" });
  await respondWithOwnerView(ctx, `${ownerMessages.addAdmin}\n\n${formatAdminsSummary()}`, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerRemoveAdmin"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingRemoveAdmin" });
  await respondWithOwnerView(
    ctx,
    `${ownerMessages.removeAdmin}\n\n${formatAdminsSummary()}`,
    buildOwnerNavigationKeyboard()
  );
});

bot.action(actionId("ownerManageGroup"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingManageGroup" });
  const snapshot = formatGroupSnapshot();
  const message = `${ownerMessages.manageGroup}\n\n${snapshot}`;
  await respondWithOwnerView(ctx, message, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerAdjustCredit"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  await respondWithOwnerView(ctx, ownerMessages.creditIntro, buildOwnerCreditKeyboard());
});

bot.action(actionId("ownerReconcileStars"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  await ctx.answerCbQuery("Reconciling Stars subscriptions...");
  try {
    const mismatches = await findStarsReconciliationIssues({ state: getState() });
    if (mismatches.length === 0) {
      await respondWithOwnerView(
        ctx,
        "All Stars purchases look consistent with the current bot state.",
        buildOwnerNavigationKeyboard(),
      );
      return;
    }

    const limit = 5;
    const summary = mismatches.slice(0, limit).map((issue, index) => {
      const parts: string[] = [];
      parts.push(`#${index + 1} - Group ${issue.groupId}`);
      parts.push(`- Issues: ${issue.issues.join(", ")}`);
      parts.push(`- State expiry: ${issue.stateExpiresAt ?? "n/a"}`);
      parts.push(`- Expected expiry: ${issue.expectedExpiresAt ?? "n/a"}`);
      const latest = issue.transactions[issue.transactions.length - 1];
      if (latest) {
        parts.push(`- Latest tx: ${latest.id} (${latest.status})`);
      }
      return parts.join("\n");
    });

    if (mismatches.length > limit) {
      summary.push(
        `${mismatches.length - limit} more mismatch${mismatches.length - limit === 1 ? "" : "es"
        }. Run \`npm run stars:reconcile\` for a full report.`,
      );
    }

    await respondWithOwnerView(ctx, summary.join("\n\n"), buildOwnerNavigationKeyboard());
  } catch (error) {
    logger.error("owner failed to reconcile stars", { error });
    await respondWithOwnerView(
      ctx,
      "Unable to run reconciliation right now. Please check the server logs.",
      buildOwnerNavigationKeyboard(),
    );
  }
});

bot.action(actionId("ownerIncreaseCredit"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingIncreaseCredit" });
  await respondWithOwnerView(ctx, ownerMessages.increaseCredit, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerDecreaseCredit"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingDecreaseCredit" });
  await respondWithOwnerView(ctx, ownerMessages.decreaseCredit, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerBroadcast"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingBroadcastMessage" });
  await respondWithOwnerView(ctx, ownerMessages.broadcast, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerStatistics"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  const stats = await formatStatisticsSummary();
  await respondWithOwnerView(ctx, `${ownerMessages.statistics}\n\n${stats}`, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerFirewallMenu"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  await ctx.answerCbQuery();
  resetOwnerSession();
  await showOwnerFirewallMenu(ctx);
});

bot.action(actionId("ownerFirewallRefresh"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }
  await ctx.answerCbQuery();
  await showOwnerFirewallMenu(ctx);
});

bot.action(actionId("ownerFirewallAdd"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }
  await ctx.answerCbQuery();
  setOwnerSession({ state: "awaitingFirewallRuleCreate" });
  await respondWithOwnerView(ctx, ownerMessages.firewallPromptCreate, buildOwnerNavigationKeyboard());
});

bot.action(FIREWALL_VIEW_REGEX, async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }
  await ctx.answerCbQuery();
  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? (ctx.callbackQuery as any).data
      : "";
  const match = data.match(FIREWALL_VIEW_REGEX);
  const ruleId = match?.[1];
  if (!ruleId) {
    await showOwnerFirewallMenu(ctx, "Could not determine rule id.");
    return;
  }
  await showOwnerFirewallDetail(ctx, ruleId);
});

bot.action(FIREWALL_TOGGLE_REGEX, async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }
  await ctx.answerCbQuery();
  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? (ctx.callbackQuery as any).data
      : "";
  const match = data.match(FIREWALL_TOGGLE_REGEX);
  const ruleId = match?.[1];
  if (!ruleId) {
    await showOwnerFirewallMenu(ctx, "Could not determine rule id.");
    return;
  }

  const { findFirewallRuleById, upsertFirewallRule } = await import("../server/db/firewallRepository.js");
  const detail = await findFirewallRuleById(ruleId);
  if (!detail) {
    await showOwnerFirewallMenu(ctx, "The selected rule no longer exists.");
    return;
  }

  const summary = mapRuleDetailToSummary(detail);
  const payload = buildPayloadFromStoredRule(summary, { enabled: !summary.enabled }, actorId(ctx));
  await upsertFirewallRule(payload);
  await invalidateFirewallCache(payload.groupChatId ?? summary.chatId ?? null);

  await showOwnerFirewallDetail(
    ctx,
    ruleId,
    summary.enabled ? ownerMessages.firewallToggledOff : ownerMessages.firewallToggledOn,
  );
});

bot.action(FIREWALL_DELETE_REGEX, async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }
  await ctx.answerCbQuery();
  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? (ctx.callbackQuery as any).data
      : "";
  const match = data.match(FIREWALL_DELETE_REGEX);
  const ruleId = match?.[1];
  if (!ruleId) {
    await showOwnerFirewallMenu(ctx, "Could not determine rule id.");
    return;
  }

  const { findFirewallRuleById, deleteFirewallRule } = await import("../server/db/firewallRepository.js");
  const detail = await findFirewallRuleById(ruleId);
  if (!detail) {
    await showOwnerFirewallMenu(ctx, "The selected rule no longer exists.");
    return;
  }

  await deleteFirewallRule(ruleId);
  await invalidateFirewallCache(detail.chatId ?? null);
  resetOwnerSession();
  await showOwnerFirewallMenu(ctx, ownerMessages.firewallDeleted);
});

bot.action(FIREWALL_EDIT_REGEX, async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }
  await ctx.answerCbQuery();
  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? (ctx.callbackQuery as any).data
      : "";
  const match = data.match(FIREWALL_EDIT_REGEX);
  const ruleId = match?.[1];
  if (!ruleId) {
    await showOwnerFirewallMenu(ctx, "Could not determine rule id.");
    return;
  }

  const { findFirewallRuleById } = await import("../server/db/firewallRepository.js");
  const detail = await findFirewallRuleById(ruleId);
  if (!detail) {
    await showOwnerFirewallMenu(ctx, "The selected rule no longer exists.");
    return;
  }

  const summary = mapRuleDetailToSummary(detail);
  setOwnerSession({ state: "awaitingFirewallRuleEdit", pending: { ruleId, chatId: summary.chatId } });

  const editablePayload = {
    id: summary.id,
    name: summary.name,
    scope: summary.scope,
    chatId: summary.scope === "group" ? summary.chatId ?? null : null,
    description: summary.description,
    enabled: summary.enabled,
    priority: summary.priority,
    matchAll: summary.matchAllConditions,
    severity: summary.severity,
    conditions: summary.config.conditions,
    actions: summary.config.actions,
    escalation: summary.config.escalation,
  };

  const message = `${ownerMessages.firewallPromptEdit}\n\n\`\`\`json\n${JSON.stringify(editablePayload, null, 2)}\n\`\`\``;
  await respondWithOwnerView(ctx, message, buildOwnerNavigationKeyboard());
});

bot.action(VERIFY_MEMBER_REGEX, async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {
    // ignore acknowledgement errors
  }

  const data =
    typeof ctx.callbackQuery === "object" &&
      ctx.callbackQuery !== null &&
      "data" in ctx.callbackQuery &&
      typeof (ctx.callbackQuery as any).data === "string"
      ? ((ctx.callbackQuery as any).data as string)
      : "";

  const match = data.match(VERIFY_MEMBER_REGEX);
  const chatIdRaw = match?.[1];
  const userIdRaw = match?.[2];
  if (!chatIdRaw || !userIdRaw) {
    return;
  }

  const clickedUserId = ctx.from?.id;
  const targetUserId = Number.parseInt(userIdRaw, 10);
  if (!clickedUserId || !Number.isFinite(targetUserId) || clickedUserId !== targetUserId) {
    try {
      await ctx.answerCbQuery("This verification button is not assigned to your account.", { show_alert: true });
    } catch {
      // ignore
    }
    return;
  }

  const numericChatId = Number.parseInt(chatIdRaw, 10);
  const chatId = Number.isFinite(numericChatId) ? numericChatId : chatIdRaw;

  try {
    await ctx.telegram.restrictChatMember(
      chatId as any,
      targetUserId,
      {
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
          can_pin_messages: true,
          can_manage_topics: true,
          can_change_info: true,
          can_add_web_page_previews: true,
        },
      } as any,
    );
  } catch (error) {
    logger.warn("failed to lift user verification restrictions", {
      chatId,
      userId: targetUserId,
      error,
    });
    return;
  }

  try {
    const message =
      "✅ You have been verified. You can now send messages in this group.";
    if ("editMessageText" in ctx) {
      await (ctx as any).editMessageText(message);
    } else if (ctx.chat?.id) {
      await ctx.telegram.sendMessage(ctx.chat.id, message);
    }
  } catch {
    // ignore message edit/send failures
  }
});

bot.action(actionId("ownerSettings"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  const settings = getPanelSettings();
  const summary = [
    `Free trial days: ${settings.freeTrialDays}`,
    `Monthly Stars: ${settings.monthlyStars}`,
    `Welcome messages: ${settings.welcomeMessages.length}`,
    `Button labels: ${Object.keys(settings.buttonLabels).length}`
  ].join("\n");
  await respondWithOwnerView(ctx, `${ownerMessages.settingsIntro}\n\n${summary}`, buildOwnerSettingsKeyboard());
});

bot.action(actionId("ownerSettingsFreeDays"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingSettingsFreeDays" });
  await respondWithOwnerView(ctx, ownerMessages.settingsFreeDays, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerSettingsStars"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingSettingsStars" });
  await respondWithOwnerView(ctx, ownerMessages.settingsStars, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerSettingsWelcomeMessages"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingSettingsWelcomeMessages" });
  await respondWithOwnerView(
    ctx,
    `${ownerMessages.settingsWelcomeMessages}\n\nSend messages separated by blank lines. A maximum of four will be stored.`,
    buildOwnerNavigationKeyboard()
  );
});

bot.action(actionId("ownerSettingsGpidHelp"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingSettingsGpidHelp" });
  await respondWithOwnerView(ctx, ownerMessages.settingsGpidHelp, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerSettingsLabels"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingSettingsLabels" });
  await respondWithOwnerView(
    ctx,
    `${ownerMessages.settingsLabels}\n\nExample: {"start_add_to_group":"Invite firewall bot","owner_nav_back":"Previous"}`,
    buildOwnerNavigationKeyboard()
  );
});

bot.action(actionId("ownerSettingsChannelText"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingSettingsChannelText" });
  await respondWithOwnerView(ctx, ownerMessages.settingsChannelText, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerSettingsInfoCommands"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingSettingsInfoCommands" });
  await respondWithOwnerView(ctx, ownerMessages.settingsInfoCommands, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerDailyTask"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingDailyTaskLink" });
  const summary = formatDailyTaskSummary(dailyTaskConfig);
  const message = `${ownerMessages.dailyTaskIntro}

${summary}

${ownerMessages.dailyTaskPromptLink}`;
  await respondWithOwnerView(ctx, message, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerSliderMenu"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  await respondWithOwnerView(ctx, ownerMessages.sliderIntro, buildOwnerSliderKeyboard());
});

bot.action(actionId("ownerSliderView"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  const summary = formatSliderSummary();
  await respondWithOwnerView(ctx, summary, buildOwnerSliderKeyboard());
});

bot.action(actionId("ownerSliderAdd"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingSliderPhoto" });
  await respondWithOwnerView(ctx, ownerMessages.sliderAddPromptPhoto, buildSliderNavigationKeyboard());
});

bot.action(actionId("ownerSliderRemove"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingSliderRemoval" });
  await respondWithOwnerView(ctx, ownerMessages.sliderRemovePrompt, buildSliderNavigationKeyboard());
});

bot.action(actionId("ownerBanMenu"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  await respondWithOwnerView(ctx, ownerMessages.banIntro, buildOwnerBanKeyboard());
});

bot.action(actionId("ownerBanAdd"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingBanUserId" });
  await respondWithOwnerView(ctx, ownerMessages.banAddPrompt, buildBanNavigationKeyboard());
});

bot.action(actionId("ownerBanRemove"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingUnbanUserId" });
  await respondWithOwnerView(ctx, ownerMessages.banRemovePrompt, buildBanNavigationKeyboard());
});

bot.action(actionId("ownerBanList"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  const summary = formatBanSummary();
  await respondWithOwnerView(ctx, summary, buildOwnerBanKeyboard());
});

bot.action(actionId("ownerResetBot"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingResetPassword" });
  await respondWithOwnerView(
    ctx,
    "🔴 <b>Reset Bot Completely</b>\n\n⚠️ This will:\n• Leave all groups\n• Delete all group data\n• Reset bot to fresh state\n\nEnter password to continue:",
    buildOwnerNavigationKeyboard()
  );
});

bot.action(actionId("ownerCreditCodes"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  await respondWithOwnerView(ctx, ownerMessages.creditCodesIntro, buildCreditCodesKeyboard());
});

bot.action(actionId("ownerCreateCreditCode"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingCreateCreditCode" });
  await respondWithOwnerView(ctx, ownerMessages.createCreditCode, buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerListCreditCodes"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  const { listCreditCodes } = await import("./state.js");
  const codes = listCreditCodes();

  if (codes.length === 0) {
    await respondWithOwnerView(ctx, ownerMessages.creditCodesEmpty, buildCreditCodesKeyboard());
    return;
  }

  let message = ownerMessages.creditCodesList + "\n\n";
  codes.forEach((code, index) => {
    const expiryText = code.expiresAt ? `Expires: ${new Date(code.expiresAt).toLocaleDateString()}` : "No expiry";
    message += `${index + 1}. <code>${code.code}</code>\n`;
    message += `   Days: ${code.days} | Uses: ${code.usedCount}/${code.maxUses}\n`;
    message += `   ${expiryText} | Status: ${code.active ? "Active" : "Disabled"}\n\n`;
  });

  await respondWithOwnerView(ctx, message, buildCreditCodesKeyboard());
});

bot.action(actionId("ownerDeleteCreditCode"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  setOwnerSession({ state: "awaitingDeleteCreditCode" });
  await respondWithOwnerView(ctx, "🗑️ <b>Delete Credit Code</b>\n\nSend the credit code you want to delete:", buildOwnerNavigationKeyboard());
});

bot.action(actionId("ownerMainMenu"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  await ctx.answerCbQuery("Main menu opened.");
  await sendStartMenu(ctx);
});

// ============================================
// AD BANNER BROADCAST (FREE GROUPS)
// ============================================

bot.action(actionId("ownerAdBanner"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  const freeGroups = listFreeGroups();
  const groupCount = freeGroups.length;

  if (groupCount === 0) {
    await ctx.answerCbQuery("No free groups available to send ads.", { show_alert: true });
    return;
  }

  setOwnerSession({ state: "awaitingAdBanner" });
  await respondWithOwnerView(
    ctx,
    `📣 <b>Send Ad Banner to Free Groups</b>\n\n` +
    `📊 <b>Target:</b> ${groupCount} free group${groupCount === 1 ? "" : "s"}\n\n` +
    `Please send your promotional content:\n` +
    `• 📝 <b>Text only</b> - Just send a text message\n` +
    `• 🖼️ <b>Photo + Caption</b> - Send a photo with text\n` +
    `• 🎬 <b>Video + Caption</b> - Send a video with text\n\n` +
    `💡 This will be sent to all groups using the FREE plan.`,
    buildOwnerNavigationKeyboard()
  );
});

bot.action(actionId("ownerAdBannerConfirm"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  const session = readOwnerSessionState();
  if (session.state !== "awaitingAdBannerConfirm") {
    await ctx.answerCbQuery("No pending ad banner to send.", { show_alert: true });
    return;
  }

  const pending = session.pending;
  const freeGroups = listFreeGroups();
  const groupCount = freeGroups.length;

  if (groupCount === 0) {
    resetOwnerSession();
    await ctx.answerCbQuery("No free groups available.", { show_alert: true });
    return;
  }

  await ctx.answerCbQuery("Sending ad banner...");
  await ctx.editMessageText("📤 <b>Sending ad banner...</b>\n\nPlease wait...", { parse_mode: "HTML" });

  let successCount = 0;
  let failCount = 0;

  for (const group of freeGroups) {
    try {
      if (pending.contentType === "photo" && pending.fileId) {
        await ctx.telegram.sendPhoto(group.chatId, pending.fileId, {
          caption: pending.content || undefined,
          parse_mode: "HTML",
        });
      } else if (pending.contentType === "video" && pending.fileId) {
        await ctx.telegram.sendVideo(group.chatId, pending.fileId, {
          caption: pending.content || undefined,
          parse_mode: "HTML",
        });
      } else {
        await ctx.telegram.sendMessage(group.chatId, pending.content, {
          parse_mode: "HTML",
        });
      }
      successCount++;
    } catch (error) {
      failCount++;
      logger.warn("failed to send ad banner to group", { chatId: group.chatId, error });
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  resetOwnerSession();

  await ctx.editMessageText(
    `✅ <b>Ad Banner Sent!</b>\n\n` +
    `📊 Results:\n` +
    `• ✅ Sent successfully: ${successCount}\n` +
    `• ❌ Failed: ${failCount}\n` +
    `• 📊 Total: ${groupCount}`,
    { parse_mode: "HTML", reply_markup: buildOwnerPanelKeyboard().reply_markup }
  );

  logger.info("ad banner broadcast completed", { successCount, failCount, totalGroups: groupCount });
});

bot.action(actionId("ownerAdBannerCancel"), async (ctx) => {
  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  resetOwnerSession();
  await ctx.answerCbQuery("Ad banner cancelled.");
  await respondWithOwnerView(ctx, "❌ Ad banner broadcast cancelled.", buildOwnerPanelKeyboard());
});

// ============================================
// FREE/PREMIUM GROUP SETUP CALLBACKS
// ============================================

// Handle "Free with Ads" button click
bot.action(/^group_setup:free:(.+)$/, async (ctx) => {
  const match = ctx.match;
  const chatId = match[1];
  const userId = ctx.from?.id?.toString();

  if (!userId) {
    await ctx.answerCbQuery("Unable to verify your identity.", { show_alert: true });
    return;
  }

  const pendingSetup = getPendingGroupSetup(chatId);
  if (!pendingSetup) {
    await ctx.answerCbQuery("This setup request has expired. Please re-add the bot to the group.", { show_alert: true });
    return;
  }

  // Verify the user is the one who added the bot
  if (pendingSetup.userId !== userId) {
    await ctx.answerCbQuery("Only the person who added the bot can make this choice.", { show_alert: true });
    return;
  }

  // Check if user can add more free groups
  if (!canUserAddFreeGroup(userId)) {
    await ctx.answerCbQuery("You have reached the limit of 3 free groups. Please upgrade to Premium.", { show_alert: true });
    return;
  }

  // Finalize as free group
  const result = finalizeGroupAsFree(chatId, userId, pendingSetup.title);

  if (!result.success) {
    await ctx.answerCbQuery(result.message, { show_alert: true });
    return;
  }

  await ctx.answerCbQuery("Group added as Free!");

  // Update the message
  const freeCount = getUserFreeGroupCount(userId);
  await ctx.editMessageText(
    `✅ <b>Setup Complete!</b>\n\n` +
    `<b>${pendingSetup.title}</b> has been added as a <b>FREE</b> group.\n\n` +
    `📢 <i>Occasional promotional messages will be sent to this group.</i>\n\n` +
    `Your free groups: ${freeCount}/3\n\n` +
    `💡 You can upgrade to Premium anytime from the Mini App to remove ads.`,
    { parse_mode: "HTML" }
  );

  // Send welcome message to the group
  try {
    await ctx.telegram.sendMessage(
      chatId,
      `🛡️ <b>Firewall Bot Activated!</b>\n\n` +
      `This group is now protected with the <b>FREE</b> plan.\n` +
      `All moderation features are active.\n\n` +
      `💡 <i>The group admin can upgrade to Premium from the Mini App to remove promotional messages.</i>`,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    logger.warn("failed to send activation message to group", { chatId, error });
  }

  logger.info("group finalized as free", { chatId, userId, title: pendingSetup.title });
});

// Handle "Get Premium" button click
bot.action(/^group_setup:premium:(.+)$/, async (ctx) => {
  const match = ctx.match;
  const chatId = match[1];
  const userId = ctx.from?.id?.toString();

  if (!userId) {
    await ctx.answerCbQuery("Unable to verify your identity.", { show_alert: true });
    return;
  }

  const pendingSetup = getPendingGroupSetup(chatId);
  if (!pendingSetup) {
    await ctx.answerCbQuery("This setup request has expired. Please re-add the bot to the group.", { show_alert: true });
    return;
  }

  // Verify the user is the one who added the bot
  if (pendingSetup.userId !== userId) {
    await ctx.answerCbQuery("Only the person who added the bot can make this choice.", { show_alert: true });
    return;
  }

  await ctx.answerCbQuery("Redirecting to payment...");

  // Update the message with payment instructions
  await ctx.editMessageText(
    `⭐ <b>Upgrade to Premium</b>\n\n` +
    `Group: <b>${pendingSetup.title}</b>\n\n` +
    `To complete the Premium setup:\n` +
    `1. Open the Mini App below\n` +
    `2. Go to "Renew Group"\n` +
    `3. Select this group and complete the payment\n\n` +
    `Once payment is complete, the bot will be fully activated without any ads!`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Open Mini App", url: miniAppUrl }],
          [{ text: "🆓 Use Free Instead", callback_data: `group_setup:free:${chatId}` }],
        ],
      },
    }
  );

  // Temporarily activate the group (will be deactivated if payment not completed)
  finalizeGroupAsPremium(chatId, userId, pendingSetup.title);

  logger.info("user directed to premium payment", { chatId, userId, title: pendingSetup.title });
});

bot.on("pre_checkout_query", async (ctx) => {
  const query = ctx.update.pre_checkout_query;
  logger.info("received pre_checkout_query", {
    id: query.id,
    payload: query.invoice_payload,
    amount: query.total_amount
  });

  const transactionId = extractTransactionIdFromPayload(query.invoice_payload);
  if (!transactionId) {
    try {
      await ctx.answerPreCheckoutQuery(false, "Unknown transaction reference.");
    } catch (error) {
      logger.error("bot failed to reject pre-checkout query", { error });
    }
    return;
  }

  try {
    await appendStarsTransactionMetadata(transactionId, {
      preCheckoutQueryId: query.id,
      payerTelegramId: query.from.id,
      payerUsername: query.from.username ?? null,
    });
  } catch (error) {
    logger.warn("bot failed to append pre-checkout metadata", { error });
  }

  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (error) {
    logger.error("bot failed to acknowledge pre-checkout query", { error });
  }
});

bot.on("successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const transactionId = extractTransactionIdFromPayload(payment.invoice_payload);
  if (!transactionId) {
    await ctx.reply("Stars payment received, but it could not be matched to a pending transaction. Please contact support.");
    return;
  }

  try {
    await appendStarsTransactionMetadata(transactionId, {
      telegramPaymentChargeId: payment.telegram_payment_charge_id ?? null,
      totalAmount: payment.total_amount,
      currency: payment.currency,
      providerPaymentChargeId: payment.provider_payment_charge_id ?? null,
    });
  } catch (error) {
    logger.warn("bot failed to attach payment metadata to transaction", { error });
  }

  try {
    const result = await finalizeStarsPurchase(transactionId, {
      externalId: payment.telegram_payment_charge_id ?? null,
    });
    const target = result.groupId ? `Group ${result.groupId}` : "your group";
    const days = result.daysAdded > 0 ? `${result.daysAdded} day${result.daysAdded === 1 ? "" : "s"}` : "subscription";
    await ctx.reply(`Stars payment confirmed!\n${days} added to ${target}. Refresh the mini app to view the update.`);
  } catch (error) {
    logger.error("bot failed to finalize Stars transaction", { error });
    await ctx.reply("We received your payment but could not finalize the subscription automatically. Please reach out to support.");
  }
});

bot.on("message", async (ctx, next) => {
  const refunded = (ctx.message as { refunded_payment?: unknown }).refunded_payment as
    | {
      invoice_payload?: string;
      telegram_payment_charge_id?: string;
    }
    | undefined;

  if (refunded) {
    const transactionId = extractTransactionIdFromPayload(refunded.invoice_payload ?? null);
    if (transactionId) {
      try {
        await appendStarsTransactionMetadata(transactionId, {
          telegramRefundChargeId: refunded.telegram_payment_charge_id ?? null,
        });
      } catch (error) {
        logger.warn("bot failed to attach refund metadata", { error });
      }
    }
    await ctx.reply("Your Stars payment has been refunded. The balance should refresh shortly.");
  }

  if (typeof next === "function") {
    await next();
  }
});

bot.on("text", async (ctx, next) => {
  if (isPrivateChat(ctx)) {
    const text = ctx.message?.text ?? "";

    // Check for incoming verification /start deep link (/start -chatId)
    const startMatch = text.match(/^\/start\s+(-?\d+)$/);
    if (startMatch) {
      const chatId = startMatch[1];
      // Handle incoming verification if payload is a negative number (group chat ID)
      if (chatId.startsWith("-")) {
        const handled = await handleIncomingVerificationStart(ctx, chatId);
        if (handled) {
          return; // Don't continue to other handlers
        }
      }
    }

    if (typeof next === "function") {
      await next();
    }
    return;
  }

  const text = ctx.message?.text ?? "";
  if (!text) {
    if (typeof next === "function") {
      await next();
    }
    return;
  }

  const candidate = extractCreditCode(text);
  if (!candidate) {
    if (typeof next === "function") {
      await next();
    }
    return;
  }

  const actorId = ctx.from?.id ? ctx.from.id.toString() : null;
  const chatId = ctx.chat?.id ? ctx.chat.id.toString() : null;
  if (!actorId || !chatId) {
    await ctx.reply("Unable to redeem this code because the chat or user identifier is missing.");
    return;
  }

  try {
    const redemption = await redeemCreditCode({
      code: candidate,
      groupTelegramId: chatId,
      actorTelegramId: actorId,
    });

    await recordGroupCreditRenewal(actorId, {
      source: "credit-code",
      groupId: chatId,
      daysAdded: redemption.valueDays,
    });

    logger.info("credit code redeemed", {
      actorId,
      groupId: chatId,
      valueDays: redemption.valueDays,
    });

    const days = redemption.valueDays;
    await ctx.reply(
      `✅ Credit applied!\n${days} day${days === 1 ? "" : "s"} added to this group. Thanks for keeping Firewall active.`,
    );
  } catch (error) {
    const status = typeof (error as { statusCode?: number }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;

    if (status === 404) {
      await ctx.reply("That code was not recognized. Please check the spelling and try again.");
      return;
    }
    if (status === 409) {
      await ctx.reply("This credit code has already been used or expired.");
      return;
    }
    if (status === 403) {
      await ctx.reply("Only the original purchaser can redeem this code. Share it from your DM and try again.");
      return;
    }

    logger.error("credit code redemption failed", { error, actorId, chatId });
    await ctx.reply("We couldn't apply that code due to an internal error. Please try again later.");
  }
});

bot.on("photo", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    return;
  }

  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) {
    return;
  }

  const bestMatch = photos[photos.length - 1];

  // Handle Ad Banner photo
  if (ownerSession.state === "awaitingAdBanner") {
    const caption = (ctx.message as any).caption ?? "";
    const freeGroupsCount = listFreeGroups().length;

    setOwnerSession({
      state: "awaitingAdBannerConfirm",
      pending: {
        content: caption,
        contentType: "photo",
        fileId: bestMatch.file_id
      }
    });

    await ctx.reply(
      `⚠️ <b>Confirmation Required</b>\n\n` +
      `You are about to send this photo banner to:\n` +
      `📊 <b>${freeGroupsCount}</b> free group${freeGroupsCount === 1 ? "" : "s"}\n\n` +
      `Are you sure you want to proceed?`,
      { parse_mode: "HTML", reply_markup: buildAdBannerConfirmKeyboard().reply_markup }
    );
    return;
  }

  // Handle Slider photo
  if (ownerSession.state === "awaitingSliderPhoto") {
    if (bestMatch.width < REQUIRED_SLIDE_WIDTH || bestMatch.height < REQUIRED_SLIDE_HEIGHT) {
      await ctx.reply(
        `Image will be resized to ${REQUIRED_SLIDE_WIDTH}x${REQUIRED_SLIDE_HEIGHT}. Using a larger photo can improve quality.`,
        buildSliderNavigationKeyboard(),
      );
    }

    setOwnerSession({
      state: "awaitingSliderLink",
      pending: {
        fileId: bestMatch.file_id,
        width: bestMatch.width,
        height: bestMatch.height
      }
    });

    await ctx.reply(ownerMessages.sliderAwaitLink, buildSliderNavigationKeyboard());
    return;
  }
});

// Handle video messages for Ad Banner
bot.on("video", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    return;
  }

  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  const video = ctx.message.video;
  if (!video) {
    return;
  }

  // Handle Ad Banner video
  if (ownerSession.state === "awaitingAdBanner") {
    const caption = (ctx.message as any).caption ?? "";
    const freeGroupsCount = listFreeGroups().length;

    setOwnerSession({
      state: "awaitingAdBannerConfirm",
      pending: {
        content: caption,
        contentType: "video",
        fileId: video.file_id
      }
    });

    await ctx.reply(
      `⚠️ <b>Confirmation Required</b>\n\n` +
      `You are about to send this video banner to:\n` +
      `📊 <b>${freeGroupsCount}</b> free group${freeGroupsCount === 1 ? "" : "s"}\n\n` +
      `Are you sure you want to proceed?`,
      { parse_mode: "HTML", reply_markup: buildAdBannerConfirmKeyboard().reply_markup }
    );
    return;
  }
});

bot.on("text", async (ctx, next) => {
  if (!isPrivateChat(ctx)) {
    return next();
  }

  const userId = ctx.from?.id?.toString();
  if (!userId) return next();

  const session = getInlineSession(userId);
  if (!session) return next();

  const text = ctx.message.text.trim();

  // Handle cancellation
  if (text === "/cancel") {
    clearInlineSession(userId);
    await ctx.reply("Operation cancelled.", Markup.inlineKeyboard([
      [Markup.button.callback("◀️ Back to List", `fw_inline_list:${session.chatId}:${session.listId}`)]
    ]));
    return;
  }

  if (session.step === "awaiting_add_input") {
    const listId = session.listId;
    const chatId = session.chatId;

    try {
      if (listId === "filters" || listId === "whitelist") {
        const settings = await loadBanSettingsByChatId(chatId);
        const items = text.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);

        if (items.length === 0) {
          await ctx.reply("Please send at least one valid word.");
          return;
        }

        let addedCount = 0;
        if (listId === "filters") {
          const current = new Set(settings.blacklist);
          for (const item of items) {
            if (!current.has(item)) {
              settings.blacklist.push(item);
              addedCount++;
            }
          }
        } else {
          const current = new Set(settings.whitelist);
          for (const item of items) {
            if (!current.has(item)) {
              settings.whitelist.push(item);
              addedCount++;
            }
          }
        }

        if (addedCount > 0) {
          await saveBanSettingsByChatId(chatId, settings);
          await ctx.reply(`✅ Successfully added ${addedCount} item(s) to ${listId}.`, Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
          ]));
        } else {
          await ctx.reply("⚠️ All items were already in the list.", Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
          ]));
        }
      } else if (listId === "vip") {
        // Add VIP member to banSettings
        const settings = await loadBanSettingsByChatId(chatId);
        const rawSettings = settings as unknown as Record<string, unknown>;

        // Initialize vipMembers array if not exists
        if (!Array.isArray(rawSettings.vipMembers)) {
          rawSettings.vipMembers = [];
        }

        const vipMembers = rawSettings.vipMembers as string[];
        const trimmedInput = text.trim();

        // Check if already exists
        if (vipMembers.includes(trimmedInput)) {
          await ctx.reply("⚠️ This user is already a VIP member.", Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
          ]));
        } else {
          vipMembers.push(trimmedInput);
          await saveBanSettingsByChatId(chatId, settings);
          await ctx.reply(`✅ Successfully added VIP member: ${trimmedInput}\n\n💡 VIP members bypass all content restrictions.`, Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
          ]));
        }
      } else if (listId === "exempt") {
        // Add exempt user to banSettings
        const settings = await loadBanSettingsByChatId(chatId);
        const rawSettings = settings as unknown as Record<string, unknown>;

        // Initialize exemptUsers array if not exists
        if (!Array.isArray(rawSettings.exemptUsers)) {
          rawSettings.exemptUsers = [];
        }

        const exemptUsers = rawSettings.exemptUsers as string[];
        const trimmedInput = text.trim();

        // Check if already exists
        if (exemptUsers.includes(trimmedInput)) {
          await ctx.reply("⚠️ This user is already exempt.", Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
          ]));
        } else {
          exemptUsers.push(trimmedInput);
          await saveBanSettingsByChatId(chatId, settings);
          await ctx.reply(`✅ Successfully added exempt user: ${trimmedInput}\n\n💡 Exempt users bypass content restrictions.`, Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
          ]));
        }
      } else if (listId === "forward_whitelist") {
        // Add forward whitelist channel to banSettings
        const settings = await loadBanSettingsByChatId(chatId);
        const rawSettings = settings as unknown as Record<string, unknown>;

        // Initialize forwardWhitelist array if not exists
        if (!Array.isArray(rawSettings.forwardWhitelist)) {
          rawSettings.forwardWhitelist = [];
        }

        const forwardWhitelist = rawSettings.forwardWhitelist as string[];
        let trimmedInput = text.trim();

        // Normalize channel username - ensure it starts with @
        if (!trimmedInput.startsWith("@") && !trimmedInput.startsWith("-")) {
          trimmedInput = "@" + trimmedInput;
        }

        // Check if already exists
        if (forwardWhitelist.includes(trimmedInput)) {
          await ctx.reply("⚠️ This channel is already in the forward whitelist.", Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
          ]));
        } else {
          forwardWhitelist.push(trimmedInput);
          await saveBanSettingsByChatId(chatId, settings);
          await ctx.reply(`✅ Successfully added to forward whitelist: ${trimmedInput}\n\n💡 Messages forwarded from this channel won't be blocked.`, Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
          ]));
        }
      } else if (listId === "banned" || listId === "muted") {
        const targetUserId = parseInt(text.trim(), 10);
        if (isNaN(targetUserId)) {
          await ctx.reply("⚠️ Invalid User ID. Please send a numeric User ID.", Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
          ]));
        } else {
          try {
            const numericChatId = parseInt(chatId, 10);
            if (listId === "banned") {
              await ctx.telegram.banChatMember(numericChatId, targetUserId);
              await ctx.reply(`✅ Successfully banned user ${targetUserId}.`, Markup.inlineKeyboard([
                [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
              ]));
            } else {
              // Mute (restrict permissions)
              await ctx.telegram.restrictChatMember(numericChatId, targetUserId, {
                permissions: {
                  can_send_messages: false,
                  can_send_audios: false,
                  can_send_documents: false,
                  can_send_photos: false,
                  can_send_videos: false,
                  can_send_video_notes: false,
                  can_send_voice_notes: false,
                  can_send_polls: false,
                  can_send_other_messages: false,
                  can_add_web_page_previews: false,
                  can_change_info: false,
                  can_invite_users: false,
                  can_pin_messages: false,
                  can_manage_topics: false,
                }
              });
              await ctx.reply(`✅ Successfully muted user ${targetUserId}.`, Markup.inlineKeyboard([
                [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
              ]));
            }
          } catch (error) {
            logger.error(`Failed to ${listId} user via inline panel`, { chatId, targetUserId, error });
            await ctx.reply(`❌ Failed to ${listId} user. Ensure the bot is an admin and the user ID is valid.\nError: ${(error as Error).message}`, Markup.inlineKeyboard([
              [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
            ]));
          }
        }
      } else {
        await ctx.reply("This list does not support adding items yet.", Markup.inlineKeyboard([
          [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:${listId}`)]
        ]));
      }
    } catch (error) {
      logger.error("Failed to add item to list", { chatId, listId, error });
      await ctx.reply("❌ An error occurred while saving. Please try again.");
    }

    clearInlineSession(userId);
    return;
  }

  // Handle auto-reply step 1: trigger keyword
  if (session.step === "awaiting_auto_reply_trigger") {
    const chatId = session.chatId;
    const trigger = text.trim();

    if (!trigger) {
      await ctx.reply("⚠️ Please enter a valid trigger keyword.");
      return;
    }

    // Store trigger and move to next step
    setInlineSession(userId, {
      ...session,
      step: "awaiting_auto_reply_response",
      tempData: { ...session.tempData, trigger }
    });

    await ctx.reply(
      `📝 **Step 2/2: Enter Response**\n\n` +
      `Trigger: \`${trigger}\`\n\n` +
      `Now send the response message that will be sent when someone types "${trigger}".`,
      {
        parse_mode: "Markdown", reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("◀️ Cancel", `fw_inline_list:${chatId}:auto_replies`)]
        ]).reply_markup
      }
    );
    return;
  }

  // Handle auto-reply step 2: response text
  if (session.step === "awaiting_auto_reply_response") {
    const chatId = session.chatId;
    const trigger = session.tempData?.trigger;
    const response = text.trim();

    if (!trigger) {
      clearInlineSession(userId);
      await ctx.reply("⚠️ Session expired. Please try again.", Markup.inlineKeyboard([
        [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:auto_replies`)]
      ]));
      return;
    }

    if (!response) {
      await ctx.reply("⚠️ Please enter a valid response message.");
      return;
    }

    try {
      const settings = await loadBanSettingsByChatId(chatId);
      const rawSettings = settings as unknown as Record<string, unknown>;

      if (!Array.isArray(rawSettings.autoReplies)) {
        rawSettings.autoReplies = [];
      }

      const autoReplies = rawSettings.autoReplies as Array<{ trigger: string; response: string; enabled: boolean }>;

      // Check if trigger already exists
      const existingIndex = autoReplies.findIndex(ar => ar.trigger.toLowerCase() === trigger.toLowerCase());
      if (existingIndex >= 0) {
        // Update existing
        autoReplies[existingIndex].response = response;
      } else {
        // Add new
        autoReplies.push({ trigger, response, enabled: true });
      }

      await saveBanSettingsByChatId(chatId, settings);

      await ctx.reply(
        `✅ Auto-reply saved!\n\n` +
        `🔑 Trigger: \`${trigger}\`\n` +
        `💬 Response: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`,
        {
          parse_mode: "Markdown", reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:auto_replies`)]
          ]).reply_markup
        }
      );
    } catch (error) {
      logger.error("Failed to save auto-reply", { chatId, trigger, error });
      await ctx.reply("❌ Failed to save auto-reply. Please try again.", Markup.inlineKeyboard([
        [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:auto_replies`)]
      ]));
    }

    clearInlineSession(userId);
    return;
  }

  // Handle scheduled post step 1: message content
  if (session.step === "awaiting_scheduled_message") {
    const chatId = session.chatId;
    const message = text.trim();

    if (!message) {
      await ctx.reply("⚠️ Please enter a valid message.");
      return;
    }

    // Store message and move to next step
    setInlineSession(userId, {
      ...session,
      step: "awaiting_scheduled_time",
      tempData: { ...session.tempData, scheduledMessage: message }
    });

    await ctx.reply(
      `📝 **Step 2/2: Set Schedule**\n\n` +
      `Message preview: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}\n\n` +
      `Now send the schedule time in one of these formats:\n\n` +
      `• \`HH:MM\` - Daily at this time (24h format)\n` +
      `• \`Monday 14:00\` - Weekly on specific day\n` +
      `• \`2024-12-25 10:00\` - One-time on specific date\n\n` +
      `Example: \`09:00\` or \`Friday 18:30\``,
      {
        parse_mode: "Markdown", reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("◀️ Cancel", `fw_inline_list:${chatId}:scheduled_posts`)]
        ]).reply_markup
      }
    );
    return;
  }

  // Handle scheduled post step 2: schedule time
  if (session.step === "awaiting_scheduled_time") {
    const chatId = session.chatId;
    const scheduledMessage = session.tempData?.scheduledMessage;
    const scheduleInput = text.trim();

    if (!scheduledMessage) {
      clearInlineSession(userId);
      await ctx.reply("⚠️ Session expired. Please try again.", Markup.inlineKeyboard([
        [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:scheduled_posts`)]
      ]));
      return;
    }

    if (!scheduleInput) {
      await ctx.reply("⚠️ Please enter a valid schedule time.");
      return;
    }

    // Parse schedule input
    let scheduleType: "daily" | "weekly" | "once" = "daily";
    let scheduleTime = scheduleInput;
    let scheduleDayOfWeek: number | undefined;
    let scheduleDate: string | undefined;

    // Check for weekly format (e.g., "Monday 14:00")
    const weeklyMatch = scheduleInput.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2}:\d{2})$/i);
    if (weeklyMatch) {
      const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      scheduleDayOfWeek = dayNames.indexOf(weeklyMatch[1].toLowerCase());
      scheduleTime = weeklyMatch[2];
      scheduleType = "weekly";
    }
    // Check for one-time format (e.g., "2024-12-25 10:00")
    else if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(scheduleInput)) {
      const parts = scheduleInput.split(/\s+/);
      scheduleDate = parts[0];
      scheduleTime = parts[1];
      scheduleType = "once";
    }
    // Default to daily format (e.g., "14:00")
    else if (!/^\d{1,2}:\d{2}$/.test(scheduleInput)) {
      await ctx.reply("⚠️ Invalid format. Please use HH:MM, 'Monday 14:00', or '2024-12-25 10:00'.");
      return;
    }

    try {
      const settings = await loadBanSettingsByChatId(chatId);
      const rawSettings = settings as unknown as Record<string, unknown>;

      if (!Array.isArray(rawSettings.scheduledPosts)) {
        rawSettings.scheduledPosts = [];
      }

      const scheduledPosts = rawSettings.scheduledPosts as Array<{
        id: string;
        message: string;
        scheduleType: string;
        scheduleTime: string;
        scheduleDayOfWeek?: number;
        scheduleDate?: string;
        enabled: boolean;
      }>;

      // Generate unique ID
      const newId = `sp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      scheduledPosts.push({
        id: newId,
        message: scheduledMessage,
        scheduleType,
        scheduleTime,
        scheduleDayOfWeek,
        scheduleDate,
        enabled: true
      });

      await saveBanSettingsByChatId(chatId, settings);

      let scheduleDisplay = scheduleTime;
      if (scheduleType === "weekly") {
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        scheduleDisplay = `${dayNames[scheduleDayOfWeek!]} at ${scheduleTime}`;
      } else if (scheduleType === "once") {
        scheduleDisplay = `${scheduleDate} at ${scheduleTime}`;
      } else {
        scheduleDisplay = `Daily at ${scheduleTime}`;
      }

      await ctx.reply(
        `✅ Scheduled post created!\n\n` +
        `📅 Schedule: ${scheduleDisplay}\n` +
        `💬 Message: ${scheduledMessage.substring(0, 100)}${scheduledMessage.length > 100 ? '...' : ''}`,
        {
          parse_mode: "Markdown", reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:scheduled_posts`)]
          ]).reply_markup
        }
      );
    } catch (error) {
      logger.error("Failed to save scheduled post", { chatId, scheduleInput, error });
      await ctx.reply("❌ Failed to save scheduled post. Please try again.", Markup.inlineKeyboard([
        [Markup.button.callback("◀️ Back to List", `fw_inline_list:${chatId}:scheduled_posts`)]
      ]));
    }

    clearInlineSession(userId);
    return;
  }

  return next();
});

bot.on("text", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    return;
  }

  const text = ctx.message.text.trim();
  const userId = ctx.from?.id?.toString();

  // Check for welcome config session (before owner check so all admins can use it)
  if (userId && welcomeConfigSessions.has(userId)) {
    const session = welcomeConfigSessions.get(userId)!;
    welcomeConfigSessions.delete(userId);

    try {
      const settings = await loadGeneralSettingsByChatId(session.chatId);
      const rawSettings = settings as Record<string, unknown>;

      if (!rawSettings.welcomeSettings) {
        rawSettings.welcomeSettings = {};
      }
      const welcomeSettings = rawSettings.welcomeSettings as Record<string, unknown>;

      if (text.toLowerCase() === "default") {
        welcomeSettings.customMessage = "";
        await saveGeneralSettingsByChatId(session.chatId, settings);
        await ctx.reply("✅ Welcome message reset to default!", {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to Welcome Settings", `fw_adv_welcome:${session.chatId}`)]
          ]).reply_markup
        });
      } else {
        welcomeSettings.customMessage = text;
        await saveGeneralSettingsByChatId(session.chatId, settings);
        await ctx.reply("✅ Welcome message updated successfully!", {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to Welcome Settings", `fw_adv_welcome:${session.chatId}`)]
          ]).reply_markup
        });
      }
    } catch (error) {
      logger.error("Failed to save welcome message", { chatId: session.chatId, error });
      await ctx.reply("❌ Failed to save welcome message. Please try again.");
    }
    return;
  }

  // Check for mandatory join message config session
  if (userId && mandatoryJoinMessageSessions.has(userId)) {
    const session = mandatoryJoinMessageSessions.get(userId)!;
    mandatoryJoinMessageSessions.delete(userId);

    try {
      const settings = await loadBanSettingsByChatId(session.chatId);
      const rawSettings = settings as unknown as Record<string, unknown>;

      if (!rawSettings.mandatoryJoinSettings) {
        rawSettings.mandatoryJoinSettings = {};
      }
      const mjSettings = rawSettings.mandatoryJoinSettings as Record<string, unknown>;

      if (text.toLowerCase() === "default") {
        mjSettings.customMessage = "";
        await saveBanSettingsByChatId(session.chatId, settings);
        await ctx.reply("✅ Membership message reset to default!", {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to Mandatory Join Settings", `fw_adv_mandatory_join:${session.chatId}`)]
          ]).reply_markup
        });
      } else {
        mjSettings.customMessage = text;
        await saveBanSettingsByChatId(session.chatId, settings);
        await ctx.reply("✅ Membership message updated successfully!", {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Back to Mandatory Join Settings", `fw_adv_mandatory_join:${session.chatId}`)]
          ]).reply_markup
        });
      }
    } catch (error) {
      logger.error("Failed to save mandatory join message", { chatId: session.chatId, error });
      await ctx.reply("❌ Failed to save message. Please try again.");
    }
    return;
  }

  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  switch (ownerSession.state) {
    case "awaitingAddAdmin": {
      const userId = parseNumericUserId(text);
      if (!userId) {
        await ctx.reply("The user id must contain digits only. Please try again.", buildOwnerNavigationKeyboard());
        return;
      }

      if (userId === ownerUserId) {
        await ctx.reply("The bot owner already has full access.", buildOwnerNavigationKeyboard());
        return;
      }

      if (isPanelAdmin(userId)) {
        await ctx.reply("That user is already a panel admin.", buildOwnerNavigationKeyboard());
        return;
      }

      addPanelAdmin(userId);
      resetOwnerSession();
      await ctx.reply(
        `User ${userId} added as panel administrator.\n\n${formatAdminsSummary()}`,
        buildOwnerAdminsKeyboard()
      );
      return;
    }
    case "awaitingRemoveAdmin": {
      const userId = parseNumericUserId(text);
      if (!userId) {
        await ctx.reply("The user id must contain digits only. Please try again.", buildOwnerNavigationKeyboard());
        return;
      }

      if (!isPanelAdmin(userId)) {
        await ctx.reply("That user is not currently a panel admin.", buildOwnerNavigationKeyboard());
        return;
      }

      removePanelAdmin(userId);
      resetOwnerSession();
      await ctx.reply(
        `User ${userId} removed from the admin list.\n\n${formatAdminsSummary()}`,
        buildOwnerAdminsKeyboard()
      );
      return;
    }
    case "awaitingManageGroup": {
      const parsed = extractChatIdAndPayload(text);
      if (!parsed) {
        await ctx.reply(
          "Send the chat_id (e.g. -1001234567890) optionally followed by the group title.",
          buildOwnerNavigationKeyboard()
        );
        return;
      }

      const record = upsertGroup({
        chatId: parsed.chatId,
        title: parsed.payload || undefined
      });
      resetOwnerSession();
      await ctx.reply(
        `Group updated:\n${record.title} (${record.chatId})\nCredit balance: ${record.creditBalance}\nUpdated: ${record.updatedAt}`,
        buildOwnerNavigationKeyboard()
      );
      return;
    }
    case "awaitingIncreaseCredit": {
      const parsed = parseCreditPayload(text);
      if (!parsed) {
        await ctx.reply("Send chat_id and positive amount separated by a space.", buildOwnerNavigationKeyboard());
        return;
      }
      const existing = getState().groups[parsed.chatId];
      const beforeBalance = existing?.creditBalance ?? 0;
      const record = upsertGroup({
        chatId: parsed.chatId,
        creditDelta: parsed.amount,
        note: `Manual increase by ${actorId(ctx) ?? "owner"}`
      });
      await auditCreditAdjustment({
        chatId: parsed.chatId,
        actorId: actorId(ctx),
        delta: parsed.amount,
        beforeBalance,
        afterBalance: record.creditBalance,
      });
      resetOwnerSession();
      await ctx.reply(
        `Credit increased for ${record.title} (${record.chatId}).\nNew balance: ${record.creditBalance}`,
        buildOwnerNavigationKeyboard()
      );
      return;
    }
    case "awaitingDecreaseCredit": {
      const parsed = parseCreditPayload(text);
      if (!parsed) {
        await ctx.reply("Send chat_id and positive amount separated by a space.", buildOwnerNavigationKeyboard());
        return;
      }
      const existing = getState().groups[parsed.chatId];
      const beforeBalance = existing?.creditBalance ?? 0;
      const record = upsertGroup({
        chatId: parsed.chatId,
        creditDelta: -parsed.amount,
        note: `Manual decrease by ${actorId(ctx) ?? "owner"}`
      });
      await auditCreditAdjustment({
        chatId: parsed.chatId,
        actorId: actorId(ctx),
        delta: -parsed.amount,
        beforeBalance,
        afterBalance: record.creditBalance,
      });
      resetOwnerSession();
      await ctx.reply(
        `Credit decreased for ${record.title} (${record.chatId}).\nNew balance: ${record.creditBalance}`,
        buildOwnerNavigationKeyboard()
      );
      return;
    }
    case "awaitingAdBanner": {
      if (text.length < 5) {
        await ctx.reply("Please send a longer message or a photo with caption.", buildOwnerNavigationKeyboard());
        return;
      }

      const freeGroupsCount = listFreeGroups().length;
      setOwnerSession({
        state: "awaitingAdBannerConfirm",
        pending: { content: text, contentType: "text" }
      });
      await ctx.reply(
        `⚠️ <b>Confirmation Required</b>\n\n` +
        `You are about to send this ad banner to:\n` +
        `📊 <b>${freeGroupsCount}</b> free group${freeGroupsCount === 1 ? "" : "s"}\n\n` +
        `Are you sure you want to proceed?`,
        { parse_mode: "HTML", reply_markup: buildAdBannerConfirmKeyboard().reply_markup }
      );
      return;
    }
    case "awaitingBroadcastMessage": {
      if (text.length < 5) {
        await ctx.reply("Please send a longer message.", buildOwnerNavigationKeyboard());
        return;
      }

      setOwnerSession({
        state: "awaitingBroadcastConfirm",
        pending: { message: text }
      });
      await ctx.reply(
        "Send YES to confirm the broadcast or CANCEL to abort.",
        buildOwnerNavigationKeyboard()
      );
      return;
    }
    case "awaitingBroadcastConfirm": {
      const pending = ownerSession.pending;
      const decision = text.toLowerCase();
      if (["cancel", "no", "abort", "stop"].includes(decision)) {
        resetOwnerSession();
        await ctx.reply("Broadcast cancelled.", buildOwnerNavigationKeyboard());
        return;
      }

      if (!["yes", "confirm", "send"].includes(decision)) {
        await ctx.reply("Type YES to confirm or CANCEL to abort.", buildOwnerNavigationKeyboard());
        return;
      }

      const groups = listGroups();
      if (groups.length === 0) {
        resetOwnerSession();
        await ctx.reply("No groups are registered yet.", buildOwnerNavigationKeyboard());
        return;
      }

      const failures: string[] = [];
      let sent = 0;
      for (const group of groups) {
        try {
          await bot.telegram.sendMessage(group.chatId, pending.message);
          sent += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          failures.push(`${group.chatId}: ${reason}`);
        }
      }

      recordBroadcast(pending.message);
      resetOwnerSession();

      let response = `Broadcast sent to ${sent} group(s).`;
      if (failures.length > 0) {
        response += `\nFailed deliveries (${failures.length}):\n${failures.join("\n")}`;
      }
      await ctx.reply(response, buildOwnerNavigationKeyboard());
      return;
    }
    case "awaitingSettingsFreeDays": {
      const value = Number.parseInt(text, 10);
      if (!Number.isFinite(value) || value < 0 || value > 365) {
        await ctx.reply("Send a number between 0 and 365.", buildOwnerNavigationKeyboard());
        return;
      }
      setPanelSettings({ freeTrialDays: value });
      resetOwnerSession();
      await ctx.reply(`Free trial days updated to ${value}.`, buildOwnerSettingsKeyboard());
      return;
    }
    case "awaitingSettingsStars": {
      const value = Number.parseInt(text, 10);
      if (!Number.isFinite(value) || value < 0 || value > 10_000) {
        await ctx.reply("Send a non-negative integer.", buildOwnerNavigationKeyboard());
        return;
      }
      setPanelSettings({ monthlyStars: value });
      resetOwnerSession();
      await ctx.reply(`Monthly Stars quota updated to ${value}.`, buildOwnerSettingsKeyboard());
      return;
    }
    case "awaitingSettingsWelcomeMessages": {
      const entries = text
        .split(/\n\s*\n/)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .slice(0, 4);
      if (entries.length === 0) {
        await ctx.reply("Send at least one welcome message.", buildOwnerNavigationKeyboard());
        return;
      }
      setWelcomeMessages(entries);
      resetOwnerSession();
      await ctx.reply(`Stored ${entries.length} welcome message(s).`, buildOwnerSettingsKeyboard());
      return;
    }
    case "awaitingSettingsGpidHelp": {
      setPanelSettings({ gpidHelpText: text });
      resetOwnerSession();
      await ctx.reply("GPID help text updated.", buildOwnerSettingsKeyboard());
      return;
    }
    case "awaitingSettingsLabels": {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("Labels must be an object.");
        }
        const labels = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, String(value)])
        );
        setButtonLabels(labels);
        resetOwnerSession();
        await ctx.reply(`Stored ${Object.keys(labels).length} button label(s).`, buildOwnerSettingsKeyboard());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.reply(`Could not parse JSON: ${message}`, buildOwnerNavigationKeyboard());
      }
      return;
    }
    case "awaitingSettingsChannelText": {
      setPanelSettings({ channelAnnouncement: text });
      resetOwnerSession();
      await ctx.reply("Channel announcement updated.", buildOwnerSettingsKeyboard());
      return;
    }
    case "awaitingSettingsInfoCommands": {
      setPanelSettings({ infoCommands: text });
      resetOwnerSession();
      await ctx.reply("Info and commands text updated.", buildOwnerSettingsKeyboard());
      return;
    }
    case "awaitingFirewallRuleCreate": {
      await handleFirewallRuleInput(ctx, text, { mode: "create" });
      return;
    }
    case "awaitingFirewallRuleEdit": {
      const pending = ownerSession.pending;
      await handleFirewallRuleInput(ctx, text, { mode: "edit", ruleId: pending.ruleId, chatId: pending.chatId });
      return;
    }
    case "awaitingResetPassword": {
      if (text !== "0706203830") {
        await ctx.reply("❌ Incorrect password. Try again or use /panel to go back.", buildOwnerNavigationKeyboard());
        return;
      }

      // Count current groups
      const state = getState();
      const groupCount = Object.keys(state.groups).length;

      setOwnerSession({
        state: "awaitingResetConfirm",
        pending: { groupCount }
      });

      await ctx.reply(
        `✅ Password correct.\n\n⚠️ <b>FINAL WARNING</b>\n\nThis will:\n• Leave ${groupCount} groups\n• Delete ALL group data\n• Reset bot completely\n\nType "تایید می‌کنم" to confirm or /panel to cancel:`,
        buildOwnerNavigationKeyboard()
      );
      return;
    }
    case "awaitingResetConfirm": {
      if (text !== "تایید می‌کنم") {
        await ctx.reply("❌ Confirmation phrase incorrect. Type exactly: تایید می‌کنم\n\nOr use /panel to cancel.", buildOwnerNavigationKeyboard());
        return;
      }

      await ctx.reply("🔄 Starting bot reset process...");

      try {
        // Call the reset API
        const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/reset-bot`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ownerTelegramId: ownerUserId,
            confirmationCode: "RESET_CONFIRMED"
          })
        });

        if (!response.ok) {
          throw new Error(`Reset failed: ${response.statusText}`);
        }

        const result = await response.json();
        resetOwnerSession();

        await ctx.reply(
          `✅ <b>Bot Reset Complete!</b>\n\n` +
          `• Left ${result.groupsLeft || 0} groups\n` +
          `• Deleted ${result.recordsDeleted || 0} database records\n` +
          `• Reset bot state successfully\n\n` +
          `Bot is now in fresh state. Use /panel to access owner controls.`
        );

      } catch (error) {
        resetOwnerSession();
        const message = error instanceof Error ? error.message : String(error);
        await ctx.reply(
          `❌ <b>Reset Failed!</b>\n\n${message}\n\nPlease try again or contact support.`,
          buildOwnerPanelKeyboard()
        );
      }
      return;
    }
    case "awaitingDailyTaskLink": {
      const normalizedLink = normalizeChannelLink(text);
      if (!normalizedLink) {
        await ctx.reply(ownerMessages.dailyTaskLinkInvalid, buildOwnerNavigationKeyboard());
        return;
      }

      setOwnerSession({ state: "awaitingDailyTaskButton", pending: { channelLink: normalizedLink } });
      await ctx.reply(ownerMessages.dailyTaskPromptButton, buildOwnerNavigationKeyboard());
      return;
    }
    case "awaitingDailyTaskButton": {
      const pending = ownerSession.pending;
      setOwnerSession({
        state: "awaitingDailyTaskDescription",
        pending: {
          channelLink: pending.channelLink,
          buttonLabel: text
        }
      });
      await ctx.reply(ownerMessages.dailyTaskPromptDescription, buildOwnerNavigationKeyboard());
      return;
    }
    case "awaitingDailyTaskDescription": {
      const pending = ownerSession.pending;
      setOwnerSession({
        state: "awaitingDailyTaskXp",
        pending: {
          channelLink: pending.channelLink,
          buttonLabel: pending.buttonLabel,
          description: text
        }
      });
      await ctx.reply(ownerMessages.dailyTaskPromptXp, buildOwnerNavigationKeyboard());
      return;
    }
    case "awaitingDailyTaskXp": {
      const xpValue = Number.parseInt(text, 10);
      if (!Number.isFinite(xpValue) || xpValue <= 0) {
        await ctx.reply(ownerMessages.dailyTaskXpInvalid, buildOwnerNavigationKeyboard());
        return;
      }

      const pending = ownerSession.pending;
      const config: DailyTaskConfig = {
        channelLink: pending.channelLink,
        buttonLabel: pending.buttonLabel,
        description: pending.description,
        xp: xpValue,
        updatedAt: new Date().toISOString()
      };

      dailyTaskConfig = config;
      saveDailyTaskConfig(config);
      resetOwnerSession();

      const summary = formatDailyTaskSummary(dailyTaskConfig);
      await ctx.reply(`${ownerMessages.dailyTaskSaved}

${summary}`, buildOwnerNavigationKeyboard());
      return;
    }
    case "awaitingSliderLink": {
      const pending = ownerSession.pending;
      if (!pending || typeof pending.fileId !== "string") {
        await ctx.reply(ownerMessages.sliderMissingPhoto, buildSliderNavigationKeyboard());
        resetOwnerSession();
        return;
      }

      try {
        const record = await createPromoSlide({
          id: nextPromoSlideId(),
          fileId: pending.fileId,
          linkUrl: text,
          createdBy: ownerUserId ?? ctx.from?.id?.toString() ?? null,
          metadata: {
            source: "bot-owner-flow",
          },
        });
        addPromoSlide(record, { persist: false });
        resetOwnerSession();
        await ctx.reply(
          `Promo slide ${record.id} saved.
Link: ${record.linkUrl ?? "G??"}
Image: ${record.imageUrl}`,
          buildOwnerSliderKeyboard(),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save promo slide";
        await ctx.reply(`Unable to store promo slide: ${message}`, buildSliderNavigationKeyboard());
      }
      resetOwnerSession();
      return;
    }
    case "awaitingSliderRemoval": {
      const targetId = text.trim();
      const slides = getPromoSlides();
      if (!slides.some((slide) => slide.id === targetId)) {
        await ctx.reply(ownerMessages.sliderRemoveMissing, buildSliderNavigationKeyboard());
        return;
      }

      removePromoSlide(targetId);
      resetOwnerSession();

      await ctx.reply(`Promo slide ${targetId} removed.`, buildOwnerSliderKeyboard());
      return;
    }
    case "awaitingBanUserId": {
      const userId = parseNumericUserId(text);
      if (!userId) {
        await ctx.reply("The user id must contain digits only. Please try again.", buildBanNavigationKeyboard());
        return;
      }

      if (userId === ownerUserId) {
        await ctx.reply("The bot owner cannot be banned.", buildBanNavigationKeyboard());
        return;
      }

      addBannedUser(userId);
      removePanelAdmin(userId);
      resetOwnerSession();

      await ctx.reply(`User ${userId} has been banned from the panel.`, buildOwnerBanKeyboard());
      return;
    }
    case "awaitingUnbanUserId": {
      const userId = parseNumericUserId(text);
      if (!userId) {
        await ctx.reply("The user id must contain digits only. Please try again.", buildBanNavigationKeyboard());
        return;
      }

      if (!isUserBanned(userId)) {
        await ctx.reply(ownerMessages.banNotFound, buildBanNavigationKeyboard());
        return;
      }

      removeBannedUser(userId);
      resetOwnerSession();

      await ctx.reply(`User ${userId} has been removed from the ban list.`, buildOwnerBanKeyboard());
      return;
    }
    case "awaitingCreateCreditCode": {
      // Parse format: days maxUses [expiryDays]
      // Example: 30 5 or 30 5 90
      const parts = text.trim().split(/\s+/);
      if (parts.length < 2) {
        await ctx.reply(
          "❌ Invalid format.\n\nPlease send: <code>days maxUses [expiryDays]</code>\n\nExamples:\n• <code>30 5</code> - 30 days, 5 uses, no expiry\n• <code>30 5 90</code> - 30 days, 5 uses, expires in 90 days",
          { parse_mode: "HTML", ...buildOwnerNavigationKeyboard() }
        );
        return;
      }

      const days = Number.parseInt(parts[0], 10);
      const maxUses = Number.parseInt(parts[1], 10);
      const expiryDays = parts[2] ? Number.parseInt(parts[2], 10) : undefined;

      if (!Number.isFinite(days) || days <= 0 || days > 365) {
        await ctx.reply("❌ Days must be between 1 and 365.", buildOwnerNavigationKeyboard());
        return;
      }

      if (!Number.isFinite(maxUses) || maxUses <= 0 || maxUses > 1000) {
        await ctx.reply("❌ Max uses must be between 1 and 1000.", buildOwnerNavigationKeyboard());
        return;
      }

      if (expiryDays !== undefined && (!Number.isFinite(expiryDays) || expiryDays <= 0)) {
        await ctx.reply("❌ Expiry days must be a positive number.", buildOwnerNavigationKeyboard());
        return;
      }

      const { generateCreditCode } = await import("./state.js");
      const creditCode = generateCreditCode(days, maxUses, expiryDays);
      resetOwnerSession();

      const expiryText = creditCode.expiresAt
        ? `Expires: ${new Date(creditCode.expiresAt).toLocaleDateString()}`
        : "No expiry";

      await ctx.reply(
        `✅ <b>Credit Code Created!</b>\n\n` +
        `📋 Code: <code>${creditCode.code}</code>\n` +
        `📅 Days: ${creditCode.days}\n` +
        `🔢 Max Uses: ${creditCode.maxUses}\n` +
        `⏰ ${expiryText}\n\n` +
        `Share this code with users to give them credit.`,
        { parse_mode: "HTML", ...buildCreditCodesKeyboard() }
      );
      return;
    }
    case "awaitingDeleteCreditCode": {
      const codeToDelete = text.trim();

      const { findCreditCode, deleteCreditCode } = await import("./state.js");
      const found = findCreditCode(codeToDelete);

      if (!found) {
        await ctx.reply(
          `❌ Credit code not found: <code>${codeToDelete}</code>\n\nPlease check the code and try again.`,
          { parse_mode: "HTML", ...buildCreditCodesKeyboard() }
        );
        return;
      }

      const deleted = deleteCreditCode(found.id);
      resetOwnerSession();

      if (deleted) {
        await ctx.reply(
          `✅ Credit code <code>${codeToDelete}</code> has been deleted.`,
          { parse_mode: "HTML", ...buildCreditCodesKeyboard() }
        );
      } else {
        await ctx.reply(
          `❌ Failed to delete credit code. Please try again.`,
          buildCreditCodesKeyboard()
        );
      }
      return;
    }
    default:
      return;
  }
});

bot.catch((error) => {
  logger.error("bot unexpected error", { error });
});

function ensureLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function trimTrailingSlash(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

export async function startBotPolling(): Promise<void> {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  } catch (error) {
    logger.warn("bot failed to delete webhook before polling start", { error });
  }

  const allowedUpdates = [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
    "callback_query",
    "my_chat_member",
    "chat_member",
    "poll",
    "poll_answer",
    "pre_checkout_query",
  ] as const;

  await bot.launch({ allowedUpdates: [...allowedUpdates] });
  logger.info("bot polling mode ready");

  process.once("SIGINT", () => {
    void bot.stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    void bot.stop("SIGTERM");
  });
}

type WebhookOptions = {
  domain: string;
  path?: string;
  port?: number;
  host?: string;
  secretToken?: string;
};

type WebhookServerResult = {
  app: express.Express;
  server: import("node:http").Server;
  url: string;
  webhookPath: string;
};

export async function startBotWebhookServer(options: WebhookOptions): Promise<WebhookServerResult> {
  if (!options.domain) {
    throw new Error("Webhook domain is required");
  }

  const app = express();
  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  // CORS (configurable via ALLOWED_ORIGINS or CORS_ORIGIN)
  const allowedOrigins = ((process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? "").split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const allowAll = allowedOrigins.includes("*");
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowAll || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS origin denied"));
    },
    credentials: false,
  }));
  await registerPromoStaticRoutes(app);
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    const reqWithId = req as RequestWithId;
    const requestId = randomUUID();
    reqWithId.id = requestId;
    res.setHeader("X-Request-ID", requestId);
    next();
  });

  const webhookPath = ensureLeadingSlash(options.path ?? "/telegram/webhook");

  // Debug logging for all requests
  app.use((req, res, next) => {
    if (req.path === webhookPath) {
      logger.info("incoming webhook request", {
        method: req.method,
        ip: req.ip,
        headers: {
          "x-forwarded-for": req.headers["x-forwarded-for"],
          "content-length": req.headers["content-length"]
        }
      });
    }
    next();
  });

  app.use((req, res, next) => {
    // Skip HTTPS redirect for webhook to prevent 301/307 issues on POST requests
    if (req.path === webhookPath) {
      return next();
    }
    if (process.env.NODE_ENV === "production" && !req.secure) {
      const host = req.headers.host;
      if (host) {
        return res.redirect(301, `https://${host}${req.originalUrl}`);
      }
    }
    next();
  });

  const bodyLimit = "1mb";
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

  const configuredWindowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "", 10);
  const configuredMax = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "", 10);
  const apiLimiter = rateLimit({
    windowMs: Number.isFinite(configuredWindowMs) && configuredWindowMs > 0 ? configuredWindowMs : 15 * 60 * 1000,
    max: Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many requests, please try again later." });
    },
  });

  app.use("/api", apiLimiter);

  registerApiRoutes(app);

  app.post(webhookPath, bot.webhookCallback(webhookPath));

  const trimmedDomain = trimTrailingSlash(options.domain.trim());
  const webhookUrl = `${trimmedDomain}${webhookPath}`;

  // Must include pre_checkout_query for Stars payments
  // Note: successful_payment comes through as a message update, not a separate type
  const allowedUpdates = [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
    "callback_query",
    "my_chat_member",
    "chat_member",
    "poll",
    "poll_answer",
    "pre_checkout_query",
  ] as const;

  try {
    await bot.telegram.setWebhook(webhookUrl, {
      secret_token: options.secretToken,
      allowed_updates: [...allowedUpdates],
    });
    logger.info("bot webhook registered", { webhookUrl, allowedUpdates: [...allowedUpdates] });
  } catch (error) {
    logger.error("bot webhook registration failed", { error, webhookUrl });
    logger.warn(
      "continuing to serve HTTP API without an active Telegram webhook. Verify outbound connectivity or configure BOT_START_MODE=polling if webhooks are unavailable.",
    );
  }

  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const host = options.host ?? "0.0.0.0";

  const server = app.listen(port, host, () => {
    logger.info("bot webhook server listening", {
      url: `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
    });
  });

  process.once("SIGINT", () => {
    server.close(() => {
      void bot.stop("SIGINT");
    });
  });
  process.once("SIGTERM", () => {
    server.close(() => {
      void bot.stop("SIGTERM");
    });
  });

  return { app, server, url: webhookUrl, webhookPath };
}

export { bot };
