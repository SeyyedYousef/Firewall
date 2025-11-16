type WarningKey = `${string}:${string}`;

const warnings = new Map<WarningKey, number>();

function makeKey(chatId: number | string, userId: number | string): WarningKey {
  return `${chatId}:${userId}`;
}

export function registerWarning(chatId: number, userId: number): number {
  const key = makeKey(chatId, userId);
  const current = warnings.get(key) ?? 0;
  const next = current + 1;
  warnings.set(key, next);
  return next;
}

export function resetWarnings(chatId: number, userId: number): void {
  const key = makeKey(chatId, userId);
  warnings.delete(key);
}

export function getWarningCount(chatId: number, userId: number): number {
  return warnings.get(makeKey(chatId, userId)) ?? 0;
}
