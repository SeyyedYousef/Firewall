export type MissionCategory = "daily" | "weekly" | "monthly" | "general";

export const ALL_MISSION_CATEGORIES: readonly MissionCategory[] = [
  "daily",
  "weekly",
  "monthly",
  "general",
] as const;

export function isMissionCategory(value: unknown): value is MissionCategory {
  return typeof value === "string" && (ALL_MISSION_CATEGORIES as readonly string[]).includes(value);
}
