import type { Context } from "telegraf";
import type { GroupChatContext, ProcessingAction } from "./types.js";
import { logger } from "../../server/utils/logger.js";
import { markAdminPermission, queuePendingOnboardingMessages, hasPromoButton, hasDetailedWarnings, hasAdvancedAnalytics, isGroupPremium, hasAutoWarning, hasAutoDelete } from "../state.js";

export function isGroupChat(ctx: Context): ctx is GroupChatContext {
  // First check standard ctx.chat
  const type = ctx.chat?.type;
  if (type === "group" || type === "supergroup") {
    return true;
  }
  
  // For chat_member and my_chat_member updates, chat info is in the update object
  const update = ctx.update as any;
  if (update?.chat_member?.chat) {
    const chatMemberType = update.chat_member.chat.type;
    if (chatMemberType === "group" || chatMemberType === "supergroup") {
      // Assign ctx.chat from the update for consistency
      (ctx as any).chat = update.chat_member.chat;
      return true;
    }
  }
  if (update?.my_chat_member?.chat) {
    const myChatMemberType = update.my_chat_member.chat.type;
    if (myChatMemberType === "group" || myChatMemberType === "supergroup") {
      // Assign ctx.chat from the update for consistency
      (ctx as any).chat = update.my_chat_member.chat;
      return true;
    }
  }
  
  return false;
}

export function ensureActions(result: ProcessingAction[] | undefined): ProcessingAction[] {
  if (!result || result.length === 0) {
    return [];
  }
  return result;
}

export function executeAction(ctx: GroupChatContext, action: ProcessingAction): Promise<void> {
  if (action.type !== "log") {
    logger.info("processing executor action", {
      chatId: ctx.chat?.id,
      action: action.type,
      messageId: "messageId" in action ? (action as { messageId?: number }).messageId : ctx.message?.message_id,
      userId:
        "userId" in action
          ? (action as { userId?: number }).userId
          : ctx.message && "from" in ctx.message
            ? ctx.message.from?.id
            : undefined,
      details: action.type === "warn_member" ? { severity: action.severity } : undefined,
    });
  }

  switch (action.type) {
    case "delete_message":
      return deleteMessage(ctx, action);
    case "warn_member":
      return warnMember(ctx, action);
    case "restrict_member":
      return restrictMember(ctx, action);
    case "kick_member":
      return kickMember(ctx, action);
    case "ban_member":
      return banMember(ctx, action);
    case "send_message":
      return sendMessage(ctx, action);
    case "record_moderation":
      return recordModeration(ctx, action);
    case "record_rule_audit":
      return recordRuleAudit(ctx, action);
    case "log":
      logAction(action);
      return Promise.resolve();
    case "noop":
    default:
      return Promise.resolve();
  }
}

async function deleteMessage(ctx: GroupChatContext, action: Extract<ProcessingAction, { type: "delete_message" }>) {
  if (!ctx.chat || !ctx.message) {
    return;
  }

  const message = ctx.message as any;
  const forwardFromChat = message?.forward_from_chat;
  const hasForward = Boolean(message?.forward_date);
  const hasForwardChannel = Boolean(hasForward && forwardFromChat && forwardFromChat.type === "channel");
  const isAutomaticForward = Boolean(message?.is_automatic_forward);
  if (isAutomaticForward && hasForwardChannel) {
    logger.debug("skipping delete for linked channel auto-forward", {
      chatId: ctx.chat.id,
      messageId: action.messageId,
    });
    return;
  }

  if (!(await ensureBotCapability(ctx, "can_delete_messages"))) {
    return;
  }

  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, action.messageId);
  } catch (error) {
    handleActionError(ctx, "delete_message", "can_delete_messages", error, {
      messageId: action.messageId,
    });
  }
}

