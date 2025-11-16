import { calculateMissionCycle, resolveActiveMissionCycle } from "../../server/services/missionCycleService.js";
import { ALL_MISSION_CATEGORIES } from "../../server/services/missionTypes.js";
import { logger } from "../../server/utils/logger.js";

let missionResetTimer: NodeJS.Timeout | null = null;

export async function startMissionResetJob(): Promise<void> {
  try {
    const now = new Date();
    await Promise.all(
      ALL_MISSION_CATEGORIES.map((category) => resolveActiveMissionCycle(category, { referenceDate: now })),
    );
  } catch (error) {
    logger.warn("mission reset job failed to warm active cycles", { error });
  }
  scheduleNextReset();
}

function scheduleNextReset(): void {
  const now = new Date();
  const nextResetAt = computeNextResetAt(now);
  const delay = Math.max(1, nextResetAt.getTime() - now.getTime());

  if (missionResetTimer) {
    clearTimeout(missionResetTimer);
  }

  missionResetTimer = setTimeout(async () => {
    missionResetTimer = null;
    await runMissionReset().catch((error) => {
      logger.error("mission reset job failed", { error });
    });
    scheduleNextReset();
  }, delay);

  logger.info("mission reset job scheduled", {
    nextResetAt: nextResetAt.toISOString(),
    delayMs: delay,
  });
}

async function runMissionReset(): Promise<void> {
  const reference = new Date();
  await Promise.all(
    ALL_MISSION_CATEGORIES.map(async (category) => {
      await resolveActiveMissionCycle(category, { referenceDate: reference });
    }),
  );
  logger.info("mission reset completed", { timestamp: reference.toISOString() });
}

function computeNextResetAt(now: Date): Date {
  const daily = calculateMissionCycle("daily", now);
  if (daily.resetAt.getTime() > now.getTime()) {
    return daily.resetAt;
  }

  // We're already past today's reset; look ahead slightly.
  const future = new Date(now.getTime() + 60_000);
  return calculateMissionCycle("daily", future).resetAt;
}
