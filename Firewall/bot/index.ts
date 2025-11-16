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

import { loadBotContent } from "./content.js";
import { renderTemplate, resolveUserDisplayName } from "./templating.js";
import { installFirewall, invalidateFirewallCache } from "./firewall.js";
import { installProcessingPipeline } from "./processing/index.js";
import { startTrialMonitor } from "./jobs/trialMonitor.js";
import { startAdminMonitor } from "./jobs/adminMonitor.js";
import { startMissionResetJob } from "./jobs/missionReset.js";
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
  fixGroupOwnership
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
  ownerResetBot: "fw_owner_reset_bot"
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
<<<<<<< HEAD
  (botUsername ? `https://t.me/${botUsername}?startgroup=true` : undefined);
=======
  (botUsername ? `https://t.me/${botUsername}?startgroup=inpvbtn&admin=delete_messages+restrict_members+invite_users` : undefined);
>>>>>>> 3b5f072a78d91cbbdd86a1a4e41f99f8814c6a81

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
startExpiredGroupsMonitor(bot);
void startMissionResetJob();

const REQUIRED_SLIDE_WIDTH = 960;
const REQUIRED_SLIDE_HEIGHT = 360;

const databaseAvailable = Boolean(process.env.DATABASE_URL);

type InlineKeyboard = ReturnType<typeof Markup.inlineKeyboard>;

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
      Markup.button.callback(label("start_commands", content.buttons.commands), actionId("commands")),
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
settingsFreeDays: "Free Trial Days\nSend the new number of free days that groups receive after activation.",
settingsStars: "Monthly Stars Quota\nSend the monthly Stars allowance that each group should get.",
settingsWelcomeMessages:
  "Welcome Messages\nSend up to four welcome texts, one per message. The bot will replace the stored templates in order.",
settingsGpidHelp: "GPID Help Text\nProvide the helper text that explains how to find the group GPID.",
settingsLabels:
  "Button Labels\nSend the updated labels for all buttons as a JSON object or one label per message following the prompts.",
settingsChannelText:
  "Channel Announcement Text\nSend the announcement template that should appear when the channel button is used.",
settingsInfoCommands:
  "Info and Commands Text\nShare the combined Info and Commands message that should be shown to users.",
sliderIntro: `Promo Slider Control\nManage the slides displayed in the dashboard carousel.\nRecommended image size: ${REQUIRED_SLIDE_WIDTH}x${REQUIRED_SLIDE_HEIGHT}px.`,
sliderViewEmpty: "No promo slides have been configured yet.\nUse \"Add Slide\" to upload the first banner.",
sliderViewHeader: "Current Promo Slides:",
sliderAddPromptPhoto: `Send a high-quality photo (recommended ${REQUIRED_SLIDE_WIDTH}x${REQUIRED_SLIDE_HEIGHT}px). The bot will crop and compress it automatically.`,
sliderAwaitLink: "Great! Now send the HTTPS link that should open when users tap the slide.",
sliderDimensionsMismatch:
  `For best results, upload at least ${REQUIRED_SLIDE_WIDTH}x${REQUIRED_SLIDE_HEIGHT}px. Smaller images will be upscaled automatically.`,
sliderLinkInvalid: "Please send a valid HTTPS link pointing to an approved domain.",
sliderMissingPhoto: "No image is pending. Please start again by sending the promo photo first.",
sliderRemovePrompt: "Send the slide id you want to remove (for example: promo-001).",
sliderRemoveMissing: "No slide matches that id. Check the list and try again.",
dailyTaskIntro:
  "Daily Task Channel\nShare a channel mission in the daily checklist. Make sure the bot is already an admin before you send the invite link.",
