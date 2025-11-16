import { describe, expect, it, vi } from "vitest";

const sendTelegramMessage = vi.fn().mockResolvedValue(undefined);

vi.mock("../server/utils/telegramBotApi.js", () => ({
  sendTelegramMessage,
}));

const { notifyUserOfCreditCode } = await import("../server/services/creditCodeService.js");

describe("credit code notifications", () => {
  it("delivers actionable DM instructions", async () => {
    await notifyUserOfCreditCode({
      telegramUserId: "123456789",
      code: "FW-ABCD-1234-EFGH",
      valueDays: 14,
    });

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 123456789,
        parseMode: "HTML",
      }),
    );

    const { text } = sendTelegramMessage.mock.calls[0]![0] as { text: string };
    expect(text).toContain("FW-ABCD-1234-EFGH");
    expect(text).toContain("14 days of uptime");
    expect(text).toContain("Send this code in a group where Firewall is an admin");
  });

  it("throws when the user id cannot be converted to a number", async () => {
    await expect(
      notifyUserOfCreditCode({
        telegramUserId: "not-a-number",
        code: "FW-ABCD-1234",
        valueDays: 7,
      }),
    ).rejects.toThrow("Telegram user id must be numeric");
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});
