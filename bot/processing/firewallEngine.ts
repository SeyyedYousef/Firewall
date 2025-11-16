import type { Message, MessageEntity } from "typegram";
import { logger } from "../../server/utils/logger.js";
import { listFirewallRules } from "../../server/db/firewallRepository.js";
import type { FirewallRuleConfig, RuleAction, RuleCondition, RuleEscalation } from "../../shared/firewall.js";
import type { GroupChatContext, ProcessingAction } from "./types.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const CACHE_TTL_MS = Number.parseInt(process.env.FIREWALL_CACHE_MS ?? "45000", 10);
const ROLE_CACHE_TTL_MS = 60_000;

type CachedRules = {
  expiresAt: number;
  rules: CachedRule[];
};

type CachedRule = {
  id: string;
  severity: number;
  config: FirewallRuleConfig;
};

type MemberRole = "owner" | "admin" | "restricted" | "member";

type FirewallEvaluationEvent = {
  kind: "text" | "media";
  text?: string;
  textLower?: string;
  messageLength: number;
  mediaTypes: string[];
  domains: string[];
  timestamp: number;
};

const rulesCache = new Map<string, CachedRules>();
const roleCache = new Map<string, { role: MemberRole; expiresAt: number }>();
const violationHistory = new Map<string, number[]>();
class AsyncMutex {
  private queue = Promise.resolve();

