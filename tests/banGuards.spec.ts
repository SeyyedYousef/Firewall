import { describe, expect, it, beforeEach, vi } from "vitest";
import type { GroupBanSettingsRecord } from "../server/db/groupSettingsRepository.js";
import type { GroupChatContext } from "../bot/processing/types.js";

const CHAT_ID = "-1007770001234";

function buildSettings(overrides: Partial<GroupBanSettingsRecord["rules"]>): GroupBanSettingsRecord {
  return {
    rules: {
      banLinks: { enabled: false, schedule: { mode: "all" } },
      banDomains: { enabled: false, schedule: { mode: "all" } },
      banBots: { enabled: false, schedule: { mode: "all" } },
      banBotInviters: { enabled: false, schedule: { mode: "all" } },
      banTextPatterns: { enabled: false, schedule: { mode: "all" } },
      banForward: { enabled: false, schedule: { mode: "all" } },
      banForwardChannels: { enabled: false, schedule: { mode: "all" } },
      banStickers: { enabled: false, schedule: { mode: "all" } },
      banPhotos: { enabled: false, schedule: { mode: "all" } },
      banVideos: { enabled: false, schedule: { mode: "all" } },
      banVoice: { enabled: false, schedule: { mode: "all" } },
      banAudio: { enabled: false, schedule: { mode: "all" } },
      banFiles: { enabled: false, schedule: { mode: "all" } },
      banApps: { enabled: false, schedule: { mode: "all" } },
      banGif: { enabled: false, schedule: { mode: "all" } },
      banPolls: { enabled: false, schedule: { mode: "all" } },
      banInlineKeyboards: { enabled: false, schedule: { mode: "all" } },
      banGames: { enabled: false, schedule: { mode: "all" } },
      banSlashCommands: { enabled: false, schedule: { mode: "all" } },
      banCaptionless: { enabled: false, schedule: { mode: "all" } },
      banUsernames: { enabled: false, schedule: { mode: "all" } },
      banHashtags: { enabled: false, schedule: { mode: "all" } },
      banEmojis: { enabled: false, schedule: { mode: "all" } },
      banEmojiOnly: { enabled: false, schedule: { mode: "all" } },
      banLocation: { enabled: false, schedule: { mode: "all" } },
      banPhones: { enabled: false, schedule: { mode: "all" } },
      banLatin: { enabled: false, schedule: { mode: "all" } },
      banPersian: { enabled: false, schedule: { mode: "all" } },
      banCyrillic: { enabled: false, schedule: { mode: "all" } },
      banChinese: { enabled: false, schedule: { mode: "all" } },
      banUserReplies: { enabled: false, schedule: { mode: "all" } },
      banCrossReplies: { enabled: false, schedule: { mode: "all" } },
      ...overrides,
    },
    blacklist: [],
    whitelist: [],
  };
}

function buildCtx(message: Record<string, unknown>): GroupChatContext {
  return {
    chat: { id: Number(CHAT_ID), type: "supergroup" } as GroupChatContext["chat"],
    message: message as GroupChatContext["message"],
    botInfo: { id: 999 } as GroupChatContext["botInfo"],
    telegram: {} as GroupChatContext["telegram"],
    processing: {},
    update: {},
  } as unknown as GroupChatContext;
}

async function importBanGuards(settings: GroupBanSettingsRecord) {
  vi.resetModules();
  process.env.DATABASE_URL = "postgres://test-db";
  vi.doMock("../server/db/groupSettingsRepository.js", () => ({
    loadBanSettingsByChatId: vi.fn().mockResolvedValue(settings),
  }));
  const module = await import("../bot/processing/banGuards.js");
  vi.doUnmock("../server/db/groupSettingsRepository.js");
  const { primeBanSettings, evaluateBanGuards } = module;
  return { primeBanSettings, evaluateBanGuards };
}

