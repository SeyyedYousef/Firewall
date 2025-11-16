const numberFormatter = new Intl.NumberFormat("en-US");
const durationPlural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"}`;

export function toPersianDigits(value: number | string | bigint | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

export function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value));
}

export function formatMembersCount(count: number): string {
  return `?? ${formatNumber(count)} members`;
}

export function formatDaysLeft(days: number): string {
  const safeDays = Math.max(days, 0);
  return `${numberFormatter.format(safeDays)} days remaining`;
}

export function formatDurationFromMs(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(durationPlural(days, "day"));
  }
  if (hours > 0 || parts.length > 0) {
    parts.push(durationPlural(hours, "hour"));
  }
  parts.push(durationPlural(minutes, "minute"));
  return parts.join(" ");
}

export function formatSignedPercent(direction: "up" | "down" | "flat", percent: number): string {
  if (!percent || direction === "flat") {
    return "0%";
  }
  const sign = direction === "down" ? "-" : "+";
  const formatted = Math.abs(percent).toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `${sign}${formatted}%`;
}