  async runExclusive<T>(callback: () => Promise<T> | T): Promise<T> {
    const previous = this.queue;
    let release: () => void;
    this.queue = previous.then(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await previous;
    try {
      return await callback();
    } finally {
      release!();
    }
  }
}

const rulesCacheMutex = new AsyncMutex();

export async function runFirewall(ctx: GroupChatContext): Promise<ProcessingAction[]> {
  if (!databaseAvailable || !ctx.chat || !ctx.message) {
    return [];
  }

  const event = extractEvent(ctx.message);
  if (!event) {
    return [];
  }

  try {
    return await evaluateRules(ctx, event);
  } catch (error) {
    logger.error("firewall evaluation failed", { chatId: ctx.chat.id, error });
    return [];
  }
}

async function evaluateRules(ctx: GroupChatContext, event: FirewallEvaluationEvent): Promise<ProcessingAction[]> {
  const chatId = ctx.chat.id.toString();
  const offenderId = ctx.message?.from?.id;
  const rules = await loadRules(chatId);
  if (!rules.length) {
    return [];
  }

  const memberRole = offenderId ? await resolveMemberRole(ctx, offenderId) : "member";

  for (const rule of rules) {
    if (!rule.config.enabled) {
      continue;
    }

    if (!ruleMatches(rule.config, event, memberRole)) {
      continue;
    }

    const { processing: baseActions, labels: baseLabels } = translateRuleActions(
      rule.config.actions,
      ctx,
      event,
      offenderId,
    );

    const escalationResult = applyEscalation(ctx, event, rule.id, offenderId, rule.config.escalation, event.timestamp);
    const actions: ProcessingAction[] = [...baseActions, ...escalationResult.processing];
    const labels = [...baseLabels, ...escalationResult.labels];

    if (!actions.length) {
      continue;
    }

    const summary = labels.length ? labels.join(", ") : "no-op";
    const offenderIdString = offenderId ? offenderId.toString() : undefined;

    actions.push({
      type: "record_moderation",
      ruleId: rule.id,
      userId: offenderId,
      actions: labels.length ? labels : ["rule_triggered"],
      reason: rule.config.description ?? undefined,
      metadata: {
        ruleName: rule.config.name,
        scope: rule.config.scope,
        severity: rule.severity,
        escalationApplied: escalationResult.labels.length > 0,
        eventKind: event.kind,
        mediaTypes: [...event.mediaTypes],
        messageLength: event.messageLength,
        containsLink: event.domains.length > 0,
        domains: event.domains.slice(0, 5),
      },
    });

    actions.push({
      type: "record_rule_audit",
      ruleId: rule.id,
      offenderId: offenderIdString,
      actionSummary: summary,
      payload: {
        ruleName: rule.config.name,
        text: event.text ?? null,
        mediaTypes: event.mediaTypes,
        domains: event.domains,
        matchedAt: new Date(event.timestamp).toISOString(),
      },
    });

    logger.info("firewall rule matched", {
      chatId,
      ruleId: rule.id,
      ruleName: rule.config.name,
      offenderId,
      actions: labels,
    });

    return actions;
  }

  return [];
}

async function loadRules(chatId: string): Promise<CachedRule[]> {
  const cached = rulesCache.get(chatId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.rules;
  }

  const records = await listFirewallRules(chatId);
  const activeRules = records
    .filter((record) => record.enabled)
    .map<CachedRule>((record) => ({
      id: record.id,
      severity: record.severity,
      config: record.config,
    }))
    .sort((a, b) => a.config.priority - b.config.priority || a.id.localeCompare(b.id));

  return rulesCacheMutex.runExclusive(async () => {
    const existing = rulesCache.get(chatId);
    const current = Date.now();
    if (existing && existing.expiresAt > current) {
      return existing.rules;
    }
    rulesCache.set(chatId, { rules: activeRules, expiresAt: current + CACHE_TTL_MS });
    return activeRules;
  });
}

function extractEvent(message: Message.CommonMessage): FirewallEvaluationEvent | null {
  const timestamp = Date.now();

  if ("text" in message && typeof message.text === "string") {
    const text = message.text;
    return {
      kind: "text",
      text,
      textLower: text.toLowerCase(),
      messageLength: text.length,
      mediaTypes: [],
  domains: extractDomains(text, "entities" in message ? (message.entities as unknown as MessageEntity[]) : undefined),
      timestamp,
    };
  }

    const mediaTypes = detectMediaTypes(message);
  if (mediaTypes.length > 0) {
    const caption = "caption" in message && typeof message.caption === "string" ? message.caption : undefined;
    return {
      kind: "media",
      text: caption,
      textLower: caption?.toLowerCase(),
      messageLength: caption?.length ?? 0,
      mediaTypes,
  domains: caption ? extractDomains(caption, "caption_entities" in message ? (message.caption_entities as unknown as MessageEntity[]) : undefined) : [],
      timestamp,
    };
  }

  return null;
}

function detectMediaTypes(message: Message.CommonMessage): string[] {
  const types: string[] = [];
  if ("photo" in message && Array.isArray(message.photo) && message.photo.length) types.push("photo");
  if ("video" in message && message.video) types.push("video");
  if ("document" in message && message.document) types.push("document");
  if ("audio" in message && message.audio) types.push("audio");
  if ("voice" in message && message.voice) types.push("voice");
  if ("animation" in message && message.animation) types.push("animation");
  if ("video_note" in message && message.video_note) types.push("video_note");
  if ("sticker" in message && message.sticker) types.push("sticker");
  return types;
}

async function resolveMemberRole(ctx: GroupChatContext, userId: number): Promise<MemberRole> {
  const cacheKey = `${ctx.chat.id}:${userId}`;
  const cached = roleCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.role;
  }

  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    const role = mapTelegramStatusToRole(member.status);
    roleCache.set(cacheKey, { role, expiresAt: now + ROLE_CACHE_TTL_MS });
    return role;
  } catch (error) {
    logger.warn("failed to resolve member role", { chatId: ctx.chat.id, userId, error });
    return "member";
  }
}

function mapTelegramStatusToRole(status: string): MemberRole {
  switch (status) {
    case "creator":
      return "owner";
    case "administrator":
      return "admin";
    case "restricted":
      return "restricted";
    default:
      return "member";
  }
}

function ruleMatches(config: FirewallRuleConfig, event: FirewallEvaluationEvent, memberRole: MemberRole): boolean {
  const conditions = config.conditions ?? [];
  if (!conditions.length) {
    return true;
  }

  const predicate = config.matchAll
    ? (condition: RuleCondition) => evaluateCondition(condition, event, memberRole)
    : (condition: RuleCondition) => {
        if (evaluateCondition(condition, event, memberRole)) {
          return true;
        }
        return false;
      };

  if (config.matchAll) {
    return conditions.every((condition) => evaluateCondition(condition, event, memberRole));
  }

  return conditions.some(predicate);
}