async function warnMember(ctx: GroupChatContext, action: Extract<ProcessingAction, { type: "warn_member" }>) {
  const mention = ctx.message?.from?.first_name ?? ctx.message?.from?.username ?? action.userId.toString();
  
  const databaseAvailable = Boolean(process.env?.DATABASE_URL);
  
  // Defaults for template placeholders
  let warningsEnabled = true;
  let penaltyLabel = "delete";
  let userWarningsCount: number | null = null;
  let warningsLimitTotal: number | null = null;
  let warningsRetentionDays: number | null = null;
  let usedPersistentWarnings = false;
  let autoWarningPenalty: "delete" | "mute" | "kick" | null = null;

  // Check if warnings are enabled in group settings and try to load auto-warning config
  if (databaseAvailable) {
    try {
      const { loadGeneralSettingsByChatId } = await import("../../server/db/groupSettingsRepository.js");
      const generalSettings = await loadGeneralSettingsByChatId(ctx.chat.id.toString());
      warningsEnabled = generalSettings.warningEnabled;
      if (!warningsEnabled) {
        logger.debug("warnings disabled for group", { chatId: ctx.chat.id });
        return;
      }

      // PREMIUM FEATURE: Auto-warning is only available for Premium groups
      const chatIdStr = ctx.chat.id.toString();
      if (generalSettings.autoWarningEnabled && generalSettings.autoWarning && hasAutoWarning(chatIdStr)) {
        const auto = generalSettings.autoWarning;
        warningsLimitTotal = typeof auto.threshold === "number" ? auto.threshold : null;
        warningsRetentionDays = typeof auto.retentionDays === "number" ? auto.retentionDays : null;
        penaltyLabel = auto.penalty || penaltyLabel;
        if (auto.penalty === "delete" || auto.penalty === "mute" || auto.penalty === "kick") {
          autoWarningPenalty = auto.penalty;
        }
      }
    } catch (error) {
      logger.debug("failed to load general settings, proceeding with warning", { 
        chatId: ctx.chat.id, 
        error 
      });
    }
  }
  
  // Try to persist warning in database and get aggregated count
  if (databaseAvailable) {
    try {
      if (ctx.chat?.id && action.userId) {
        const { recordUserWarningAndGetCount } = await import("../../server/db/mutateRepository.js");
        const retentionDaysValue =
          typeof warningsRetentionDays === "number" && Number.isFinite(warningsRetentionDays) && warningsRetentionDays > 0
            ? warningsRetentionDays
            : null;

        const result = await recordUserWarningAndGetCount({
          chatId: ctx.chat.id.toString(),
          telegramUserId: action.userId.toString(),
          retentionDays: retentionDaysValue,
          groupTitle: ctx.chat?.title ?? null,
        });

        userWarningsCount = result.count;
        usedPersistentWarnings = true;
      }
    } catch (error) {
      logger.debug("failed to persist user warning in database, falling back to in-memory warnings", {
        chatId: ctx.chat?.id,
        userId: action.userId,
        error,
      });
    }
  }

  // Fallback: register warning in in-memory registry to get per-user count for this session
  if (!usedPersistentWarnings) {
    try {
      if (ctx.chat?.id && action.userId) {
        const { registerWarning } = await import("./warnings.js");
        userWarningsCount = registerWarning(Number(ctx.chat.id), Number(action.userId));
      }
    } catch (error) {
      logger.debug("failed to register warning in memory, continuing without per-user count", {
        chatId: ctx.chat?.id,
        userId: action.userId,
        error,
      });
    }
  }

  // Apply automatic mute when warning threshold is exceeded and auto-warning penalty is set to mute
  if (
    autoWarningPenalty === "mute" &&
    typeof userWarningsCount === "number" &&
    typeof warningsLimitTotal === "number" &&
    warningsLimitTotal > 0 &&
    userWarningsCount > warningsLimitTotal &&
    typeof warningsRetentionDays === "number" &&
    warningsRetentionDays > 0
  ) {
    const durationSeconds = warningsRetentionDays * 24 * 60 * 60;
    try {
      await restrictMember(ctx, {
        type: "restrict_member",
        userId: action.userId,
        reason: "Warning threshold exceeded: user muted automatically.",
        durationSeconds,
      });
    } catch (error) {
      logger.warn("failed to apply auto-warning mute", {
        chatId: ctx.chat?.id,
        userId: action.userId,
        error,
      });
    }
  }

  // Try to load custom warning message template
  // Free: Basic reason, Premium: Detailed explanation
  const chatIdStr = ctx.chat.id.toString();
  const showDetailedWarning = hasDetailedWarnings(chatIdStr);
  
  // Default templates:
  // Free: Shows reason but simpler format
  // Premium: Shows detailed explanation with all info
  let warningTemplate = showDetailedWarning 
    ? "⚠️ <b>Warning!</b>\n\n👤 {user}\n\n📋 <b>Violation:</b> {reason}\n🔴 <b>Severity:</b> {severity}\n⚡ <b>Action:</b> {penalty}\n📊 <b>Your warnings:</b> {user_warnings}/{warnings_count}\n⏰ <b>Reset after:</b> {warningstime} days\n\n💡 <i>Repeated violations may result in a ban.</i>"
    : "⚠️ {user}, rule violated: {reason}";
  
  // Load custom template from database
  if (databaseAvailable) {
    try {
      const { loadCustomTextSettingsByChatId } = await import("../../server/db/groupSettingsRepository.js");
      const customTexts = await loadCustomTextSettingsByChatId(chatIdStr);
      if (customTexts.warningMessage && customTexts.warningMessage.trim()) {
        // For Premium, use full custom template
        // For Free, use custom template but strip some parts
        if (showDetailedWarning) {
          warningTemplate = customTexts.warningMessage;
        } else {
          // Free users get simpler version even with custom template
          warningTemplate = "⚠️ {user}, rule violated: {reason}";
        }
      }
    } catch (error) {
      // Fall back to default template if custom text loading fails
      const { logger } = await import("../../server/utils/logger.js");
      logger.debug("failed to load custom warning message, using default", { 
        chatId: ctx.chat.id, 
        error 
      });
    }
  }

  // Use template system for warning message
  const { renderTemplate } = await import("../templating.js");
  const replacements = {
    user: mention,
    reason: action.reason,
    severity: action.severity.toUpperCase(),
    penalty: penaltyLabel,
    user_warnings: userWarningsCount,
    warnings_count: warningsLimitTotal,
    warningstime: warningsRetentionDays,
  };

  const warningText = renderTemplate(warningTemplate, replacements);

  try {
    await sendMessage(ctx, {
      type: "send_message",
      text: warningText,
      replyToMessageId: ctx.message?.message_id,
      parseMode: "HTML",
      autoDeleteSeconds: 60,
    });
  } catch (error) {
    handleActionError(ctx, "warn_member", "can_send_messages", error);
  }
}

