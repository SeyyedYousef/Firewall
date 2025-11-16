import { Router } from "express";
import type { RuleAction, RuleCondition, RuleEscalation } from "../../../shared/firewall.js";
import type { FirewallRuleInput } from "../../db/firewallRepository.js";
import { requireTelegramInitData } from "../middleware/telegramInit.js";
import { requirePanelAdmin } from "../middleware/acl.js";
import {
  listFirewallRules,
  findFirewallRuleById,
  upsertFirewallRule,
  deleteFirewallRule,
} from "../../db/firewallRepository.js";
import { invalidateFirewallCache } from "../../../bot/firewall.js";

export function createFirewallRouter(): Router {
  const router = Router();

  router.use(requireTelegramInitData());
  router.use(requirePanelAdmin());

  router.get("/", async (req, res) => {
    const chatId = typeof req.query.chatId === "string" ? req.query.chatId : undefined;
    const records = await listFirewallRules(chatId);

    res.json({
      chatId: chatId ?? null,
      rules: records.map((record) => ({
        id: record.id,
        scope: record.scope,
        name: record.name,
        description: record.description,
        enabled: record.enabled,
        priority: record.priority,
        matchAll: record.matchAllConditions,
        severity: record.severity,
        groupId: record.groupId,
        createdBy: record.createdBy,
        updatedAt: record.updatedAt.toISOString(),
        config: record.config,
      })),
    });
  });

  router.get("/:id", async (req, res) => {
    const rule = await findFirewallRuleById(req.params.id);
    if (!rule) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }
    res.json({
      id: rule.id,
      scope: rule.scope,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      priority: rule.priority,
      matchAll: rule.matchAllConditions,
      severity: rule.severity,
      chatId: rule.chatId,
      createdBy: rule.createdBy,
      updatedAt: rule.updatedAt.toISOString(),
      config: rule.config,
    });
  });

  router.post("/", async (req, res) => {
    let payload;
    try {
      payload = parseRulePayload(req.body, req.telegramAuth?.userId ?? null);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid rule payload" });
      return;
    }

    const result = await upsertFirewallRule(payload);
    await invalidateFirewallCache(payload.groupChatId ?? null);

    const stored = await findFirewallRuleById(result.id);
    res.status(payload.id ? 200 : 201).json({
      id: result.id,
      chatId: result.chatId,
      scope: result.scope,
      rule: stored
        ? {
            id: stored.id,
            scope: stored.scope,
            updatedAt: stored.updatedAt.toISOString(),
            config: stored.config,
          }
        : null,
    });
  });

  router.delete("/:id", async (req, res) => {
    const rule = await findFirewallRuleById(req.params.id);
    if (!rule) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }
    await deleteFirewallRule(req.params.id);
    await invalidateFirewallCache(rule.chatId ?? null);
    res.status(204).send();
  });

  return router;
}

type RawRulePayload = {
  id?: unknown;
  chatId?: unknown;
  scope?: unknown;
  name?: unknown;
  description?: unknown;
  enabled?: unknown;
  priority?: unknown;
  matchAll?: unknown;
  severity?: unknown;
  conditions?: unknown;
  actions?: unknown;
  escalation?: unknown;
};

function parseRulePayload(body: unknown, actorId: string | null): FirewallRuleInput {
  if (!body || typeof body !== "object") {
    throw new Error("Rule payload must be an object");
  }

  const raw = body as RawRulePayload;

  const scope = raw.scope === "global" ? "global" : "group";
  const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : null;
  if (!name) {
    throw new Error("Rule name is required");
  }

  const groupChatId =
    scope === "group"
      ? typeof raw.chatId === "string" && raw.chatId.trim().length > 0
        ? raw.chatId.trim()
        : null
      : null;

  if (scope === "group" && !groupChatId) {
    throw new Error("groupChatId is required for group-scoped rules");
  }

  const conditions = normalizeConditions(raw.conditions);
  const actions = normalizeActions(raw.actions);
  const escalation = normalizeEscalation(raw.escalation);

  if (!actions.length) {
    throw new Error("Rule must include at least one action");
  }

  return {
    id: typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : undefined,
    groupChatId,
    scope,
    name,
    description: typeof raw.description === "string" ? raw.description : undefined,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    priority:
      typeof raw.priority === "number" && Number.isFinite(raw.priority) ? Math.trunc(raw.priority) : 100,
    matchAll: typeof raw.matchAll === "boolean" ? raw.matchAll : false,
    severity:
      typeof raw.severity === "number" && Number.isFinite(raw.severity) ? Math.max(1, Math.trunc(raw.severity)) : 1,
    conditions,
    actions,
    escalation,
    createdBy: actorId,
  };
}