dailyTaskPromptLink: "Send the public invite link of the channel (for example: https://t.me/firewall_channel). The bot must already be an administrator.",
dailyTaskLinkInvalid: "The link must start with https://t.me/ or t.me/. Please double-check that the bot is an admin and send a valid public link.",
dailyTaskPromptButton: 'Great! Now send the button label you want users to see (for example: "Join Security Briefings").',
dailyTaskButtonInvalid: "The button label cannot be empty. Please send a short call-to-action.",
dailyTaskPromptDescription: 'Send the description text that will appear under the mission (for example: "Watch the daily hardening tips in Command Center").',
dailyTaskDescriptionInvalid: "Please send a short description for the mission.",
dailyTaskPromptXp: "Finally, send the XP reward (positive integer).",
dailyTaskXpInvalid: "Please send a positive integer value for XP reward.",
dailyTaskSaved: "Daily task channel saved. Reload the missions dashboard to see the new button.",
  banIntro: "🚫 <b>User Ban Management</b>\n\nManage access restrictions for panel users:",
  banAddPrompt: "🚫 <b>Ban User</b>\n\nSend the numeric Telegram user ID that should be banned from accessing the panel.\n\n<i>Example: 123456789</i>",
  banRemovePrompt: "✅ <b>Unban User</b>\n\nSend the numeric Telegram user ID that should be removed from the ban list.\n\n<i>Example: 123456789</i>",
  banListEmpty: "📋 The ban list is currently empty.",
  banListHeader: "📋 <b>Banned Users:</b>",
  banNotFound: "❌ That user ID is not currently banned. Check the list and try again.",
  creditCodesIntro: "🎁 <b>Credit Code Management</b>\n\nGenerate and manage credit codes for your users. These codes can be used to add days to group subscriptions:",
  createCreditCode: "➕ <b>Create New Credit Code</b>\n\nSend the details in this format:\n<code>DAYS MAX_USES [EXPIRES_IN_DAYS]</code>\n\n<b>Examples:</b>\n• <code>7 100</code> - 7 days, 100 uses, no expiry\n• <code>30 50 90</code> - 30 days, 50 uses, expires in 90 days\n• <code>14 1</code> - 14 days, single use, no expiry",
  creditCodesList: "📋 <b>Active Credit Codes</b>\n\nHere are your current credit codes:",
  creditCodesEmpty: "📋 No credit codes have been created yet.",
  creditCodeCreated: "✅ <b>Credit Code Created Successfully!</b>",
  creditCodeDeleted: "🗑️ Credit code deleted successfully.",
  creditCodeNotFound: "❌ Credit code not found.",
  settingsLabels:
    "🏷️ <b>Button Labels</b>\n\nSend the updated labels for all buttons as a JSON object or one label per message following the prompts.\n\n<i>Example: {\"start_add_to_group\":\"➕ Add Bot\",\"owner_nav_back\":\"🔙 Back\"}</i>",
  settingsChannelText:
    "Channel Announcement Text\nSend the announcement template that should appear when the channel button is used.",
  settingsInfoCommands:
    "Info and Commands Text\nShare the combined Info and Commands message that should be shown to users.",
  sliderIntro: `Promo Slider Control\nManage the slides displayed in the dashboard carousel.\nRecommended image size: ${REQUIRED_SLIDE_WIDTH}x${REQUIRED_SLIDE_HEIGHT}px.`,
  sliderViewEmpty: "No promo slides have been configured yet.\nUse \"Add Slide\" to upload the first banner.",
  sliderViewHeader: "Current Promo Slides:",
  sliderAddPromptPhoto: `Send a high-quality photo (recommended ${REQUIRED_SLIDE_WIDTH}x${REQUIRED_SLIDE_HEIGHT}px). The bot will crop and compress it automatically.`,
  sliderAwaitLink: "Great! Now send the HTTPS link that should open when users tap the slide.",
  sliderDimensionsMismatch:
    `For best results, upload at least ${REQUIRED_SLIDE_WIDTH}x${REQUIRED_SLIDE_HEIGHT}px. Smaller images will be upscaled automatically.`,
  sliderLinkInvalid: "Please send a valid HTTPS link pointing to an approved domain.",
  sliderMissingPhoto: "No image is pending. Please start again by sending the promo photo first.",
  sliderRemovePrompt: "Send the slide id you want to remove (for example: promo-001).",
  sliderRemoveMissing: "No slide matches that id. Check the list and try again.",
  dailyTaskIntro:
    "Daily Task Channel\nShare a channel mission in the daily checklist. Make sure the bot is already an admin before you send the invite link.",
  dailyTaskPromptLink: "Send the public invite link of the channel (for example: https://t.me/firewall_channel). The bot must already be an administrator.",
  dailyTaskLinkInvalid: "The link must start with https://t.me/ or t.me/. Please double-check that the bot is an admin and send a valid public link.",
  dailyTaskPromptButton: 'Great! Now send the button label you want users to see (for example: "Join Security Briefings").',
  dailyTaskButtonInvalid: "The button label cannot be empty. Please send a short call-to-action.",
  dailyTaskPromptDescription: 'Send the description text that will appear under the mission (for example: "Watch the daily hardening tips in Command Center").',
  dailyTaskDescriptionInvalid: "Please send a short description for the mission.",
  dailyTaskPromptXp: "Finally, send the XP reward (positive integer).",
  dailyTaskXpInvalid: "Please send a positive integer value for XP reward.",
  dailyTaskSaved: "Daily task channel saved. Reload the missions dashboard to see the new button.",
  banIntro: "Ban List Management\nBlock or unblock users from accessing the panel.",
  banAddPrompt: "Send the numeric Telegram user id that should be banned.",
  banRemovePrompt: "Send the numeric Telegram user id that should be removed from the ban list.",
  banListEmpty: "The ban list is currently empty.",
  banListHeader: "Users banned from the panel:",
  banNotFound: "That user id is not currently banned. Check the list and try again."
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
  const startPayload = ctx.message?.text?.split(' ')[1];
  if (startPayload?.includes('ref=')) {
    try {
      const referralCode = startPayload.split('ref=')[1]?.split('&')[0];
      if (referralCode && referralCode.trim().length > 0) {
        const referrerId = referralCode.trim();
        const newUserId = ctx.from?.id?.toString();
        
        if (newUserId && referrerId !== newUserId) {
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
            console.warn('Failed to track referral:', error);
          });
        }
      }
    } catch (error) {
      console.warn('Error processing referral:', error);
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
  await ctx.answerCbQuery(content.messages.inlinePanel, { show_alert: true });
});