async function restrictMember(ctx: GroupChatContext, action: Extract<ProcessingAction, { type: "restrict_member" }>) {
  const untilDate =
    action.durationSeconds && Number.isFinite(action.durationSeconds)
      ? Math.floor(Date.now() / 1000) + action.durationSeconds
      : undefined;

  if (!(await ensureBotCapability(ctx, "can_restrict_members"))) {
    return;
  }

  try {
    await ctx.telegram.restrictChatMember(
      ctx.chat.id,
      action.userId,
      {
        until_date: untilDate,
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
  } catch (error) {
    handleActionError(ctx, "restrict_member", "can_restrict_members", error, {
      userId: action.userId,
    });
  }
}

async function kickMember(ctx: GroupChatContext, action: Extract<ProcessingAction, { type: "kick_member" }>) {
  if (!(await ensureBotCapability(ctx, "can_restrict_members"))) {
    return;
  }

  try {
    await ctx.telegram.banChatMember(ctx.chat.id, action.userId);
    await ctx.telegram.unbanChatMember(ctx.chat.id, action.userId);
  } catch (error) {
    handleActionError(ctx, "kick_member", "can_restrict_members", error, {
      userId: action.userId,
    });
  }
}

async function banMember(ctx: GroupChatContext, action: Extract<ProcessingAction, { type: "ban_member" }>) {
  if (!(await ensureBotCapability(ctx, "can_restrict_members"))) {
    return;
  }

  try {
    // Telegram expects untilDate as a number (unix timestamp) here.
    await ctx.telegram.banChatMember(ctx.chat.id, action.userId, action.untilDate as any);
  } catch (error) {
    handleActionError(ctx, "ban_member", "can_restrict_members", error, {
      userId: action.userId,
    });
  }
}

function isTopicClosedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const description = (error as { response?: { description?: string } }).response?.description ??
    (error as { description?: string }).description ??
    "";
  return description.includes("TOPIC_CLOSED");
}

function isForumChat(ctx: GroupChatContext): boolean {
  return Boolean((ctx.chat as { is_forum?: boolean }).is_forum);
}

function resolveMessageThreadId(
  ctx: GroupChatContext,
  action: Extract<ProcessingAction, { type: "send_message" }>,
): number | undefined {
  if (typeof action.threadId === "number") {
    return action.threadId;
  }
  if (typeof ctx.message?.message_thread_id === "number") {
    return ctx.message.message_thread_id;
  }
  if (isForumChat(ctx)) {
    return 1;
  }
  return undefined;
}

async function sendMessage(ctx: GroupChatContext, action: Extract<ProcessingAction, { type: "send_message" }>) {
  // Load general settings to check for auto-delete configuration
  let autoDeleteDelaySeconds = 0;

  const databaseAvailable = Boolean(process.env?.DATABASE_URL);
  if (databaseAvailable) {
    try {
      const { loadGeneralSettingsByChatId } = await import("../../server/db/groupSettingsRepository.js");
      const generalSettings = await loadGeneralSettingsByChatId(ctx.chat.id.toString());
      if (generalSettings.autoDeleteEnabled && generalSettings.autoDeleteDelayMinutes > 0) {
        // The value from settings is now interpreted as seconds
        autoDeleteDelaySeconds = generalSettings.autoDeleteDelayMinutes;
      }
    } catch (error) {
      // Continue with defaults if settings can't be loaded
    }
  }

  const baseOptions: Record<string, unknown> = {
    reply_to_message_id: action.replyToMessageId,
    parse_mode: action.parseMode,
    disable_web_page_preview: true,
    allow_sending_without_reply: true,
    disable_notification: false,
  };
  const threadId = resolveMessageThreadId(ctx, action);
  if (typeof threadId === "number") {
    baseOptions.message_thread_id = threadId;
  }

  // Optionally attach promo button as inline keyboard when enabled in settings.
  // PREMIUM FEATURE: Promo button is only available for Premium groups
  const chatId = ctx.chat.id.toString();
  const shouldAttachPromo = action.attachPromoButton !== false && hasPromoButton(chatId);
  if (databaseAvailable && shouldAttachPromo) {
    try {
      const { loadCustomTextSettingsByChatId } = await import("../../server/db/groupSettingsRepository.js");
      const customTexts = await loadCustomTextSettingsByChatId(chatId);
      const enabled = customTexts.promoButtonEnabled;
      const text = (customTexts.promoButtonText ?? "").trim();
      const url = (customTexts.promoButtonUrl ?? "").trim();
      if (enabled && text && url) {
        (baseOptions as any).reply_markup = {
          inline_keyboard: [[{ text, url }]],
        };
      }
    } catch (error) {
      logger.debug("failed to attach promo button to message", {
        chatId: ctx.chat?.id,
        error,
      });
    }
  }

  try {
    const sent = await ctx.telegram.sendMessage(ctx.chat.id, action.text, baseOptions as any);

    // Schedule auto-delete based on action-specific setting or general setting
    let autoDeleteSeconds = action.autoDeleteSeconds || 0;
    if (autoDeleteSeconds === 0 && autoDeleteDelaySeconds > 0) {
      autoDeleteSeconds = autoDeleteDelaySeconds;
    }

    if (autoDeleteSeconds > 0) {
      const timeoutMs = Math.max(0, Math.trunc(autoDeleteSeconds)) * 1000;
      const messageId = (sent as any)?.message_id as number | undefined;
      if (typeof messageId === "number") {
        const { logger } = await import("../../server/utils/logger.js");
        logger.info("scheduling auto-delete for sent message", { 
          chatId: ctx.chat?.id, 
          messageId, 
          timeoutMs,
          source: action.autoDeleteSeconds ? 'action' : 'general_settings'
        });
        setTimeout(async () => {
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
          } catch (err) {
            // Use existing error handler to mark missing permissions or rate limits
            handleActionError(ctx, "delete_message", "can_delete_messages", err, { autoDelete: true });
          }
        }, timeoutMs);
      } else {
        const { logger } = await import("../../server/utils/logger.js");
        logger.debug("unable to schedule auto-delete, no message id returned", { chatId: ctx.chat?.id });
      }
    }

    return;
  } catch (error) {
    if (isTopicClosedError(error)) {
      try {
        const retryOptions = { ...baseOptions };
        delete retryOptions.reply_to_message_id;
        delete retryOptions.message_thread_id;
        await ctx.telegram.sendMessage(ctx.chat.id, action.text, retryOptions);
        return;
      } catch (retryError) {
        if (
          isTopicClosedError(retryError) &&
          action.rescheduleOnPromotion &&
          typeof ctx.chat?.id === "number"
        ) {
          queuePendingOnboardingMessages(ctx.chat.id.toString(), [
            {
              text: action.text,
              parseMode: action.parseMode,
              threadId,
            },
          ]);
          logger.warn("queued onboarding message until admin promotion", {
            chatId: ctx.chat.id,
          });
          return;
        }
        handleActionError(ctx, "send_message", "can_send_messages", retryError);
        return;
      }
    }
    handleActionError(ctx, "send_message", "can_send_messages", error);
  }
}

