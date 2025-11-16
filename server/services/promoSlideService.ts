import crypto from "node:crypto";

import { Prisma } from "@prisma/client";
import sharp from "sharp";

import { prisma } from "../db/client.js";
import { logger } from "../utils/logger.js";
import { downloadTelegramFile, getTelegramFile } from "../utils/telegramBotApi.js";
import { ensureImageIsSafe } from "./moderationService.js";
import {
  buildPromoMediaPublicUrl,
  removePromoMediaObject,
  savePromoMediaObject,
} from "./promoMediaStorage.js";
import type { PromoSlideRecord } from "../../shared/promo.js";

const PROMO_SLIDE_WIDTH = Number(process.env.PROMO_SLIDE_WIDTH ?? 960);
const PROMO_SLIDE_HEIGHT = Number(process.env.PROMO_SLIDE_HEIGHT ?? 360);
const PROMO_SLIDE_THUMB_WIDTH = Number(
  process.env.PROMO_SLIDE_THUMB_WIDTH ?? Math.round(PROMO_SLIDE_WIDTH / 3),
);
const PROMO_SLIDE_THUMB_HEIGHT = Number(
  process.env.PROMO_SLIDE_THUMB_HEIGHT ?? Math.round(PROMO_SLIDE_HEIGHT / 3),
);
const PROMO_SLIDE_IMAGE_QUALITY = Number(process.env.PROMO_SLIDE_IMAGE_QUALITY ?? 82);
const PROMO_SLIDE_THUMB_QUALITY = Number(process.env.PROMO_SLIDE_THUMB_QUALITY ?? 68);
const PROMO_SLIDE_MAX_BYTES = Number(process.env.PROMO_SLIDE_MAX_BYTES ?? 8 * 1024 * 1024);
const PROMO_ANALYTICS_LOOKBACK_DAYS = Number(process.env.PROMO_ANALYTICS_LOOKBACK_DAYS ?? 30);
const PROMO_LINK_SSL_REQUIRED = (process.env.PROMO_SLIDE_REQUIRE_SSL ?? "true").toLowerCase() !== "false";

