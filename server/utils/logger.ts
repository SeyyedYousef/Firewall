import { inspect } from "node:util";

const LOG_NAMESPACE = "tgfw";

function formatDetails(details: unknown): string {
  if (details === undefined || details === null) {
    return "";
  }
  if (typeof details === "string") {
    return details;
  }
  return inspect(details, { depth: 3, colors: false, compact: true });
}

function log(level: "debug" | "info" | "warn" | "error", message: string, details?: unknown): void {
  const timestamp = new Date().toISOString();
  const parts = [`[${timestamp}]`, `${LOG_NAMESPACE}:${level}`, message];
  if (details !== undefined) {
    parts.push(formatDetails(details));
  }
  const output = parts.join(" ");
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug(message: string, details?: unknown) {
    log("debug", message, details);
  },
  info(message: string, details?: unknown) {
    log("info", message, details);
  },
  warn(message: string, details?: unknown) {
    log("warn", message, details);
  },
  error(message: string, details?: unknown) {
    log("error", message, details);
  },
};