async function recordModeration(ctx: GroupChatContext, action: Extract<ProcessingAction, { type: "record_moderation" }>) {
  try {
    const { recordModerationAction } = await import("../../server/db/mutateRepository.js");
    await recordModerationAction({
      chatId: ctx.chat.id.toString(),
      userId: action.userId ? action.userId.toString() : null,
      actorId: ctx.botInfo?.id ? ctx.botInfo.id.toString() : null,
      action: action.actions.join(" | "),
      severity: null,
      reason: action.reason ?? null,
      metadata: (action.metadata ?? null) as any,
    });
  } catch (error) {
    logger.warn("failed to persist moderation action", { chatId: ctx.chat.id, error });
  }
}

async function recordRuleAudit(ctx: GroupChatContext, action: Extract<ProcessingAction, { type: "record_rule_audit" }>) {
  try {
    const { appendRuleAudit } = await import("../../server/db/firewallRepository.js");
    await appendRuleAudit({
      groupChatId: ctx.chat.id.toString(),
      ruleId: action.ruleId,
      offenderId: action.offenderId,
      action: action.actionSummary,
      payload: action.payload as any,
    });
  } catch (error) {
    logger.warn("failed to record firewall audit", { chatId: ctx.chat.id, error });
  }
}

function logAction(action: Extract<ProcessingAction, { type: "log" }>) {
  const { level, message, details } = action;
  logger[level](message, details);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}