function evaluateCondition(condition: RuleCondition, event: FirewallEvaluationEvent, memberRole: MemberRole): boolean {
  switch (condition.kind) {
    case "text_contains": {
      if (!event.text || !event.textLower) return false;
      return condition.caseSensitive
        ? event.text.includes(condition.value)
        : event.textLower.includes(condition.value.toLowerCase());
    }
    case "regex": {
      if (!event.text) return false;
      try {
        const regex = new RegExp(condition.pattern, condition.flags ?? "i");
        return regex.test(event.text);
      } catch {
        return false;
      }
    }
    case "keyword": {
      if (!event.textLower) return false;
      if (condition.caseSensitive && !event.text) return false;
      const keywords = condition.keywords.map((keyword) =>
        condition.caseSensitive ? keyword : keyword.toLowerCase(),
      );
      const haystack = (condition.caseSensitive ? event.text : event.textLower) as string;
      if (condition.match === "all") {
        return keywords.every((keyword) => haystack.includes(keyword));
      }
      return keywords.some((keyword) => haystack.includes(keyword));
    }
    case "media_type":
      return condition.types.some((type) => event.mediaTypes.includes(type));
    case "link_domain":
      if (!event.domains.length) {
        return false;
      }
      return event.domains.some((domain) =>
        condition.allowSubdomains
          ? condition.domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))
          : condition.domains.includes(domain),
      );
    case "user_role":
      // condition.roles uses the firewall's role names; cast to any to avoid a strict type mismatch
      return condition.roles.includes(memberRole as unknown as any);
    case "time_range":
      return isWithinTimeRange(condition, event.timestamp);
    case "message_length": {
      const minOk = condition.min === undefined || event.messageLength >= condition.min;
      const maxOk = condition.max === undefined || event.messageLength <= condition.max;
      return minOk && maxOk;
    }
    default:
      return false;
  }
}

function isWithinTimeRange(condition: Extract<RuleCondition, { kind: "time_range" }>, timestamp: number): boolean {
  const tz = condition.timezone ?? "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz });
  const hour = Number.parseInt(formatter.format(new Date(timestamp)), 10);
  const start = ((condition.startHour % 24) + 24) % 24;
  const end = ((condition.endHour % 24) + 24) % 24;

  if (start === end) {
    return true;
  }
  if (start < end) {
    return hour >= start && hour < end;
  }
  return hour >= start || hour < end;
}

function translateRuleActions(
  actions: RuleAction[],
  ctx: GroupChatContext,
  event: FirewallEvaluationEvent,
  userId?: number,
): { processing: ProcessingAction[]; labels: string[] } {
  const result: ProcessingAction[] = [];
  const labels: string[] = [];
  const messageId = ctx.message?.message_id ?? 0;

  for (const action of actions) {
    switch (action.kind) {
      case "delete_message":
        if (messageId) {
          result.push({
            type: "delete_message",
            messageId,
            reason: `Rule ${ctx.chat.id} delete`,
          });
          labels.push("delete_message");
        }
        break;
      case "warn": {
        if (!userId) break;
        const reason = action.message ?? "Please adhere to the group rules.";
        result.push({
          type: "warn_member",
          userId,
          reason,
          severity: action.severity ?? "medium",
        });
        labels.push(`warn(${action.severity ?? "medium"})`);
        break;
      }
      case "mute": {
        if (!userId) break;
        result.push({
          type: "restrict_member",
          userId,
          durationSeconds: action.durationSeconds,
          reason: action.reason ?? "Temporarily muted by firewall rule.",
        });
        labels.push(`mute(${action.durationSeconds ?? 0}s)`);
        break;
      }
      case "kick": {
        if (!userId) break;
        result.push({
          type: "kick_member",
          userId,
          reason: action.reason ?? "Removed by firewall rule.",
        });
        labels.push("kick");
        break;
      }
      case "ban": {
        if (!userId) break;
        const untilDate =
          action.durationSeconds && action.durationSeconds > 0
            ? Math.floor(Date.now() / 1000) + action.durationSeconds
            : undefined;
        result.push({
          type: "ban_member",
          userId,
          untilDate,
          reason: action.reason ?? "Banned by firewall rule.",
        });
        labels.push(action.durationSeconds ? `ban(${action.durationSeconds}s)` : "ban");
        break;
      }
      case "log":
        result.push({
          type: "log",
          level: action.level ?? "info",
          message: action.message ?? "Rule triggered log action",
          details: {
            chatId: ctx.chat.id,
            text: event.text,
          },
        });
        labels.push(`log(${action.level ?? "info"})`);
        break;
    }
  }

  return { processing: result, labels };
}

