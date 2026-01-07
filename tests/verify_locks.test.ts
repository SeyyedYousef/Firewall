
import { describe, it, expect, beforeAll, mock } from "bun:test";
import type { GroupBanSettingsRecord } from "../server/db/groupSettingsRepository.js";
import type { Message } from "typegram";

// 1. Setup Environment
process.env.DATABASE_URL = "postgres://mock:5432/db";

// 2. Define Mocks
// 2. Define Mocks
const mocks = {
    groupSettingsRepo: {
        loadBanSettingsByChatId: async (chatId) => {
            return testState.currentSettings || null;
        },
        loadGeneralSettingsByChatId: async () => null,
        loadSilenceSettingsByChatId: async () => null,
        loadLimitSettingsByChatId: async () => null,
        loadCustomTextSettingsByChatId: async () => null,
    },

    state: {
        hasCustomSchedule: () => false,
        hasVoteMute: () => false,
        hasExtraSilenceWindows: () => false,
        hasAutoWarning: () => false,
        hasAutoDelete: () => false,
        markAdminPermission: () => { },
        isPanelAdmin: () => false,
        getState: () => ({ groups: {} }),
        hasPromoButton: () => false,
        hasMandatoryMembership: () => false,
        hasMandatoryAdd: () => false,
        hasDetailedWarnings: () => false,
        hasAdvancedAnalytics: () => false,
        hasAdvancedCaptcha: () => false,
        hasExtraMandatoryChannels: () => false,
        hasWebhook: () => false,
        hasPriorityProcessing: () => false,
        queuePendingOnboardingMessages: () => { },
        isGroupPremium: () => false,
    },

    mockTabchiService: {
        analyzeAndFlagIfTabchi: async () => false,
    }
};

// 3. Register Mocks
mock.module("../server/db/groupSettingsRepository.js", () => mocks.groupSettingsRepo);
mock.module("../../server/db/groupSettingsRepository.js", () => mocks.groupSettingsRepo); // for relative import in banGuards
mock.module("../bot/state.js", () => mocks.state);
mock.module("../../bot/state.js", () => mocks.state);
mock.module("../server/services/tabchiService.js", () => mocks.mockTabchiService);

// Test State
const testState = {
    currentSettings: null as GroupBanSettingsRecord | null
};

// Mock Data
const MOCK_CHAT_ID = "123456789";
const MOCK_USER_ID = 987654321;
const MOCK_TIMESTAMP = Math.floor(Date.now() / 1000);

const defaultBanSettings: GroupBanSettingsRecord = {
    chatId: MOCK_CHAT_ID,
    rules: {
        banLinks: { enabled: false },
        banPhotos: { enabled: false },
        banForwardChannels: { enabled: false },
        // ...
    } as any,
    updatedAt: new Date().toISOString(),
};

function createMockContext(message: Partial<Message.CommonMessage>) {
    return {
        chat: { id: Number(MOCK_CHAT_ID), type: 'supergroup' },
        from: { id: MOCK_USER_ID, is_bot: false, first_name: "TestUser" },
        message: {
            message_id: 1,
            date: MOCK_TIMESTAMP,
            chat: { id: Number(MOCK_CHAT_ID), type: 'supergroup' },
            from: { id: MOCK_USER_ID, is_bot: false, first_name: "TestUser" },
            ...message
        },
        telegram: {
            getChatMember: async () => ({ status: 'member' })
        }
    } as any;
}