type AdminCapability = "can_delete_messages" | "can_restrict_members" | "can_send_messages";

const CAPABILITY_LABELS: Record<AdminCapability, string> = {
  can_delete_messages: "delete messages",
  can_restrict_members: "restrict or ban members",
  can_send_messages: "send messages",
};

async function ensureBotCapability(ctx: GroupChatContext, capability: AdminCapability): Promise<boolean> {
  if (!ctx.chat || !ctx.botInfo) {
    return false;
  }

  const chatId = ctx.chat.id.toString();
  const processingState = (ctx.processing ??= {});
  const cache = (processingState.permissionCache ??= new Map<string, boolean>());

  if (cache.has(capability)) {
    const allowed = cache.get(capability) ?? false;
    if (!allowed) {
      handleMissingPermission(ctx, capability);
    }
    return allowed;
  }

  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
    let allowed = false;
    if (member.status === "creator") {
      allowed = true;
    } else if (member.status === "administrator") {
      if (capability === "can_send_messages") {
        allowed = true;
      } else {
        allowed = Boolean((member as unknown as Record<string, unknown>)[capability]);
      }
    } else if (member.status === "member") {
      // Regular group members (default bot state) can send messages unless restricted by admins.
      allowed = capability === "can_send_messages";
    } else if (capability === "can_send_messages") {
      // Restricted members expose the explicit can_send_messages flag.
      allowed = Boolean((member as unknown as Record<string, unknown>)[capability] ?? false);
    }

    cache.set(capability, allowed);
    if (!allowed) {
      handleMissingPermission(ctx, capability);
    }
    return allowed;
  } catch (error) {
    logger.error("failed to inspect bot chat member permissions", { chatId, capability, error });
    return false;
  }
}

