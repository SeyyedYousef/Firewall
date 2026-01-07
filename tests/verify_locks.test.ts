
import { describe, it, expect, beforeAll, mock } from "bun:test";
import type { GroupBanSettingsRecord } from "../server/db/groupSettingsRepository.js";
import type { Message } from "typegram";

// 1. Setup Environment
process.env.DATABASE_URL = "postgres://mock:5432/db";

// 2. Define Mocks
const mockGroupSettingsRepo = {
    loadBanSettingsByChatId: async (chatId) => {
        // console.log("Mock loadBanSettingsByChatId called for", chatId);
        return testState.currentSettings || null;
    },
    loadGeneralSettingsByChatId: async () => null,
    loadSilenceSettingsByChatId: async () => null,
    loadLimitSettingsByChatId: async () => null,
    loadCustomTextSettingsByChatId: async () => null,
};

const mockState = {
    hasCustomSchedule: () => false,
    hasVoteMute: () => false,
    hasExtraSilenceWindows: () => false,
    hasAutoWarning: () => false,
    hasAutoDelete: () => false,
    markAdminPermission: () => { },
    isPanelAdmin: () => false,
    getState: () => ({ groups: {} }),
    // Add all potential feature flags
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
};

// 3. Register Mocks
mock.module("../server/db/groupSettingsRepository.js", () => mockGroupSettingsRepo);
mock.module("../../server/db/groupSettingsRepository.js", () => mockGroupSettingsRepo); // for relative import in banGuards
mock.module("../bot/state.js", () => mockState);
mock.module("../../bot/state.js", () => mockState);

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
});