describe("Firewall Lock Verification", () => {
    let evaluateBanGuards: any;

    beforeAll(async () => {
        // Dynamic import to ensure mocks and env vars apply
        const mod = await import("../bot/processing/banGuards.js");
        evaluateBanGuards = mod.evaluateBanGuards;
    });

    it("should allow messages when lock is disabled", async () => {
        const chatId = "1001";
        testState.currentSettings = {
            ...defaultBanSettings,
            chatId,
            rules: { ...defaultBanSettings.rules, banLinks: { enabled: false } }
        };

        const ctx = createMockContext({ text: "Check out https://google.com" });
        ctx.chat.id = Number(chatId);

        const actions = await evaluateBanGuards(ctx);
        expect(actions).toEqual([]);
    });

    it("should BLOCK links when Link Lock is enabled", async () => {
        const chatId = "1002";
        testState.currentSettings = {
            ...defaultBanSettings,
            chatId,
            rules: { ...defaultBanSettings.rules, banLinks: { enabled: true } }
        };

        const ctx = createMockContext({
            text: "Check out https://google.com",
            entities: [{ type: 'url', offset: 10, length: 18 }]
        });
        ctx.chat.id = Number(chatId);

        const actions = await evaluateBanGuards(ctx);
        const deleteAction = actions.find((a: any) => a.type === 'delete_message');
        expect(deleteAction).toBeDefined();
    });

    it("should BLOCK photos when Photo Lock is enabled", async () => {
        const chatId = "1003";
        testState.currentSettings = {
            ...defaultBanSettings,
            chatId,
            rules: { ...defaultBanSettings.rules, banPhotos: { enabled: true } }
        };

        const ctx = createMockContext({
            photo: [{ file_id: '123', width: 100, height: 100 }]
        });
        ctx.chat.id = Number(chatId);

        const actions = await evaluateBanGuards(ctx);
        expect(actions.some((a: any) => a.type === 'delete_message')).toBe(true);
    });

    it("should BLOCK forwarding from channels when Forward Channel Lock is enabled", async () => {
        const chatId = "1005";
        testState.currentSettings = {
            ...defaultBanSettings,
            chatId,
            rules: { ...defaultBanSettings.rules, banForwardChannels: { enabled: true } }
        };

        const ctx = createMockContext({
            forward_from_chat: { id: -123, type: 'channel', title: "Some Channel" } as any,
            forward_date: 12345
        });
        ctx.chat.id = Number(chatId);

        const actions = await evaluateBanGuards(ctx);
        expect(actions.some((a: any) => a.type === 'delete_message')).toBe(true);
    });

    it("should BLOCK stickers when Sticker Lock is enabled", async () => {
        const chatId = "1006";
        testState.currentSettings = {
            ...defaultBanSettings,
            chatId,
            rules: { ...defaultBanSettings.rules, banStickers: { enabled: true } }
        };

        // Mock sticker message
        const ctx = createMockContext({
            sticker: { file_id: "123", width: 512, height: 512, is_animated: false, is_video: false, type: "regular" }
        });
        ctx.chat.id = Number(chatId);

        const actions = await evaluateBanGuards(ctx);
        expect(actions.some((a: any) => a.type === 'delete_message')).toBe(true);
    });

    it("should BLOCK bots when Bot Lock is enabled", async () => {
        const chatId = "1007";
        testState.currentSettings = {
            ...defaultBanSettings,
            chatId,
            rules: { ...defaultBanSettings.rules, banBots: { enabled: true } }
        };

        // Mock message from a bot
        const ctx = createMockContext({
            text: "I am a bot",
            from: { id: 12345, is_bot: true, first_name: "Bad Bot" } as any
        });
        ctx.chat.id = Number(chatId);

        const actions = await evaluateBanGuards(ctx);
        expect(actions.some((a: any) => a.type === 'delete_message')).toBe(true);
        // banBots usually adds ban_member too if configured, but default delete is enough to test rule trigger
    });

    it("should BLOCK text patterns when Pattern Lock matches", async () => {
        const chatId = "1008";
        testState.currentSettings = {
            ...defaultBanSettings,
            chatId,
            rules: { ...defaultBanSettings.rules, banTextPatterns: { enabled: true } },
            blacklist: ["badword", "spam"]
        };

        const ctx = createMockContext({
            text: "This message contains a badword here."
        });
        ctx.chat.id = Number(chatId);

        const actions = await evaluateBanGuards(ctx);
        expect(actions.some((a: any) => a.type === 'delete_message')).toBe(true);
    });
});
