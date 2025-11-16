import { describe, expect, it } from "vitest";
import { getState, __stateTest } from "../bot/state.js";

describe("bot state validation", () => {
  it("accepts the current in-memory state", () => {
    const state = getState();
    expect(() => __stateTest.validateBotState(state)).not.toThrow();
  });

  it("rejects malformed states", () => {
    const state = getState();
    const invalid = structuredClone(state);
    invalid.panelAdmins = [""]; // empty entries should fail validation

    expect(() => __stateTest.validateBotState(invalid)).toThrowError(/panelAdmins/i);
  });
});
