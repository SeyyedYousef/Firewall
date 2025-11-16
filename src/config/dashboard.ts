const inviteLink = (import.meta.env.VITE_INVITE_LINK as string | undefined)?.trim();
const rawDelay =
  import.meta.env.VITE_DASHBOARD_DELAY_MS ??
  (import.meta.env.DEV ? "300" : "0");
const parsedMockDelay = Number(rawDelay);

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export const dashboardConfig = {
  inviteLink: inviteLink && inviteLink.length > 0 ? inviteLink : undefined,
  refreshIntervalMs: Number(import.meta.env.VITE_DASHBOARD_REFRESH_MS ?? "0"),
  mockDelayMs: Number.isFinite(parsedMockDelay)
    ? parsedMockDelay
    : import.meta.env.DEV
    ? 300
    : 0,
  allowMockFallback: parseBooleanEnv(
    import.meta.env.VITE_DASHBOARD_ALLOW_MOCK_FALLBACK as string | undefined,
    Boolean(import.meta.env.DEV),
  ),
};