const VALID_MEDIA_TYPES = new Set([
  "photo",
  "video",
  "document",
  "audio",
  "voice",
  "animation",
  "video_note",
  "sticker",
]);
const VALID_USER_ROLES = new Set(["new", "restricted", "admin", "owner"]);
const VALID_WARN_SEVERITIES = new Set(["low", "medium", "high"]);
const VALID_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

function normalizeConditions(value: unknown): RuleCondition[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Rule conditions must be an array");
  }
  return value.map((item, index) => parseRuleCondition(item, index + 1));
}

function normalizeActions(
  value: unknown,
  context = "rule",
  options: { allowEmpty?: boolean } = {},
): RuleAction[] {
  if (value === undefined || value === null) {
    if (options.allowEmpty) {
      return [];
    }
    throw new Error(`${context} actions must be provided as an array`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${context} actions must be an array`);
  }
  if (value.length === 0) {
    if (options.allowEmpty) {
      return [];
    }
    throw new Error(`${context} must include at least one action`);
  }
  return value.map((item, index) => parseRuleAction(item, `${context} action #${index + 1}`));
}

function normalizeEscalation(value: unknown): RuleEscalation | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const rawSteps = raw.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new Error("Escalation steps must be a non-empty array");
  }

  const steps = rawSteps.map((step, index) => parseEscalationStep(step, index + 1));
  if (!steps.length) {
    throw new Error("Escalation must include at least one valid step");
  }

  const resetRaw = raw.resetAfterSeconds;
  const resetAfterSeconds =
    resetRaw === undefined
      ? undefined
      : ensurePositiveInt(resetRaw, "escalation resetAfterSeconds");

  return {
    steps,
    resetAfterSeconds,
  };
}

function parseRuleCondition(raw: unknown, index: number): RuleCondition {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Condition #${index} must be an object`);
  }
  const condition = raw as Record<string, unknown>;
  const kind = condition.kind;
  if (typeof kind !== "string") {
    throw new Error(`Condition #${index} is missing a valid kind`);
  }

  switch (kind) {
    case "text_contains": {
      const value = ensureString(condition.value, `Condition #${index} value`);
      return {
        kind: "text_contains",
        value,
        caseSensitive: condition.caseSensitive === true,
      };
    }
    case "regex": {
      const pattern = ensureString(condition.pattern, `Condition #${index} pattern`);
      const flags =
        typeof condition.flags === "string" && condition.flags.trim().length > 0
          ? condition.flags.trim()
          : undefined;
      return { kind: "regex", pattern, flags };
    }
    case "keyword": {
      const keywords = ensureStringArray(condition.keywords, `Condition #${index} keywords`);
      const match = condition.match === "all" ? "all" : "any";
      return {
        kind: "keyword",
        keywords,
        match,
        caseSensitive: condition.caseSensitive === true,
      };
    }
    case "media_type": {
      const typesValue = condition.types;
      if (!Array.isArray(typesValue) || typesValue.length === 0) {
        throw new Error(`Condition #${index} media_type must include at least one type`);
      }
      const types = Array.from(
        new Set(
          typesValue
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => VALID_MEDIA_TYPES.has(item)),
        ),
      ) as Array<"photo" | "video" | "document" | "audio" | "voice" | "animation" | "video_note" | "sticker">;
      if (types.length === 0) {
        throw new Error(`Condition #${index} media_type contains no valid types`);
      }
      return { kind: "media_type", types };
    }
    case "link_domain": {
      const domains = ensureStringArray(condition.domains, `Condition #${index} domains`).map((d) => d.toLowerCase());
      return {
        kind: "link_domain",
        domains,
        allowSubdomains: condition.allowSubdomains === true,
      };
    }
    case "user_role": {
      const rolesValue = ensureStringArray(condition.roles, `Condition #${index} roles`);
      const roles = Array.from(
        new Set(rolesValue.filter((role) => VALID_USER_ROLES.has(role))),
      ) as Array<"new" | "restricted" | "admin" | "owner">;
      if (roles.length === 0) {
        throw new Error(`Condition #${index} roles must include at least one valid role`);
      }
      return { kind: "user_role", roles };
    }
    case "time_range": {
      const startHour = ensureHour(condition.startHour, `Condition #${index} startHour`);
      const endHour = ensureHour(condition.endHour, `Condition #${index} endHour`);
      const timezone =
        typeof condition.timezone === "string" && condition.timezone.trim().length > 0
          ? condition.timezone.trim()
          : undefined;
      return { kind: "time_range", startHour, endHour, timezone };
    }
    case "message_length": {
      const min = ensureOptionalNonNegativeInt(condition.min, `Condition #${index} min`);
      const max = ensureOptionalNonNegativeInt(condition.max, `Condition #${index} max`);
      if (min !== undefined && max !== undefined && min > max) {
        throw new Error(`Condition #${index} min cannot be greater than max`);
      }
      const result: { kind: "message_length"; min?: number; max?: number } = { kind: "message_length" };
      if (min !== undefined) {
        result.min = min;
      }
      if (max !== undefined) {
        result.max = max;
      }
      return result;
    }
    default:
      throw new Error(`Condition #${index} has unsupported kind "${kind}"`);
  }
}

