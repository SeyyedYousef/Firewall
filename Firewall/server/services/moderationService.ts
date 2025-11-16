import { logger } from "../utils/logger.js";

const MODERATION_ENDPOINT = process.env.PROMO_IMAGE_MODERATION_ENDPOINT?.trim();
const MODERATION_REQUIRED = (process.env.PROMO_IMAGE_MODERATION_REQUIRED ?? "true").toLowerCase() !== "false";

type ModerationResponse = {
  safe?: boolean;
  block?: boolean;
  reason?: string;
  labels?: string[];
};

export async function ensureImageIsSafe(buffer: Buffer, metadata?: Record<string, unknown>): Promise<void> {
  if (!MODERATION_ENDPOINT) {
    logger.debug("promo moderation skipped", { reason: "no endpoint configured" });
    return;
  }

  try {
    const response = await fetch(MODERATION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: buffer.toString("base64"),
        metadata,
      }),
    });

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(`Moderation endpoint responded with ${response.status}: ${message}`);
    }

    const payload = (await response.json().catch(() => ({}))) as ModerationResponse;
    const blocked = payload.safe === false || payload.block === true;
    if (blocked) {
      const details = payload.reason ?? "Image rejected by moderation provider";
      throw new Error(details);
    }
  } catch (error) {
    logger.warn("promo image moderation error", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (MODERATION_REQUIRED) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
