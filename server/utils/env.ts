import { logger } from "./logger.js";

export function requireEnv(keys: readonly string[], context: string): void {
  const missing = keys.filter((key) => !process.env[key] || process.env[key]?.trim().length === 0);
  if (missing.length > 0) {
    const message = `Missing required environment variable(s) for ${context}: ${missing.join(", ")}`;
    logger.error(message);
    throw new Error(message);
  }
}

export function optionalWarnEnv(keys: readonly string[], context: string): void {
  const missing = keys.filter((key) => !process.env[key] || process.env[key]?.trim().length === 0);
  if (missing.length > 0) {
    logger.warn(`Optional environment variable(s) not set for ${context}: ${missing.join(", ")}`);
  }
}

export function resolveBooleanEnv(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