function parseRuleAction(raw: unknown, context: string): RuleAction {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${context} must be an object`);
  }
  const action = raw as Record<string, unknown>;
  const kind = action.kind;
  if (typeof kind !== "string") {
    throw new Error(`${context} is missing a valid kind`);
  }

  switch (kind) {
    case "delete_message":
      return { kind: "delete_message" };
    case "warn": {
      const result: Extract<RuleAction, { kind: "warn" }> = { kind: "warn" };
      const message =
        typeof action.message === "string" && action.message.trim().length > 0
          ? action.message.trim()
          : undefined;
      if (message) {
        result.message = message;
      }
      if (typeof action.severity === "string") {
        const severity = action.severity.toLowerCase();
        if (!VALID_WARN_SEVERITIES.has(severity)) {
          throw new Error(`${context} has invalid severity "${action.severity}"`);
        }
        result.severity = severity as Extract<RuleAction, { kind: "warn" }>["severity"];
      }
      return result;
    }
    case "mute": {
      const durationSeconds = ensurePositiveInt(action.durationSeconds, `${context} durationSeconds`);
      const muteAction: Extract<RuleAction, { kind: "mute" }> = { kind: "mute", durationSeconds };
      const reason =
        typeof action.reason === "string" && action.reason.trim().length > 0
          ? action.reason.trim()
          : undefined;
      if (reason) {
        muteAction.reason = reason;
      }
      return muteAction;
    }
    case "kick": {
      const reason =
        typeof action.reason === "string" && action.reason.trim().length > 0
          ? action.reason.trim()
          : undefined;
      return { kind: "kick", reason };
    }
    case "ban": {
      const banAction: Extract<RuleAction, { kind: "ban" }> = { kind: "ban" };
      const reason =
        typeof action.reason === "string" && action.reason.trim().length > 0
          ? action.reason.trim()
          : undefined;
      if (reason) {
        banAction.reason = reason;
      }
      if (action.durationSeconds !== undefined) {
        banAction.durationSeconds = ensurePositiveInt(action.durationSeconds, `${context} durationSeconds`);
      }
      return banAction;
    }
    case "log": {
      const logAction: Extract<RuleAction, { kind: "log" }> = { kind: "log" };
      if (typeof action.level === "string") {
        const level = action.level.toLowerCase();
        if (!VALID_LOG_LEVELS.has(level)) {
          throw new Error(`${context} has invalid level "${action.level}"`);
        }
        logAction.level = level as Extract<RuleAction, { kind: "log" }>["level"];
      }
      if (typeof action.message === "string" && action.message.trim().length > 0) {
        logAction.message = action.message.trim();
      }
      return logAction;
    }
    default:
      throw new Error(`${context} has unsupported kind "${kind}"`);
  }
}

function parseEscalationStep(raw: unknown, index: number): RuleEscalation["steps"][number] {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Escalation step #${index} must be an object`);
  }
  const step = raw as Record<string, unknown>;
  const threshold = ensurePositiveInt(step.threshold, `Escalation step #${index} threshold`);
  const windowSeconds = ensurePositiveInt(step.windowSeconds, `Escalation step #${index} windowSeconds`);
  const actions = normalizeActions(step.actions, `escalation step #${index}`, { allowEmpty: false });

  return {
    threshold,
    windowSeconds,
    actions,
  };
}

function ensureString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value.trim();
}

function ensureStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${context} must be a non-empty array of strings`);
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (!items.length) {
    throw new Error(`${context} must include at least one non-empty string`);
  }
  return items;
}

function ensurePositiveInt(value: unknown, context: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${context} must be a positive integer`);
  }
  const intValue = Math.trunc(numeric);
  if (!Number.isSafeInteger(intValue)) {
    throw new Error(`${context} exceeds the allowed range`);
  }
  return intValue;
}

function ensureOptionalNonNegativeInt(value: unknown, context: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${context} must be zero or a positive integer`);
  }
  const intValue = Math.trunc(numeric);
  if (!Number.isSafeInteger(intValue)) {
    throw new Error(`${context} exceeds the allowed range`);
  }
  return intValue;
}

function ensureHour(value: unknown, context: string): number {
  const numeric = ensureOptionalNonNegativeInt(value, context);
  if (numeric === undefined) {
    throw new Error(`${context} is required`);
  }
  if (numeric < 0 || numeric > 23) {
    throw new Error(`${context} must be between 0 and 23`);
  }
  return numeric;
}
