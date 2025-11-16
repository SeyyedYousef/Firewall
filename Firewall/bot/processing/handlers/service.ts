import type { UpdateHandler } from "../types.js";
import type { GroupChatContext, ProcessingAction } from "../types.js";
import { ensureActions, isGroupChat } from "../utils.js";

function hasServiceEvent(ctx: GroupChatContext): boolean {
  const message = ctx.message;
  if (!message) {
    return false;
  }
  return Boolean(
    ("pinned_message" in message && Boolean((message as any).pinned_message)) ||
      ("new_chat_title" in message && typeof (message as any).new_chat_title === "string" && (message as any).new_chat_title.length > 0) ||
      ("new_chat_photo" in message && Boolean((message as any).new_chat_photo)) ||
      ("delete_chat_photo" in message && Boolean((message as any).delete_chat_photo)) ||
      ("group_chat_created" in message && Boolean((message as any).group_chat_created)) ||
      ("supergroup_chat_created" in message && Boolean((message as any).supergroup_chat_created)),
  );
}

export const serviceHandler: UpdateHandler = {
  name: "group-service-events",
  matches(ctx) {
    return isGroupChat(ctx) && hasServiceEvent(ctx);
  },
  async handle(ctx) {
    const message = ctx.message!;
    if (!isGroupChat(ctx)) return { actions: ensureActions([]) };

    const pinned = "pinned_message" in message && Boolean((message as any).pinned_message);
    const newTitle = "new_chat_title" in message && typeof (message as any).new_chat_title === "string" ? (message as any).new_chat_title : undefined;
    const hasNewPhoto = "new_chat_photo" in message && Boolean((message as any).new_chat_photo);
    const deletePhoto = "delete_chat_photo" in message && Boolean((message as any).delete_chat_photo);
    const groupCreated = "group_chat_created" in message && Boolean((message as any).group_chat_created);
    const supergroupUpgrade = "supergroup_chat_created" in message && Boolean((message as any).supergroup_chat_created);
    const actions: ProcessingAction[] = [
      {
        type: "log",
        level: "info",
        message: "service event received",
        details: {
          chatId: ctx.chat.id,
          update: {
            pinned,
            newTitle,
            hasNewPhoto,
            deletePhoto,
            groupCreated,
            supergroupUpgrade,
          },
        },
      },
    ];

      if (pinned) {
      actions.push({
        type: "send_message",
        text: "A new message was pinned. Please review the updated announcement.",
        replyToMessageId: message.message_id,
        parseMode: "HTML",
      });
    }
      if (newTitle) {
        actions.push({
          type: "send_message",
          text: `Group title updated to <b>${escapeHtml(newTitle)}</b>.`,
          replyToMessageId: message.message_id,
          parseMode: "HTML",
        });
      }

      if (deletePhoto) {
      actions.push({
        type: "send_message",
        text: "Group photo was removed.",
        replyToMessageId: message.message_id,
        parseMode: "HTML",
      });
    }

    return { actions: ensureActions(actions) };
  },
};

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
