import type { Context } from "telegraf";
import type { GroupBanSettingsRecord } from "../../server/db/groupSettingsRepository.js";

export type GroupChatContext = Context & {
  chat: NonNullable<Context["chat"]>;
  message?: NonNullable<Context["message"]>;
  processing?: {
    banSettings?: GroupBanSettingsRecord | null;
    groupManaged?: boolean;
    missingPermissions?: Set<string>;
    permissionCache?: Map<string, boolean>;
    onboardingSent?: boolean;
    rateLimitedAt?: number;
    retryAfterSeconds?: number;
    rateLimitNotified?: number;
  };
};

export type ProcessingAction =
  | {
      type: "delete_message";
      messageId: number;
      reason?: string;
    }
  | {
      type: "warn_member";
      userId: number;
      reason: string;
      severity: "low" | "medium" | "high";
    }
  | {
      type: "restrict_member";
      userId: number;
      durationSeconds?: number;
      reason: string;
    }
  | {
      type: "kick_member";
      userId: number;
      reason?: string;
    }
  | {
      type: "ban_member";
      userId: number;
      untilDate?: number;
      reason?: string;
    }
  | {
      type: "send_message";
      text: string;
      replyToMessageId?: number;
      parseMode?: "HTML" | "MarkdownV2";
      autoDeleteSeconds?: number; // when set, dispatcher will attempt to delete the sent message after this many seconds
      threadId?: number;
      rescheduleOnPromotion?: boolean;
    }
  | {
      type: "record_moderation";
      ruleId: string;
      userId?: number;
      actions: string[];
      reason?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "record_rule_audit";
      ruleId: string;
      offenderId?: string;
      actionSummary: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: "log";
      level: "debug" | "info" | "warn" | "error";
      message: string;
      details?: Record<string, unknown>;
    }
  | {
      type: "noop";
    };

export type HandlerResult =
  | void
  | {
      actions?: ProcessingAction[];
    };

export interface UpdateHandler {
  readonly name: string;
  matches(ctx: GroupChatContext): boolean;
  handle(ctx: GroupChatContext): Promise<HandlerResult>;
}

export interface ProcessingConfig {
  concurrency: number;
  intervalCap: number;
  interval: number;
  warningThreshold: number;
  muteDurationSeconds: number;
  baseDelayMs: number;
  maxDelayMs: number;
  rateLimitDecayMs: number;
}