const PROMO_LINK_WHITELIST = (process.env.PROMO_SLIDE_LINK_WHITELIST ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const RESERVED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

const EMPTY_ANALYTICS = Object.freeze({
  impressions: 0,
  clicks: 0,
  ctr: 0,
  avgTimeSpent: 0,
  bounceRate: 0,
});

type PromoSlideEntity = Prisma.PromoSlideGetPayload<{
  include: {
    analyticsBuckets: true;
  };
}>;

type PromoSlideAnalyticsEntity = Prisma.PromoSlideAnalyticsGetPayload<{
  select: {
    bucket: true;
    impressions: true;
    clicks: true;
    totalViewDurationMs: true;
    bounces: true;
    segment: true;
  };
}>;

type ProcessedPromoMedia = {
  storageKey: string;
  thumbnailStorageKey: string;
  imageUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  fileSize: number;
  contentType: string;
  checksum: string;
  originalFileSize?: number;
  fileUniqueId: string;
};

type CreatePromoSlideOptions = {
  id: string;
  linkUrl: string;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  accentColor?: string | null;
  ctaLabel?: string | null;
  ctaLink?: string | null;
  abTestGroupId?: string | null;
  variant?: string | null;
  active?: boolean;
  position?: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
  fileId?: string | null;
  imageData?: string | null;
  imageFileName?: string | null;
};

type UpdatePromoSlidePatch = {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  accentColor?: string | null;
  ctaLabel?: string | null;
  ctaLink?: string | null;
  linkUrl?: string | null;
  active?: boolean;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  position?: number;
  abTestGroupId?: string | null;
  variant?: string | null;
  metadata?: Record<string, unknown>;
};

type PromoSlideEventPayload = {
  durationMs?: number;
  bounced?: boolean;
  variant?: string | null;
};

function toDateOrNull(input: Date | string | null | undefined): Date | null {
  if (!input) {
    return null;
  }
  if (input instanceof Date) {
    return input;
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isHostnameAllowed(hostname: string): boolean {
  if (RESERVED_HOSTS.has(hostname)) {
    return false;
  }
  if (!PROMO_LINK_WHITELIST.length) {
    return true;
  }
  return PROMO_LINK_WHITELIST.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function validatePromoLink(link: string): string {
  const trimmed = link.trim();
  if (!trimmed) {
    throw new Error("Promo slide link cannot be empty");
  }
  const normalized = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Promo slide link is not a valid URL");
  }
  if (PROMO_LINK_SSL_REQUIRED && url.protocol !== "https:") {
    throw new Error("Only HTTPS links are allowed for promo slides");
  }
  if (!isHostnameAllowed(url.hostname.toLowerCase())) {
    throw new Error(`Links to "${url.hostname}" are not permitted`);
  }
  return url.toString();
}

function buildStorageKey(slideId: string, suffix: string): string {
  const slug = `${slideId}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `slides/${slug || "slide"}-${crypto.randomUUID()}${suffix}`;
}

async function processTelegramImage(input: { slideId: string; fileId: string }): Promise<ProcessedPromoMedia> {
  const fileInfo = await getTelegramFile(input.fileId);
  if (!fileInfo.filePath) {
    throw new Error("Unable to resolve Telegram file path");
  }
  const rawBuffer = Buffer.from(await downloadTelegramFile(fileInfo.filePath));
  if (rawBuffer.byteLength > PROMO_SLIDE_MAX_BYTES) {
    throw new Error(
      `Promo slide image exceeds maximum allowed size of ${(PROMO_SLIDE_MAX_BYTES / (1024 * 1024)).toFixed(2)} MB`,
    );
  }

  await ensureImageIsSafe(rawBuffer, {
    slideId: input.slideId,
    fileId: input.fileId,
    fileSize: rawBuffer.byteLength,
  });

  const baseImage = sharp(rawBuffer, { failOn: "none" }).rotate();

  const processedBuffer = await baseImage
    .resize(PROMO_SLIDE_WIDTH, PROMO_SLIDE_HEIGHT, {
      fit: "cover",
      position: sharp.strategy.attention,
      withoutEnlargement: false,
    })
    .webp({
      quality: PROMO_SLIDE_IMAGE_QUALITY,
      effort: 4,
    })
    .toBuffer();

  const processedMeta = await sharp(processedBuffer).metadata();

  const thumbnailBuffer = await sharp(processedBuffer)
    .resize(PROMO_SLIDE_THUMB_WIDTH, PROMO_SLIDE_THUMB_HEIGHT, {
      fit: "cover",
      position: sharp.strategy.attention,
      withoutEnlargement: false,
    })
    .webp({
      quality: PROMO_SLIDE_THUMB_QUALITY,
      effort: 3,
    })
    .toBuffer();

  const checksum = crypto.createHash("sha256").update(processedBuffer).digest("hex");

  const storageKey = buildStorageKey(input.slideId, ".webp");
  const thumbnailStorageKey = buildStorageKey(input.slideId, "-thumb.webp");

  await savePromoMediaObject(storageKey, processedBuffer);
  await savePromoMediaObject(thumbnailStorageKey, thumbnailBuffer);

  return {
    storageKey,
    thumbnailStorageKey,
    imageUrl: buildPromoMediaPublicUrl(storageKey),
    thumbnailUrl: buildPromoMediaPublicUrl(thumbnailStorageKey),
    width: processedMeta.width ?? PROMO_SLIDE_WIDTH,
    height: processedMeta.height ?? PROMO_SLIDE_HEIGHT,
    fileSize: processedBuffer.byteLength,
    contentType: "image/webp",
    checksum,
    originalFileSize: fileInfo.fileSize,
    fileUniqueId: fileInfo.fileUniqueId,
  };
}

function decodeImageDataUri(dataUri: string): { buffer: Buffer; contentType: string } {
  const trimmed = dataUri.trim();
  const match = /^data:(?<type>[^;]+);base64,(?<payload>[A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (match?.groups?.payload) {
    return {
      buffer: Buffer.from(match.groups.payload.replace(/\s+/g, ""), "base64"),
      contentType: match.groups.type ?? "application/octet-stream",
    };
  }
  const sanitized = trimmed.replace(/\s+/g, "");
  return {
    buffer: Buffer.from(sanitized, "base64"),
    contentType: "application/octet-stream",
  };
}

async function processUploadedImage(input: {
  slideId: string;
  imageData: string;
}): Promise<ProcessedPromoMedia> {
  const { buffer: rawBuffer, contentType } = decodeImageDataUri(input.imageData);
  if (rawBuffer.byteLength > PROMO_SLIDE_MAX_BYTES) {
    throw new Error(
      `Promo slide image exceeds maximum allowed size of ${(PROMO_SLIDE_MAX_BYTES / (1024 * 1024)).toFixed(2)} MB`,
    );
  }

  await ensureImageIsSafe(rawBuffer, {
    slideId: input.slideId,
    contentType,
    fileSize: rawBuffer.byteLength,
  });

  const baseImage = sharp(rawBuffer, { failOn: "none" }).rotate();

  const processedBuffer = await baseImage
    .resize(PROMO_SLIDE_WIDTH, PROMO_SLIDE_HEIGHT, {
      fit: "cover",
      position: sharp.strategy.attention,
      withoutEnlargement: false,
    })
    .webp({
      quality: PROMO_SLIDE_IMAGE_QUALITY,
      effort: 4,
    })
    .toBuffer();

  const processedMeta = await sharp(processedBuffer).metadata();

  const thumbnailBuffer = await sharp(processedBuffer)
    .resize(PROMO_SLIDE_THUMB_WIDTH, PROMO_SLIDE_THUMB_HEIGHT, {
      fit: "cover",
      position: sharp.strategy.attention,
      withoutEnlargement: false,
    })
    .webp({
      quality: PROMO_SLIDE_THUMB_QUALITY,
      effort: 3,
    })
    .toBuffer();

  const checksum = crypto.createHash("sha256").update(processedBuffer).digest("hex");

  const storageKey = buildStorageKey(input.slideId, ".webp");
  const thumbnailStorageKey = buildStorageKey(input.slideId, "-thumb.webp");

  await savePromoMediaObject(storageKey, processedBuffer);
  await savePromoMediaObject(thumbnailStorageKey, thumbnailBuffer);

  return {
    storageKey,
    thumbnailStorageKey,
    imageUrl: buildPromoMediaPublicUrl(storageKey),
    thumbnailUrl: buildPromoMediaPublicUrl(thumbnailStorageKey),
    width: processedMeta.width ?? PROMO_SLIDE_WIDTH,
    height: processedMeta.height ?? PROMO_SLIDE_HEIGHT,
    fileSize: processedBuffer.byteLength,
    contentType: "image/webp",
    checksum,
    originalFileSize: rawBuffer.byteLength,
    fileUniqueId: checksum,
  };
}

function mapEntityToRecord(entity: PromoSlideEntity): PromoSlideRecord {
  const analyticsTotals = entity.analyticsBuckets.reduce(
    (acc, bucket) => {
      acc.impressions += bucket.impressions ?? 0;
      acc.clicks += bucket.clicks ?? 0;
      acc.totalViewDurationMs += Number(bucket.totalViewDurationMs ?? BigInt(0));
      acc.bounces += bucket.bounces ?? 0;
      return acc;
    },
    {
      impressions: 0,
      clicks: 0,
      totalViewDurationMs: 0,
      bounces: 0,
    },
  );

  const ctr = analyticsTotals.impressions > 0 ? analyticsTotals.clicks / analyticsTotals.impressions : 0;
  const avgTime =
    analyticsTotals.impressions > 0 ? analyticsTotals.totalViewDurationMs / analyticsTotals.impressions : 0;
  const bounceRate =
    analyticsTotals.impressions > 0 ? analyticsTotals.bounces / analyticsTotals.impressions : 0;

  return {
    id: entity.id,
    title: entity.title ?? null,
    subtitle: entity.subtitle ?? null,
    description: entity.description ?? null,
    imageUrl: entity.imageUrl,
    thumbnailUrl: entity.thumbnailUrl ?? null,
    thumbnailStorageKey: entity.thumbnailStorageKey ?? null,
    storageKey: entity.storageKey ?? null,
    originalFileId: entity.originalFileId ?? null,
    contentType: entity.contentType ?? null,
    fileSize: entity.fileSize ?? null,
    width: entity.width ?? null,
    height: entity.height ?? null,
    checksum: entity.checksum ?? null,
    accentColor: entity.accentColor ?? null,
    linkUrl: entity.linkUrl ?? null,
    ctaLabel: entity.ctaLabel ?? null,
    ctaLink: entity.ctaLink ?? null,
    position: entity.position ?? 0,
    active: entity.active,
    startsAt: entity.startsAt ? entity.startsAt.toISOString() : null,
    endsAt: entity.endsAt ? entity.endsAt.toISOString() : null,
    abTestGroupId: entity.abTestGroupId ?? null,
    variant: entity.variant ?? null,
    analytics: {
      impressions: analyticsTotals.impressions,
      clicks: analyticsTotals.clicks,
      ctr: Number(ctr.toFixed(4)),
      avgTimeSpent: Number((avgTime / 1000).toFixed(2)),
      bounceRate: Number(bounceRate.toFixed(4)),
    },
    views: entity.views ?? undefined,
    clicks: entity.clicks ?? undefined,
    totalViewDurationMs: Number(entity.totalViewDurationMs ?? BigInt(0)),
    bounces: entity.bounces ?? undefined,
    createdBy: entity.createdBy ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    metadata: (entity.metadata as Record<string, unknown>) ?? {},
  };
}

async function loadPromoSlideEntity(id: string): Promise<PromoSlideEntity | null> {
  const cutoff = new Date(Date.now() - PROMO_ANALYTICS_LOOKBACK_DAYS * 86_400_000);
  return prisma.promoSlide.findUnique({
    where: { id },
    include: {
      analyticsBuckets: {
        where: {
          bucket: {
            gte: cutoff,
          },
        },
      },
    },
  });
}

export async function listPromoSlides(): Promise<PromoSlideRecord[]> {
  const cutoff = new Date(Date.now() - PROMO_ANALYTICS_LOOKBACK_DAYS * 86_400_000);
  const slides = await prisma.promoSlide.findMany({
    include: {
      analyticsBuckets: {
        where: {
          bucket: {
            gte: cutoff,
          },
        },
      },
    },
    orderBy: [
      { position: "asc" },
      { createdAt: "asc" },
    ],
  });
  return slides.map(mapEntityToRecord);
}

export async function createPromoSlide(options: CreatePromoSlideOptions): Promise<PromoSlideRecord> {
  const startsAt = toDateOrNull(options.startsAt);
  const endsAt = toDateOrNull(options.endsAt);
  const linkUrl = validatePromoLink(options.linkUrl);
  const trimmedFileId =
    typeof options.fileId === "string" && options.fileId.trim().length > 0 ? options.fileId.trim() : "";
  const imageData =
    typeof options.imageData === "string" && options.imageData.trim().length > 0 ? options.imageData.trim() : "";

  const sourceCount = (trimmedFileId ? 1 : 0) + (imageData ? 1 : 0);
  if (sourceCount !== 1) {
    throw new Error("Provide either a Telegram file_id or an uploaded image payload.");
  }

  const processedMedia = trimmedFileId
    ? await processTelegramImage({ slideId: options.id, fileId: trimmedFileId })
    : await processUploadedImage({ slideId: options.id, imageData });
  const mediaSource = trimmedFileId ? "telegram" : "upload";

  const existing = await prisma.promoSlide.findUnique({
    where: { id: options.id },
    select: {
      position: true,
      storageKey: true,
      thumbnailStorageKey: true,
    },
  });

  const maxPosition = await prisma.promoSlide.aggregate({
    _max: {
      position: true,
    },
  });
  const nextPosition = (maxPosition._max.position ?? -1) + 1;
  const desiredPosition =
    typeof options.position === "number" && Number.isFinite(options.position)
      ? options.position
      : existing?.position ?? nextPosition;

  const metadata = {
    ...(options.metadata ?? {}),
    fileUniqueId: processedMedia.fileUniqueId,
    originalFileSize: processedMedia.originalFileSize ?? null,
    source: mediaSource,
    ...(options.imageFileName ? { originalFileName: options.imageFileName } : {}),
  };

  await prisma.promoSlide.upsert({
    where: { id: options.id },
    create: {
      id: options.id,
      title: options.title,
      subtitle: options.subtitle,
      description: options.description,
      imageUrl: processedMedia.imageUrl,
      thumbnailUrl: processedMedia.thumbnailUrl,
      thumbnailStorageKey: processedMedia.thumbnailStorageKey,
      storageKey: processedMedia.storageKey,
      originalFileId: trimmedFileId || null,
      contentType: processedMedia.contentType,
      fileSize: processedMedia.fileSize,
      width: processedMedia.width,
      height: processedMedia.height,
      checksum: processedMedia.checksum,
      linkUrl,
      position: desiredPosition,
      accentColor: options.accentColor ?? "#0f172a",
      ctaLabel: options.ctaLabel ?? null,
      ctaLink: options.ctaLink ?? null,
      active: options.active ?? true,
      startsAt,
      endsAt,
      abTestGroupId: options.abTestGroupId ?? null,
      variant: options.variant ?? null,
      createdBy: options.createdBy ?? null,
  metadata: metadata as unknown as Prisma.InputJsonValue,
    },
    update: {
      title: options.title,
      subtitle: options.subtitle,
      description: options.description,
      imageUrl: processedMedia.imageUrl,
      thumbnailUrl: processedMedia.thumbnailUrl,
      thumbnailStorageKey: processedMedia.thumbnailStorageKey,
      storageKey: processedMedia.storageKey,
      originalFileId: trimmedFileId || null,
      contentType: processedMedia.contentType,
      fileSize: processedMedia.fileSize,
      width: processedMedia.width,
      height: processedMedia.height,
      checksum: processedMedia.checksum,
      linkUrl,
      position: desiredPosition,
      accentColor: options.accentColor ?? "#0f172a",
      ctaLabel: options.ctaLabel ?? null,
      ctaLink: options.ctaLink ?? null,
      active: options.active ?? true,
      startsAt,
      endsAt,
      abTestGroupId: options.abTestGroupId ?? null,
      variant: options.variant ?? null,
  metadata: metadata as unknown as Prisma.InputJsonValue,
    },
  });

  if (existing?.storageKey && existing.storageKey !== processedMedia.storageKey) {
    await removePromoMediaObject(existing.storageKey).catch((error) => {
      logger.warn("failed to cleanup previous promo media", { error });
    });
  }
  if (existing?.thumbnailStorageKey && existing.thumbnailStorageKey !== processedMedia.thumbnailStorageKey) {
    await removePromoMediaObject(existing.thumbnailStorageKey).catch((error) => {
      logger.warn("failed to cleanup previous promo thumbnail", { error });
    });
  }

  const entity = await loadPromoSlideEntity(options.id);
  if (!entity) {
    throw new Error("Failed to load promo slide after creation");
  }
  return mapEntityToRecord(entity);
}

export async function updatePromoSlide(id: string, patch: UpdatePromoSlidePatch): Promise<PromoSlideRecord> {
  const startsAt = patch.startsAt === undefined ? undefined : toDateOrNull(patch.startsAt);
  const endsAt = patch.endsAt === undefined ? undefined : toDateOrNull(patch.endsAt);
  const linkUrl = patch.linkUrl !== undefined && patch.linkUrl !== null ? validatePromoLink(patch.linkUrl) : patch.linkUrl;

  await prisma.promoSlide.update({
    where: { id },
    data: {
      title: patch.title ?? undefined,
      subtitle: patch.subtitle ?? undefined,
      description: patch.description ?? undefined,
      accentColor: patch.accentColor ?? undefined,
      ctaLabel: patch.ctaLabel ?? undefined,
      ctaLink: patch.ctaLink ?? undefined,
      linkUrl: linkUrl ?? undefined,
      active: patch.active ?? undefined,
      startsAt: startsAt === undefined ? undefined : startsAt,
      endsAt: endsAt === undefined ? undefined : endsAt,
      position: patch.position ?? undefined,
      abTestGroupId: patch.abTestGroupId ?? undefined,
      variant: patch.variant ?? undefined,
  metadata: patch.metadata ? (patch.metadata as unknown as Prisma.InputJsonValue) : undefined,
    },
  });

  const entity = await loadPromoSlideEntity(id);
  if (!entity) {
    throw new Error("Promo slide not found");
  }
  return mapEntityToRecord(entity);
}

export async function reorderPromoSlides(order: string[]): Promise<PromoSlideRecord[]> {
  const existingSlides = await prisma.promoSlide.findMany({
    select: {
      id: true,
    },
    orderBy: [
      { position: "asc" },
      { createdAt: "asc" },
    ],
  });

  const knownIds = new Set(existingSlides.map((slide) => slide.id));
  const normalizedOrder = order.filter((id) => knownIds.has(id));

  let nextPosition = 0;
  const positionMap = new Map<string, number>();
  for (const id of normalizedOrder) {
    positionMap.set(id, nextPosition++);
  }
  for (const slide of existingSlides) {
    if (!positionMap.has(slide.id)) {
      positionMap.set(slide.id, nextPosition++);
    }
  }

  await prisma.$transaction(
    Array.from(positionMap.entries()).map(([id, position]) =>
      prisma.promoSlide.update({
        where: { id },
        data: { position },
      }),
    ),
  );

  return listPromoSlides();
}

export async function deletePromoSlide(id: string): Promise<void> {
  const slide = await prisma.promoSlide.findUnique({
    where: { id },
    select: {
      storageKey: true,
      thumbnailStorageKey: true,
    },
  });
  if (!slide) {
    return;
  }
  await prisma.promoSlide.delete({
    where: { id },
  });
  await removePromoMediaObject(slide.storageKey).catch((error) => {
    logger.warn("promo media removal failed", { id, error });
  });
  await removePromoMediaObject(slide.thumbnailStorageKey).catch((error) => {
    logger.warn("promo thumbnail removal failed", { id, error });
  });
}

function computeAnalyticsIncrement(event: "view" | "click", payload: PromoSlideEventPayload) {
  return {
    impressions: event === "view" ? 1 : 0,
    clicks: event === "click" ? 1 : 0,
    durationMs: Math.max(0, Math.trunc(payload.durationMs ?? 0)),
    bounces: payload.bounced ? 1 : 0,
  };
}

export async function recordPromoSlideEvent(
  id: string,
  event: "view" | "click",
  payload: PromoSlideEventPayload = {},
): Promise<PromoSlideRecord | null> {
  const existingSlide = await prisma.promoSlide.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existingSlide) {
    logger.warn("promo slide event ignored because slide not found", { id, event });
    return null;
  }

  const increments = computeAnalyticsIncrement(event, payload);
  const now = new Date();
  const bucket = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0));

  try {
    await prisma.$transaction(async (tx) => {
      await tx.promoSlide.update({
        where: { id },
        data: {
          ...(increments.impressions
            ? {
                views: {
                  increment: increments.impressions,
                },
              }
            : {}),
          ...(increments.clicks
            ? {
                clicks: {
                  increment: increments.clicks,
                },
              }
            : {}),
          ...(increments.durationMs
            ? {
                totalViewDurationMs: {
                  increment: BigInt(increments.durationMs),
                },
              }
            : {}),
          ...(increments.bounces
            ? {
                bounces: {
                  increment: increments.bounces,
                },
              }
            : {}),
        },
      });

      await tx.promoSlideAnalytics.upsert({
        where: {
          slideId_bucket_segment: {
            slideId: id,
            bucket,
            segment: (payload.variant ?? null) as any,
          },
        },
      create: {
        slideId: id,
        bucket,
        segment: payload.variant ?? null,
        impressions: increments.impressions,
        clicks: increments.clicks,
        totalViewDurationMs: BigInt(increments.durationMs),
        bounces: increments.bounces,
      },
      update: {
        impressions: { increment: increments.impressions },
        clicks: { increment: increments.clicks },
        totalViewDurationMs: { increment: BigInt(increments.durationMs) },
        bounces: { increment: increments.bounces },
      },
    });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      logger.warn("promo slide event ignored because slide was removed during update", { id, event });
      return null;
    }
    throw error;
  }

  const entity = await loadPromoSlideEntity(id);
  return entity ? mapEntityToRecord(entity) : null;
}

function isSlideActive(slide: PromoSlideRecord, reference: Date = new Date()): boolean {
  if (!slide.active) {
    return false;
  }
  if (slide.startsAt && new Date(slide.startsAt).getTime() > reference.getTime()) {
    return false;
  }
  if (slide.endsAt && new Date(slide.endsAt).getTime() <= reference.getTime()) {
    return false;
  }
  return true;
}

export async function listActivePromoSlides(reference: Date = new Date()): Promise<PromoSlideRecord[]> {
  const slides = await listPromoSlides();
  return slides.filter((slide) => isSlideActive(slide, reference));
}

function pickVariantFromGroup(
  variants: PromoSlideRecord[],
  groupId: string,
  userId: string | number | null | undefined,
): PromoSlideRecord | null {
  if (variants.length === 0) {
    return null;
  }
  if (variants.length === 1) {
    return variants[0];
  }
  const seed = `${groupId}:${userId ?? "anonymous"}`;
  const hash = crypto.createHash("sha256").update(seed).digest();
  const index = hash[0] % variants.length;
  return [...variants].sort((a, b) => {
    if (a.position !== b.position) {
      return a.position - b.position;
    }
    return a.id.localeCompare(b.id);
  })[index];
}

export function selectPromoSlideVariants(
  slides: PromoSlideRecord[],
  userId: string | number | null | undefined,
): PromoSlideRecord[] {
  const groups = new Map<string, PromoSlideRecord[]>();
  const singleSlides: PromoSlideRecord[] = [];

  for (const slide of slides) {
    if (!slide.abTestGroupId) {
      singleSlides.push(slide);
      continue;
    }
    const collection = groups.get(slide.abTestGroupId) ?? [];
    collection.push(slide);
    groups.set(slide.abTestGroupId, collection);
  }

  const selectedVariants = Array.from(groups.entries())
    .map(([groupId, variants]) => pickVariantFromGroup(variants, groupId, userId))
    .filter((slide): slide is PromoSlideRecord => Boolean(slide));

  const combined = [...singleSlides, ...selectedVariants];
  combined.sort((a, b) => {
    if (a.position !== b.position) {
      return a.position - b.position;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });

  return combined;
}
