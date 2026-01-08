
import { describe, it, expect, mock, beforeAll } from "bun:test";

// Mock dependencies BEFORE importing the module under test
const mocks = {
    groupSettingsRepo: {
        loadBanSettingsByChatId: async () => ({
            chatId: "123",
            rules: {},
            blacklist: [],
        }),
        saveBanSettingsByChatId: async () => { },
        loadGeneralSettingsByChatId: async () => null,
        loadSilenceSettingsByChatId: async () => null,
        loadLimitSettingsByChatId: async () => null,
        loadCustomTextSettingsByChatId: async () => null,
        loadMandatoryMembershipSettingsByChatId: async () => null,
        saveCustomTextSettingsByChatId: async () => null,
        saveGroupCountLimitSettingsByChatId: async () => null,
        saveMandatoryMembershipSettingsByChatId: async () => null,
        saveSilenceSettingsByChatId: async () => null,
        saveGeneralSettingsByChatId: async () => null,
    },
    userPanelRepo: { // Mocking the userPanelRepository
        getUserPanelSettings: async () => ({
            groupId: "123",
            telegramUserId: "456",
            nickname: null,
            bio: null,
            lockOverrides: {}
        }),
        setUserNickname: async () => { },
        setUserBio: async () => { },
    },
    stateRepo: { // Mocking stateRepository
        listMembershipEventsSince: async () => [],
    },
    state: {
        isGroupPremium: () => true,
    },
    logger: {
        info: () => { },
        error: () => { },
        warn: () => { },
    },
    rssParser: class {
        parseURL() { return { items: [] }; }
    },
    sharp: () => ({
        resize: () => ({
            webp: () => ({
                toBuffer: async () => Buffer.from([])
            })
        })
    })
};

// Apply mocks
mock.module("../server/db/groupSettingsRepository.js", () => mocks.groupSettingsRepo);
mock.module("../../../server/db/groupSettingsRepository.js", () => mocks.groupSettingsRepo);
mock.module("../server/db/userPanelRepository.js", () => mocks.userPanelRepo);
mock.module("../../../server/db/userPanelRepository.js", () => mocks.userPanelRepo);
mock.module("../server/db/stateRepository.js", () => mocks.stateRepo);
mock.module("../../../server/db/stateRepository.js", () => mocks.stateRepo);
mock.module("../bot/state.js", () => mocks.state);
mock.module("../../state.js", () => mocks.state); // Relative import in textCommands.ts
mock.module("../server/utils/logger.js", () => ({ logger: mocks.logger }));
mock.module("../../../server/utils/logger.js", () => ({ logger: mocks.logger }));
mock.module("rss-parser", () => mocks.rssParser);
mock.module("sharp", () => mocks.sharp);


// Import the handler AFTER mocking
import { textCommandsHandler } from "../bot/processing/handlers/textCommands.js";

function createMockContext(text: string) {
    return {
        chat: { id: 123456789, type: 'supergroup' },
        message: {
            message_id: 1,
            text: text,
            from: { id: 987654321, first_name: "TestUser" },
            chat: { id: 123456789, type: 'supergroup' }
        },
        telegram: {
            getChatMember: async () => ({ status: 'administrator', user: { id: 987654321, first_name: "TestUser" } })
        }
    } as any;
}

describe("Panel Commands", () => {
    it("should handle !font command correctly with multiple styles", async () => {
        const ctx = createMockContext("!font Hello");
        const result = await textCommandsHandler.handle(ctx);
        const actions = result.actions;

        expect(actions).toHaveLength(2); // delete_message + send_message
        const sendAction = actions.find((a: any) => a.type === "send_message");
        expect(sendAction).toBeDefined();

        const responseText = (sendAction as any).text;

        // Verify it contains multiple styles (checking for specific chars from the font maps)
        // Monospace H
        expect(responseText).toContain("𝙷");
        // Bold H
        expect(responseText).toContain("𝐇");
        // Italic H
        expect(responseText).toContain("𝘏");
        // Script H
        expect(responseText).toContain("𝓗");
        // Bubbles H
        expect(responseText).toContain("Ⓗ");
    });

    it("should handle !panelpv command", async () => {
        const ctx = createMockContext("!panelpv");
        const result = await textCommandsHandler.handle(ctx);
        const actions = result.actions;

        expect(actions).toHaveLength(2);
        const sendAction = actions.find((a: any) => a.type === "send_message");
        expect(sendAction).toBeDefined();
        expect((sendAction as any).text).toContain("Private Panel");
    });
});
