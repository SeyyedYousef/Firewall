import { describe, expect, it, vi } from "vitest";
import type { GroupChatContext } from "../bot/processing/types.js";
import { executeAction } from "../bot/processing/utils.js";

function createRateLimitError(retryAfterSeconds = 5) {
  return {
    response: {
      error_code: 429,
      description: "Too Many Requests",
      parameters: {
        retry_after: retryAfterSeconds,
      },
    },
  };
}

describe("executeAction behaviour", () => {
  it("records rate limit information on the processing context", async () => {
    const sendMessage = vi.fn().mockRejectedValue(createRateLimitError(7));
    const ctx = {
      chat: { id: -100, type: "supergroup", title: "Rate Limit Group" },
      botInfo: { id: 999, is_bot: true } as const,
      telegram: { sendMessage } as unknown,
      processing: {},
    } as unknown as GroupChatContext;

    await executeAction(ctx, {
      type: "send_message",
      text: "hello",
    });

    expect(sendMessage).toHaveBeenCalled();
    expect(ctx.processing?.rateLimitedAt).toBeTypeOf("number");
    expect(ctx.processing?.retryAfterSeconds).toBe(7);
  });

  it("allows bots with member status to send onboarding messages", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const getChatMember = vi.fn().mockResolvedValue({ status: "member" });
    const ctx = {
      chat: { id: -200, type: "supergroup", title: "Welcome Group" },
      botInfo: { id: 999, is_bot: true } as const,
      telegram: { sendMessage, getChatMember } as unknown,
      processing: {},
      message: { message_id: 1 },
    } as unknown as GroupChatContext;

    await executeAction(ctx, {
      type: "send_message",
      text: "Welcome!",
    });

    expect(sendMessage).toHaveBeenCalledWith(
      -200,
      "Welcome!",
      expect.objectContaining({
        reply_to_message_id: undefined,
        parse_mode: undefined,
        disable_web_page_preview: true,
        allow_sending_without_reply: true,
      }),
    );
  });
});