function handleMissingPermission(ctx: GroupChatContext, capability: AdminCapability, error?: unknown): void {
  if (!ctx.chat) {
    return;
  }
  const chatId = ctx.chat.id.toString();
  const processingState = (ctx.processing ??= {});
  const missing = (processingState.missingPermissions ??= new Set<string>());

  if (!missing.has(capability)) {
    missing.add(capability);
    logger.warn("bot missing required permission", {
      chatId,
      capability,
      description: CAPABILITY_LABELS[capability],
      error: error instanceof Error ? error.message : undefined,
    });
  }

  markAdminPermission(chatId, false, { warningDate: new Date() });
}

function handleActionError(
  ctx: GroupChatContext,
  action: ProcessingAction["type"],
  capability: AdminCapability | undefined,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  const chatId = ctx.chat?.id;
  logger.error(`failed to execute processing action ${action}`, {
    chatId,
    ...extra,
    error,
  });

  if (isRateLimitError(error)) {
    const processingState = (ctx.processing ??= {});
    processingState.rateLimitedAt = Date.now();
    const retryAfterSeconds = extractRetryAfterSeconds(error);
    processingState.retryAfterSeconds = typeof retryAfterSeconds === "number" ? retryAfterSeconds : undefined;
    logger.warn("telegram rate limit detected during processing", {
      chatId,
      action,
      retryAfterSeconds: processingState.retryAfterSeconds ?? null,
    });
  }

  if (capability && isPermissionError(error)) {
    handleMissingPermission(ctx, capability, error);
  }
}

function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const response = (error as { response?: { error_code?: number; description?: string } }).response;
  const description = (response?.description ?? (error as { description?: string }).description ?? "").toLowerCase();

  if (response?.error_code === 403) {
    return true;
  }
  if (description.includes("not enough rights") || description.includes("have no rights")) {
    return true;
  }
  if (description.includes("bot was blocked by the user") || description.includes("bot is not a member")) {
    return true;
  }
  return false;
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const response = (error as { response?: { error_code?: number; description?: string } }).response;
  if (response?.error_code === 429) {
    return true;
  }
  const description = (response?.description ?? (error as { description?: string }).description ?? "").toLowerCase();
  return description.includes("too many requests") || description.includes("retry later");
}

function extractRetryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const response = (error as { response?: { parameters?: { retry_after?: number } } }).response;
  const retry = response?.parameters?.retry_after;
  if (typeof retry === "number" && Number.isFinite(retry) && retry > 0) {
    return retry;
  }
  return null;
}
