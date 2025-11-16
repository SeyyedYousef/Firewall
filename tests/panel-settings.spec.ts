import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ONBOARDING_MESSAGES,
  getPanelSettings,
  setPanelSettings,
  setWelcomeMessages,
  setButtonLabels,
} from "../bot/state.js";

const originalSettings = getPanelSettings();

afterEach(() => {
  setPanelSettings(originalSettings);
  setWelcomeMessages(originalSettings.welcomeMessages);
  setButtonLabels(originalSettings.buttonLabels);
});

describe("panel settings sanitization", () => {
  it("ignores invalid numeric updates and repairs onboarding messages", () => {
    setPanelSettings({
      freeTrialDays: -42,
      onboardingMessages: ["????", "??", "", null as unknown as string, undefined as unknown as string],
    });

    const settings = getPanelSettings();
    expect(settings.freeTrialDays).toBe(0);
    expect(settings.onboardingMessages).toEqual(Array.from(DEFAULT_ONBOARDING_MESSAGES));
  });

  it("trims welcome messages and button labels", () => {
    setButtonLabels({ start_add_to_group: "   Start  " });

    const settings = getPanelSettings();
    expect(settings.buttonLabels.start_add_to_group).toBe("Start");
  });
});

