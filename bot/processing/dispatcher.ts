import PQueue from "p-queue";
import { setTimeout as delay } from "node:timers/promises";
import type { Telegraf } from "telegraf";
import { getState } from "../state.js";
import { handlers } from "./handlers/index.js";
import { ensureActions, executeAction, isGroupChat } from "./utils.js";
import type { GroupChatContext } from "./types.js";
import { resolveProcessingConfig } from "./config.js";
import { logger } from "../../server/utils/logger.js";
import { primeBanSettings } from "./banGuards.js";

class AdaptiveThrottle {
  private currentDelay: number;
  private nextAvailable = Date.now();
  private lastPenaltyAt = 0;

  constructor(
    private readonly baseDelay: number,
    private readonly maxDelay: number,
    private readonly decayMs: number,
  ) {
    this.currentDelay = Math.max(0, baseDelay);
  }

  async schedule(task: () => Promise<void>, ctx: GroupChatContext): Promise<void> {
    const now = Date.now();
    if (now < this.nextAvailable) {
      await delay(this.nextAvailable - now);
    }

    try {
      await task();
    } finally {
      this.adjust(ctx);
    }
  }

  private adjust(ctx: GroupChatContext): void {
    const now = Date.now();
    const state = ctx.processing;

    if (state?.rateLimitedAt && (!state.rateLimitNotified || state.rateLimitNotified < state.rateLimitedAt)) {
      const retryMs = Math.max(
        (state.retryAfterSeconds ?? 0) * 1000,
        this.currentDelay * 2,
        this.baseDelay * 2,
      );
      this.currentDelay = Math.min(this.maxDelay, Math.max(this.baseDelay, retryMs));
      this.lastPenaltyAt = now;
      this.nextAvailable = now + this.currentDelay;
      state.rateLimitNotified = now;
      state.rateLimitedAt = undefined;
      state.retryAfterSeconds = undefined;
      logger.warn("adaptive throttle applied after Telegram rate limit", { delayMs: this.currentDelay });
      return;
    }

    if (this.currentDelay > this.baseDelay && now - this.lastPenaltyAt > this.decayMs) {
      const previous = this.currentDelay;
      this.currentDelay = Math.max(this.baseDelay, Math.round(this.currentDelay * 0.8));
      this.nextAvailable = Math.max(this.nextAvailable, now + this.currentDelay);
      this.lastPenaltyAt = now;
      if (previous !== this.currentDelay) {
        logger.debug("adaptive throttle relaxed", { delayMs: this.currentDelay });
      }
      return;
    }

    this.nextAvailable = Math.max(this.nextAvailable, now + this.currentDelay);
  }
}

export function installProcessingPipeline(bot: Telegraf): void {
  const config = resolveProcessingConfig();
  const queue = new PQueue({
    concurrency: config.concurrency,
    intervalCap: config.intervalCap,
    interval: config.interval,
    carryoverConcurrencyCount: true,
  });
  const adaptiveThrottle = new AdaptiveThrottle(config.baseDelayMs, config.maxDelayMs, config.rateLimitDecayMs);

  queue.on("error", (error) => {
    logger.error("processing queue error", { error });
  });

  bot.use(async (ctx, next) => {
    if (!isGroupChat(ctx)) {
      return next();
    }

    const groupContext = ctx as GroupChatContext;

    if (config.warningThreshold > 0 && queue.size >= config.warningThreshold) {
      logger.warn("processing queue backlog", {
        size: queue.size,
        pending: queue.pending,
      });
    }

    await queue.add(() =>
      adaptiveThrottle.schedule(async () => {
        await dispatchUpdate(groupContext);
      }, groupContext),
    );

    return next();
  });
}

async function dispatchUpdate(ctx: GroupChatContext): Promise<void> {
  const processingState = (ctx.processing ??= {});
  processingState.rateLimitedAt = undefined;
  processingState.retryAfterSeconds = undefined;
  processingState.rateLimitNotified = undefined;

  await primeBanSettings(ctx);

  const chatId = ctx.chat.id.toString();
  const groupState = getState().groups[chatId];
  if (groupState && groupState.managed === false) {
    logger.debug("skipping processing for unmanaged group", { chatId });
    return;
  }

  for (const handler of handlers) {
    try {
      if (!handler.matches(ctx)) {
        continue;
      }

      const result = await handler.handle(ctx);
      const actions = ensureActions(result?.actions);
      for (const action of actions) {
        await executeAction(ctx, action);
      }
    } catch (error) {
      logger.error("processing handler failed", {
        handler: handler.name,
        chatId: ctx.chat.id,
        error,
      });
    }
  }
}
