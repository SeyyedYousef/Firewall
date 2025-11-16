import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import express from "express";

import { logger } from "../utils/logger.js";

const PROMO_STORAGE_ROOT = path.resolve(
  process.env.PROMO_STORAGE_ROOT ?? path.join(process.cwd(), "data/promos"),
);
const PROMO_MEDIA_BASE_PATH = normalizeBasePath(process.env.PROMO_MEDIA_BASE_PATH ?? "/promo-media");
const PROMO_MEDIA_BASE_URL = process.env.PROMO_MEDIA_BASE_URL ?? PROMO_MEDIA_BASE_PATH;

let staticRoutesRegistered = false;

function normalizeBasePath(value: string): string {
  if (!value.startsWith("/")) {
    return `/${value}`;
  }
  if (value.length > 1 && value.endsWith("/")) {
    return value.slice(0, -1);
  }
  return value;
}

function sanitizeStorageKey(storageKey: string): string {
  return storageKey.replace(/\\/g, "/").replace(/^\//, "");
}

export async function ensurePromoStorageRoot(): Promise<void> {
  await mkdir(PROMO_STORAGE_ROOT, { recursive: true });
}

export function getPromoStorageRoot(): string {
  return PROMO_STORAGE_ROOT;
}

export function getPromoMediaBasePath(): string {
  return PROMO_MEDIA_BASE_PATH;
}

export function getPromoMediaBaseUrl(): string {
  return PROMO_MEDIA_BASE_URL;
}

export async function savePromoMediaObject(storageKey: string, buffer: Buffer): Promise<void> {
  const normalizedKey = sanitizeStorageKey(storageKey);
  const targetPath = path.resolve(PROMO_STORAGE_ROOT, normalizedKey);
  await ensurePromoStorageRoot();
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buffer);
  logger.debug("promo media saved", { storageKey: normalizedKey, bytes: buffer.byteLength });
}

export async function removePromoMediaObject(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey) {
    return;
  }
  const normalizedKey = sanitizeStorageKey(storageKey);
  const targetPath = path.resolve(PROMO_STORAGE_ROOT, normalizedKey);
  await rm(targetPath, { force: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  });
  logger.debug("promo media removed", { storageKey: normalizedKey });
}

export function buildPromoMediaPublicUrl(storageKey: string): string {
  const normalizedKey = sanitizeStorageKey(storageKey);
  if (PROMO_MEDIA_BASE_URL.startsWith("http")) {
    const base =
      PROMO_MEDIA_BASE_URL.endsWith("/") || PROMO_MEDIA_BASE_URL.endsWith("=")
        ? PROMO_MEDIA_BASE_URL
        : `${PROMO_MEDIA_BASE_URL}/`;
    return new URL(normalizedKey, base).toString();
  }
  return `${normalizeBasePath(PROMO_MEDIA_BASE_URL)}/${normalizedKey}`;
}

export async function registerPromoStaticRoutes(app: express.Express): Promise<void> {
  if (staticRoutesRegistered) {
    return;
  }
  await ensurePromoStorageRoot();
  app.use(
    PROMO_MEDIA_BASE_PATH,
    express.static(PROMO_STORAGE_ROOT, {
      maxAge: "7d",
      immutable: true,
      setHeaders(res) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      },
    }),
  );
  staticRoutesRegistered = true;
  logger.info("promo media static route registered", {
    basePath: PROMO_MEDIA_BASE_PATH,
    storageRoot: PROMO_STORAGE_ROOT,
  });
}
