import { describe, expect, it, beforeEach, vi } from "vitest";
import { membershipHandler } from "../bot/processing/handlers/membership.js";

function buildContext(overrides: Partial<any> = {}) {
  const base = {
    chat: { id: -100123456, type: "supergroup", title: "Demo Group" },
    message: {
      message_id: 1,
      new_chat_members: [{ id: 999, is_bot: true, first_name: "Firewall" }],
    },
    botInfo: { id: 999, is_bot: true },
    telegram: {
      getChatMember: vi.fn().mockResolvedValue({ status: "member" }),
      sendMessage: vi.fn().mockResolvedValue({}),
    },
    processing: {},
    update: {},
  };
  return Object.assign(base, overrides);
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
});

describe("membership handler onboarding", () => {
  it("sends onboarding messages when bot is not admin", async () => {
    const ctx = buildContext();
    const result = await membershipHandler.handle(ctx as any);
    const actions = result.actions ?? [];
    const sendMessages = actions.filter((action) => action.type === "send_message");
    expect(sendMessages.length).toBeGreaterThanOrEqual(3);
    const helper = sendMessages.find((action) => action.text?.includes("is now active in this group"));
    expect(helper).toBeUndefined();
  });

  it("omits guidance when the bot already has admin rights", async () => {
    const ctx = buildContext({
      telegram: {
        getChatMember: vi.fn().mockResolvedValue({ status: "administrator" }),
        sendMessage: vi.fn().mockResolvedValue({}),
      },
    });
    const result = await membershipHandler.handle(ctx as any);
    const sendMessages = (result.actions ?? []).filter((action) => action.type === "send_message");
    const helper = sendMessages.find((action) => action.text?.includes("is now active in this group"));
    expect(helper).toBeUndefined();
  });
});
