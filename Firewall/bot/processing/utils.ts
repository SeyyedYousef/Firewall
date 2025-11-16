import type { Context } from "telegraf";
import type { GroupChatContext, ProcessingAction } from "./types.js";
import { logger } from "../../server/utils/logger.js";
import { markAdminPermission, queuePendingOnboardingMessages } from "../state.js";

export function isGroupChat(ctx: Context): ctx is GroupChatContext {
  const type = ctx.chat?.type;
  return type === "group" || type === "supergroup";
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
  
  // Check if warnings are enabled in group settings
  if (databaseAvailable) {
    try {
      const { loadGeneralSettingsByChatId } = await import("../../server/db/groupSettingsRepository.js");
      const generalSettings = await loadGeneralSettingsByChatId(ctx.chat.id.toString());
      if (!generalSettings.warningEnabled) {
        logger.debug("warnings disabled for group", { chatId: ctx.chat.id });
        return;
      }
    } catch (error) {
      logger.debug("failed to load general settings, proceeding with warning", { 
        chatId: ctx.chat.id, 
        error 
      });
    }
  }
  
  // Try to load custom warning message template
  let warningTemplate = "{user}, you violated: {reason}. Severity: {severity}";
  
  if (databaseAvailable) {
    try {
      const { loadCustomTextSettingsByChatId } = await import("../../server/db/groupSettingsRepository.js");
      const customTexts = await loadCustomTextSettingsByChatId(ctx.chat.id.toString());
      if (customTexts.warningMessage && customTexts.warningMessage.trim()) {
        warningTemplate = customTexts.warningMessage;
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
  };

  const warningText = renderTemplate(warningTemplate, replacements);

  try {
    await ctx.telegram.sendMessage(ctx.chat.id, warningText, {
      parse_mode: "HTML",
      reply_to_message_id: ctx.message?.message_id,
      disable_web_page_preview: true,
    } as any);
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
  // Load general settings to check for auto-delete configuration and silent mode
  let autoDeleteDelayMinutes = 0;
  let silentModeEnabled = false;
  
  const databaseAvailable = Boolean(process.env?.DATABASE_URL);
  if (databaseAvailable) {
    try {
      const { loadGeneralSettingsByChatId } = await import("../../server/db/groupSettingsRepository.js");
      const generalSettings = await loadGeneralSettingsByChatId(ctx.chat.id.toString());
      if (generalSettings.autoDeleteEnabled && generalSettings.autoDeleteDelayMinutes > 0) {
        autoDeleteDelayMinutes = generalSettings.autoDeleteDelayMinutes;
      }
      silentModeEnabled = generalSettings.silentModeEnabled || false;
      
      // If silent mode is enabled, block all messages except system messages
      if (silentModeEnabled && !action.rescheduleOnPromotion) {
        logger.debug("message blocked due to silent mode", { chatId: ctx.chat.id });
        return;
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
    disable_notification: silentModeEnabled, // Apply silent mode if enabled
  };
  const threadId = resolveMessageThreadId(ctx, action);
  if (typeof threadId === "number") {
    baseOptions.message_thread_id = threadId;
  }

  try {
    const sent = await ctx.telegram.sendMessage(ctx.chat.id, action.text, baseOptions as any);

    // Schedule auto-delete based on action-specific setting or general setting
    let autoDeleteSeconds = action.autoDeleteSeconds || 0;
    if (autoDeleteSeconds === 0 && autoDeleteDelayMinutes > 0) {
      autoDeleteSeconds = autoDeleteDelayMinutes * 60;
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
