import type { UpdateHandler } from "../types.js";
import type { GroupChatContext, ProcessingAction } from "../types.js";
import { ensureActions, isGroupChat } from "../utils.js";
import { logger } from "../../../server/utils/logger.js";
import { runFirewall } from "../firewallEngine.js";
import { evaluateBanGuards } from "../banGuards.js";

const MAX_MEDIA_SIZE_MB = Number.parseInt(process.env.MEDIA_MAX_SIZE_MB ?? "15", 10);

function getMediaSize(ctx: GroupChatContext): number | null {
  const message = ctx.message;
  if (!message) {
    return null;
  }
  if ("document" in message && message.document?.file_size) {
    return message.document.file_size / (1024 * 1024);
  }
  if ("video" in message && message.video?.file_size) {
    return message.video.file_size / (1024 * 1024);
  }
  if ("animation" in message && message.animation?.file_size) {
    return message.animation.file_size / (1024 * 1024);
  }
  if ("voice" in message && message.voice?.file_size) {
    return message.voice.file_size / (1024 * 1024);
  }
  if ("audio" in message && message.audio?.file_size) {
    return message.audio.file_size / (1024 * 1024);
  }
  if ("photo" in message && message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    if (largest.file_size) {
      return largest.file_size / (1024 * 1024);
    }
  }
  return null;
}

function buildOversizeActions(ctx: GroupChatContext, size: number): ProcessingAction[] {
  const messageId = ctx.message?.message_id ?? 0;
  const userId = ctx.message?.from?.id ?? 0;

  return [
    {
      type: "delete_message",
      messageId,
      reason: `Media size ${size.toFixed(2)}MB exceeded the limit of ${MAX_MEDIA_SIZE_MB}MB.`,
    },
    {
      type: "warn_member",
      userId,
      reason: "Large media files are not allowed in this group.",
      severity: "medium",
    },
    {
      type: "log",
      level: "warn",
      message: "deleted oversized media",
      details: {
        chatId: ctx.chat.id,
        userId,
        sizeMb: size,
      },
    },
  ];
}

function buildDefaultLog(ctx: GroupChatContext, size: number | null): ProcessingAction[] {
  return [
    {
      type: "log",
      level: "debug",
      message: "media message processed",
      details: {
        chatId: ctx.chat.id,
        userId: ctx.message?.from?.id,
        sizeMb: size,
        mediaTypes: extractMediaTypes(ctx),
      },
    },
  ];
}

function extractMediaTypes(ctx: GroupChatContext): string[] {
  const types: string[] = [];
  const message = ctx.message;
  if (!message) {
    return types;
  }
  if ("photo" in message && message.photo?.length) {
    types.push("photo");
  }
  if ("video" in message && message.video) {
    types.push("video");
  }
  if ("document" in message && message.document) {
    types.push("document");
  }
  if ("animation" in message && message.animation) {
    types.push("animation");
  }
  if ("audio" in message && message.audio) {
    types.push("audio");
  }
  if ("voice" in message && message.voice) {
    types.push("voice");
  }
  if ("sticker" in message && message.sticker) {
    types.push("sticker");
  }
  if ("video_note" in message && message.video_note) {
    types.push("video_note");
  }
  return types;
}

export const mediaHandler: UpdateHandler = {
  name: "group-media-message",
  matches(ctx) {
    if (!isGroupChat(ctx) || !ctx.message) {
      return false;
    }
    const types = extractMediaTypes(ctx as GroupChatContext);
    return types.length > 0;
  },
  async handle(ctx) {
    const groupCtx = ctx as GroupChatContext;
    const size = getMediaSize(groupCtx);
    const actions: ProcessingAction[] = [];

    if (size !== null && size > MAX_MEDIA_SIZE_MB) {
      actions.push(...buildOversizeActions(groupCtx, size));
    }

    const banActions = await evaluateBanGuards(groupCtx);
    actions.push(...banActions);

    const hasDeletion = banActions.some((action) => action.type === "delete_message");

    if (!hasDeletion) {
      const firewallActions = await runFirewall(groupCtx);
      actions.push(...firewallActions);
    }

    if (!actions.length) {
      actions.push(...buildDefaultLog(groupCtx, size));
    }

    logger.debug("media handler executed", {
      chatId: ctx.chat?.id,
      actionCount: actions.length,
    });

    return { actions: ensureActions(actions) };
  },
};
