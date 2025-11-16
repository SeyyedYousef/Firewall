import { describe, expect, it } from "vitest";

import { calculateMissionCycle } from "../server/services/missionCycleService.js";

describe("missionCycleService.calculateMissionCycle", () => {
  it("aligns daily cycle to configured reset time", () => {
    const reference = new Date("2025-02-04T06:15:00.000Z");
    const cycle = calculateMissionCycle("daily", reference);
    expect(cycle.windowStart.getUTCHours()).toBeGreaterThanOrEqual(0);
    expect(cycle.windowStart.getUTCHours()).toBeLessThan(24);
    expect(cycle.windowEnd.getTime() - cycle.windowStart.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(cycle.cycleKey).toMatch(/^2025-02-0[34]T\d{2}:\d{2}Z$/);
  });

  it("computes weekly cycle using ISO week format", () => {
    const reference = new Date("2025-02-05T10:00:00.000Z");
    const cycle = calculateMissionCycle("weekly", reference);
    expect(cycle.cycleKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(cycle.windowEnd.getTime() - cycle.windowStart.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("returns sentinel window for general missions", () => {
    const reference = new Date("2025-02-05T10:00:00.000Z");
    const cycle = calculateMissionCycle("general", reference);
    expect(cycle.cycleKey).toBe("general");
    expect(cycle.windowEnd.getUTCFullYear() - cycle.windowStart.getUTCFullYear()).toBeGreaterThan(90);
  });

  it("sets resetAt to the end of each window for recurring missions", () => {
    const daily = calculateMissionCycle("daily", new Date("2025-02-10T03:00:00.000Z"));
    expect(daily.resetAt.getTime()).toBe(daily.windowEnd.getTime());

    const weekly = calculateMissionCycle("weekly", new Date("2025-02-10T03:00:00.000Z"));
    expect(weekly.resetAt.getTime()).toBe(weekly.windowEnd.getTime());

    const monthly = calculateMissionCycle("monthly", new Date("2025-02-10T03:00:00.000Z"));
    expect(monthly.resetAt.getTime()).toBe(monthly.windowEnd.getTime());
  });
});