bot.action(actionId("managementBack"), async (ctx) => {
  await ctx.answerCbQuery();
  await sendStartMenu(ctx);
});

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
  const settings = getPanelSettings();
  const custom = settings.commands?.trim();
  const message = custom && custom.length > 0 ? custom : content.messages.commands;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("\u{1F519} Back", actionId("managementBack"))]
  ]);
  await replyOrEditRoot(ctx, message, keyboard);
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
        `${mismatches.length - limit} more mismatch${
          mismatches.length - limit === 1 ? "" : "es"
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

bot.on("pre_checkout_query", async (ctx) => {
  const query = ctx.update.pre_checkout_query;
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

  if (ownerSession.state !== "awaitingSliderPhoto") {
    return;
  }

  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) {
    await ctx.reply("Please send the slide as a standard photo message.", buildSliderNavigationKeyboard());
    return;
  }

  const bestMatch = photos[photos.length - 1];
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
});

bot.on("text", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    return;
  }

  if (!(await ensureOwnerAccess(ctx))) {
    return;
  }

  const text = ctx.message.text.trim();

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

  app.use((req, res, next) => {
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

  const webhookPath = ensureLeadingSlash(options.path ?? "/telegram/webhook");
  app.post(webhookPath, bot.webhookCallback(webhookPath));

  const trimmedDomain = trimTrailingSlash(options.domain.trim());
  const webhookUrl = `${trimmedDomain}${webhookPath}`;

  try {
    await bot.telegram.setWebhook(webhookUrl, options.secretToken ? { secret_token: options.secretToken } : undefined);
    logger.info("bot webhook registered", { webhookUrl });
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
