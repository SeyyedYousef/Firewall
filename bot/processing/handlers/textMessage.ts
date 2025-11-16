import type { UpdateHandler, ProcessingAction } from "../types.js";
import { ensureActions, isGroupChat } from "../utils.js";
import type { GroupChatContext } from "../types.js";
import { runFirewall } from "../firewallEngine.js";
import { evaluateBanGuards } from "../banGuards.js";
import { logger } from "../../../server/utils/logger.js";

function isTextMessage(ctx: GroupChatContext): boolean {
  return Boolean(ctx.message && "text" in ctx.message && typeof ctx.message.text === "string");
}

export const textMessageHandler: UpdateHandler = {
  name: "group-text-message",
  matches(ctx) {
    return isGroupChat(ctx) && isTextMessage(ctx as GroupChatContext);
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
            message: "text message passed without restrictions",
            details: {
              chatId: ctx.chat?.id,
              userId: ctx.message && "from" in ctx.message ? ctx.message.from?.id : undefined,
            },
          },
        ]),
      };
    }

    logger.debug("text handler produced actions", {
      chatId: ctx.chat?.id,
      actionCount: actions.length,
    });

    return { actions: ensureActions(actions) };
  },
};
