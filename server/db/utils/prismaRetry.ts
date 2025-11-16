import { Prisma } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";
import { logger } from "../../utils/logger.js";

const RETRYABLE_KNOWN_CODES = new Set([
  "P1010", // User was denied
  "P1012", // connection pool error
  "P1017", // server closed connection
  "P1001", // connection to database server failed
  "P1002", // database timeout
  "P1008", // operation timeout
  "P1009",
  "P1011",
  "P1013",
  "P2010", // raw query failure
  "P2024", // timed out waiting for a response
]);

const DEFAULT_ATTEMPTS = Number.parseInt(process.env.PRISMA_RETRY_ATTEMPTS ?? "4", 10) || 4;
const DEFAULT_BACKOFF_MS = Number.parseInt(process.env.PRISMA_RETRY_BACKOFF_MS ?? "150", 10) || 150;

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if (error instanceof Prisma.PrismaClientRustPanicError || error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (!error.code) {
      return false;
    }
    if (RETRYABLE_KNOWN_CODES.has(error.code)) {
      return true;
    }
    if (error.code === "P2025") {
      // Record not found – the caller should decide, not us.
      return false;
    }
    return false;
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return false;
  }
  if ("code" in error && typeof (error as { code: unknown }).code === "string") {
    const code = (error as { code: string }).code;
    if (code.startsWith("ETIMEDOUT") || code === "ECONNRESET" || code === "ECONNREFUSED") {
      return true;
    }
  }
  return false;
}

export async function withPrismaRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
  const maxAttempts = Math.max(1, DEFAULT_ATTEMPTS);
  const baseDelay = Math.max(25, DEFAULT_BACKOFF_MS);

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) {
        throw error;
      }

      const backoff = Math.round(baseDelay * 2 ** (attempt - 1) + Math.random() * baseDelay);
      logger.warn("prisma operation retry", {
        context,
        attempt,
        maxAttempts,
        backoff,
        error: error instanceof Error ? error.message : error,
      });
      await delay(backoff);
    }
  }
}
