import type { MissionCycle, Prisma } from "@prisma/client";

import { prisma } from "../db/client.js";
import type { MissionCategory } from "./missionTypes.js";

const RESET_HOUR_UTC = clampInt(process.env.MISSION_RESET_HOUR, 0, 23, 4);
const RESET_MINUTE_UTC = clampInt(process.env.MISSION_RESET_MINUTE, 0, 59, 0);
const WEEK_START_ISO = clampInt(process.env.MISSION_WEEK_START, 1, 7, 1); // 1 = Monday

type PrismaClientOrTx = Prisma.TransactionClient | typeof prisma;

export type MissionCycleWindow = Pick<MissionCycle, "category" | "cycleKey" | "windowStart" | "windowEnd" | "resetAt">;

export async function resolveActiveMissionCycle(
  category: MissionCategory,
  options?: { referenceDate?: Date; prismaClient?: PrismaClientOrTx },
): Promise<MissionCycleWindow> {
  const reference = options?.referenceDate ?? new Date();
  const client = options?.prismaClient ?? prisma;

  const { cycleKey, windowStart, windowEnd, resetAt } = calculateMissionCycle(category, reference);

  const existing = await client.missionCycle.findUnique({ where: { category } });
  if (existing && isWithinCycle(reference, existing.windowStart, existing.windowEnd) && existing.cycleKey === cycleKey) {
    return existing;
  }

  const record = await client.missionCycle.upsert({
    where: { category },
    update: {
      cycleKey,
      windowStart,
      windowEnd,
      resetAt,
    },
    create: {
      category,
      cycleKey,
      windowStart,
      windowEnd,
      resetAt,
    },
  });

  return record;
}

export function calculateMissionCycle(category: MissionCategory, reference: Date): MissionCycleWindow {
  const anchor = anchorToReset(reference);

  if (category === "daily") {
    const windowStart = anchor;
    const windowEnd = addDays(anchor, 1);
    return {
      category,
      cycleKey: formatCycleKey(windowStart, { kind: "daily" }),
      windowStart,
      windowEnd,
      resetAt: windowEnd,
    };
  }

  if (category === "weekly") {
    const start = startOfIsoWeek(anchor, WEEK_START_ISO);
    const end = addDays(start, 7);
    return {
      category,
      cycleKey: formatCycleKey(start, { kind: "weekly" }),
      windowStart: start,
      windowEnd: end,
      resetAt: end,
    };
  }

  if (category === "monthly") {
    const start = startOfMonth(anchor);
    const end = startOfNextMonth(anchor);
    return {
      category,
      cycleKey: formatCycleKey(start, { kind: "monthly" }),
      windowStart: start,
      windowEnd: end,
      resetAt: end,
    };
  }

  // "general" missions do not reset; use a stable sentinel cycle
  const start = anchorToReset(new Date(Date.UTC(1970, 0, 1)));
  return {
    category,
    cycleKey: "general",
    windowStart: start,
    windowEnd: addYears(start, 100),
    resetAt: addYears(start, 100),
  };
}

export function formatCycleKey(date: Date, options: { kind: "daily" | "weekly" | "monthly" }): string {
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());

  if (options.kind === "daily") {
    return `${year}-${month}-${day}T${hour}:${minute}Z`;
  }

  if (options.kind === "weekly") {
    const { week, isoYear } = getIsoWeek(date);
    return `${isoYear}-W${pad(week)}`;
  }

  return `${year}-${month}`;
}

function anchorToReset(input: Date): Date {
  const candidate = new Date(Date.UTC(
    input.getUTCFullYear(),
    input.getUTCMonth(),
    input.getUTCDate(),
    RESET_HOUR_UTC,
    RESET_MINUTE_UTC,
    0,
    0,
  ));

  if (input >= candidate) {
    return candidate;
  }

  candidate.setUTCDate(candidate.getUTCDate() - 1);
  return candidate;
}

function startOfIsoWeek(anchor: Date, isoWeekStart: number): Date {
  const isoDay = getIsoDay(anchor);
  const diff = (isoDay - isoWeekStart + 7) % 7;
  const start = new Date(anchor);
  start.setUTCDate(start.getUTCDate() - diff);
  return start;
}

function startOfMonth(anchor: Date): Date {
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, RESET_HOUR_UTC, RESET_MINUTE_UTC, 0, 0));
}

function startOfNextMonth(anchor: Date): Date {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  return new Date(Date.UTC(month === 11 ? year + 1 : year, (month + 1) % 12, 1, RESET_HOUR_UTC, RESET_MINUTE_UTC, 0, 0));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function getIsoWeek(date: Date): { isoYear: number; week: number } {
  const temp = new Date(date);
  temp.setUTCHours(0, 0, 0, 0);
  temp.setUTCDate(temp.getUTCDate() + 3 - getIsoDay(temp));

  const firstThursday = new Date(Date.UTC(temp.getUTCFullYear(), 0, 4));
  const diff = temp.getTime() - firstThursday.getTime();
  const week = 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));

  return { isoYear: temp.getUTCFullYear(), week };
}

function getIsoDay(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function isWithinCycle(reference: Date, start: Date, end: Date): boolean {
  return reference >= start && reference < end;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