describe("ban guards enforcement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("blocks messages when banLinks is enabled", async () => {
    const { primeBanSettings, evaluateBanGuards } = await importBanGuards(
      buildSettings({
        banLinks: { enabled: true, schedule: { mode: "all" } },
      }),
    );

    const ctx = buildCtx({
      message_id: 42,
      date: Math.floor(Date.now() / 1000),
      text: "visit http://spam.example now",
      entities: [{ type: "url", offset: 6, length: 18 }],
      from: { id: 555 },
    });

    await primeBanSettings(ctx);
    const actions = await evaluateBanGuards(ctx);

    expect(actions.some((a) => a.type === "delete_message")).toBe(true);
    expect(actions.some((a) => a.type === "warn_member")).toBe(true);
  });

  it("does not trigger when rule is disabled", async () => {
    const { primeBanSettings, evaluateBanGuards } = await importBanGuards(
      buildSettings({
        banLinks: { enabled: false, schedule: { mode: "all" } },
      }),
    );

    const ctx = buildCtx({
      message_id: 99,
      date: Math.floor(Date.now() / 1000),
      text: "check https://example.com",
      entities: [{ type: "url", offset: 6, length: 19 }],
      from: { id: 444 },
    });

    await primeBanSettings(ctx);
    const actions = await evaluateBanGuards(ctx);
    expect(actions).toHaveLength(0);
  });

  it("blocks sticker messages when banStickers is enabled", async () => {
    const { primeBanSettings, evaluateBanGuards } = await importBanGuards(
      buildSettings({
        banStickers: { enabled: true, schedule: { mode: "all" } },
      }),
    );

    const ctx = buildCtx({
      message_id: 55,
      date: Math.floor(Date.now() / 1000),
      sticker: { file_id: "FILE" },
      from: { id: 333 },
    });

    await primeBanSettings(ctx);
    const actions = await evaluateBanGuards(ctx);
    expect(actions.some((a) => a.type === "delete_message")).toBe(true);
  });

  it("blocks username mentions when banUsernames is enabled", async () => {
    const { primeBanSettings, evaluateBanGuards } = await importBanGuards(
      buildSettings({
        banUsernames: { enabled: true, schedule: { mode: "all" } },
      }),
    );

    const ctx = buildCtx({
      message_id: 77,
      date: Math.floor(Date.now() / 1000),
      text: "ping @spamuser",
      entities: [{ type: "mention", offset: 5, length: 9 }],
      from: { id: 888 },
    });

    await primeBanSettings(ctx);
    const actions = await evaluateBanGuards(ctx);
    expect(actions.some((a) => a.type === "delete_message")).toBe(true);
  });

  it("blocks bot senders when banBots is enabled", async () => {
    const { primeBanSettings, evaluateBanGuards } = await importBanGuards(
      buildSettings({
        banBots: { enabled: true, schedule: { mode: "all" } },
      }),
    );

    const ctx = buildCtx({
      message_id: 88,
      date: Math.floor(Date.now() / 1000),
      text: "bot message",
      from: { id: 321, is_bot: true },
    });

    await primeBanSettings(ctx);
    const actions = await evaluateBanGuards(ctx);
    expect(actions.some((a) => a.type === "delete_message")).toBe(true);
  });

  it("blocks polls when banPolls is enabled", async () => {
    const { primeBanSettings, evaluateBanGuards } = await importBanGuards(
      buildSettings({
        banPolls: { enabled: true, schedule: { mode: "all" } },
      }),
    );

    const ctx = buildCtx({
      message_id: 101,
      date: Math.floor(Date.now() / 1000),
      poll: { id: "poll", question: "Test", options: [] },
      from: { id: 654 },
    });

    await primeBanSettings(ctx);
    const actions = await evaluateBanGuards(ctx);
    expect(actions.some((a) => a.type === "delete_message")).toBe(true);
  });

  it("blocks Persian text when banPersian is enabled", async () => {
    const { primeBanSettings, evaluateBanGuards } = await importBanGuards(
      buildSettings({
        banPersian: { enabled: true, schedule: { mode: "all" } },
      }),
    );

    const ctx = buildCtx({
      message_id: 202,
      date: Math.floor(Date.now() / 1000),
      text: "سلام به همه",
      from: { id: 987 },
    });

    await primeBanSettings(ctx);
    const actions = await evaluateBanGuards(ctx);
    expect(actions.some((a) => a.type === "delete_message")).toBe(true);
  });

  it("skips enforcement for unmanaged groups", async () => {
    const { primeBanSettings, evaluateBanGuards } = await importBanGuards(
      buildSettings({
        banLinks: { enabled: true, schedule: { mode: "all" } },
      }),
    );

    const ctx = buildCtx({
      message_id: 7,
      date: Math.floor(Date.now() / 1000),
      text: "http://blocked.example",
      entities: [{ type: "url", offset: 0, length: 22 }],
      from: { id: 222 },
    });

    await primeBanSettings(ctx);
    ctx.processing!.groupManaged = false;
    const actions = await evaluateBanGuards(ctx);
    expect(actions).toHaveLength(0);
  });
});