function applyEscalation(
  ctx: GroupChatContext,
  event: FirewallEvaluationEvent,
  ruleId: string,
  userId: number | undefined,
  escalation: RuleEscalation | undefined,
  timestamp: number,
): { processing: ProcessingAction[]; labels: string[] } {
  if (!userId) {
    return { processing: [], labels: [] };
  }
  if (!escalation || !escalation.steps?.length) {
    registerViolation(ruleId, userId, timestamp);
    return { processing: [], labels: [] };
  }

  const history = registerViolation(ruleId, userId, timestamp);
  let selectedActions: RuleAction[] = [];

  for (const step of escalation.steps) {
    const windowMs = step.windowSeconds * 1000;
    const count = history.filter((entry) => entry >= timestamp - windowMs).length;
    if (count >= step.threshold) {
      selectedActions = step.actions;
    }
  }

  if (escalation.resetAfterSeconds && selectedActions.length > 0) {
    const cutoff = timestamp - escalation.resetAfterSeconds * 1000;
    violationHistory.set(historyKey(ruleId, userId), history.filter((entry) => entry >= cutoff));
  }

  if (!selectedActions.length) {
    return { processing: [], labels: [] };
  }

  const translation = translateRuleActions(selectedActions, ctx, event, userId);
  return {
    processing: translation.processing,
    labels: translation.labels.map((label) => `escalate:${label}`),
  };
}

function registerViolation(ruleId: string, userId: number, timestamp: number): number[] {
  const key = historyKey(ruleId, userId);
  const history = violationHistory.get(key) ?? [];
  history.push(timestamp);
  const trimmed = history.filter((entry) => entry >= timestamp - 24 * 60 * 60 * 1000);
  violationHistory.set(key, trimmed);
  return trimmed;
}

function historyKey(ruleId: string, userId: number | undefined): string {
  return `${ruleId}:${userId ?? "anon"}`;
}

function extractDomains(text: string, entities?: MessageEntity[]): string[] {
  const domains = new Set<string>();
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    try {
      const url = new URL(match[0]);
      domains.add(url.hostname.toLowerCase());
    } catch {
      // ignore invalid URL
    }
  }

  if (entities) {
    for (const entity of entities) {
      if (entity.type === "text_link" && "url" in entity) {
        try {
          const url = new URL(entity.url);
          domains.add(url.hostname.toLowerCase());
        } catch {
          // ignore
        }
      }
    }
  }

  return Array.from(domains);
}

// Exported for testing
export async function __resetFirewallCaches(): Promise<void> {
  await rulesCacheMutex.runExclusive(async () => {
    rulesCache.clear();
    roleCache.clear();
    violationHistory.clear();
  });
}

export async function invalidateCachedRules(chatId?: string | null): Promise<void> {
  await rulesCacheMutex.runExclusive(async () => {
    if (!chatId) {
      rulesCache.clear();
      roleCache.clear();
      violationHistory.clear();
      return;
    }
    rulesCache.delete(chatId);
    const prefix = `${chatId}:`;
    for (const key of Array.from(roleCache.keys())) {
      if (key.startsWith(prefix)) {
        roleCache.delete(key);
      }
    }
  });
}
