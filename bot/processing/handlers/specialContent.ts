import type { UpdateHandler, ProcessingAction } from "../types.js";
import type { GroupChatContext } from "../types.js";
import { ensureActions, isGroupChat } from "../utils.js";
import { logger } from "../../../server/utils/logger.js";
import { evaluateBanGuards } from "../banGuards.js";
import { runFirewall } from "../firewallEngine.js";

function hasSpecialContent(ctx: GroupChatContext): boolean {
  const message = ctx.message;
  if (!message) {
    return false;
  }

  const hasContact = "contact" in message && Boolean((message as any).contact);
  const hasLocation =
    ("location" in message && Boolean((message as any).location)) ||
    ("venue" in message && Boolean((message as any).venue));
  const hasPoll = "poll" in message && Boolean((message as any).poll);
  const hasGame = "game" in message && Boolean((message as any).game);

  return hasContact || hasLocation || hasPoll || hasGame;
}

export const specialContentHandler: UpdateHandler = {
  name: "group-special-content",
  matches(ctx) {
    return isGroupChat(ctx) && hasSpecialContent(ctx as GroupChatContext);
  },
  async handle(ctx) {
    const groupCtx = ctx as GroupChatContext;
    const actions: ProcessingAction[] = [];

    const banActions = await evaluateBanGuards(groupCtx);
    actions.push(...banActions);

    const hasDeletion = banActions.some((action) => action.type === "delete_message");

    if (!hasDeletion) {
      const firewallActions = await runFirewall(groupCtx);
      actions.push(...firewallActions);
    }

    if (!actions.length) {
      return {
        actions: ensureActions([
          {
            type: "log",
            level: "debug",
            message: "special content message passed without restrictions",
            details: {
              chatId: ctx.chat?.id,
              userId: ctx.message && "from" in ctx.message ? ctx.message.from?.id : undefined,
            },
          },
        ]),
      };
    }

    logger.debug("special content handler produced actions", {
      chatId: ctx.chat?.id,
      actionCount: actions.length,
    });

    return { actions: ensureActions(actions) };
  },
};
