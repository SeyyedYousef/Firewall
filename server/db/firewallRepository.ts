import type { FirewallRuleConfig, RuleAction, RuleCondition, RuleEscalation } from "../../shared/firewall.js";
import { Prisma } from "@prisma/client";
import { prisma } from "./client.js";
import { logger } from "../utils/logger.js";

type RuleRecord = {
  id: string;
  scope: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  matchAllConditions: boolean;
  severity: number;
  legacyType: string | null;
  legacyPattern: string | null;
  legacyAction: string | null;
  conditions: RuleCondition[];
  actions: RuleAction[];
  escalation: RuleEscalation | null;
  schedule: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
  groupId: string | null;
  chatId: string | null;
  groupTitle: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  config: FirewallRuleConfig;
};

function parseJsonArray<T>(value: Prisma.JsonValue | null | undefined, fallback: T[]): T[] {
  if (!value) {
    return fallback;
  }
  if (Array.isArray(value)) {
    return value as T[];
  }
  return fallback;
}

function parseJsonObject<T>(value: Prisma.JsonValue | null | undefined): T | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as T;
}

function toRuleConfig(rule: RuleRecord): FirewallRuleConfig {
  return rule.config;
}

export async function listFirewallRules(groupChatId?: string | null): Promise<RuleRecord[]> {
  const where = groupChatId
    ? {
        OR: [
          { group: { telegramChatId: groupChatId } },
          { groupId: null },
        ],
      }
    : undefined;

  const rules = await prisma.firewallRule.findMany({
    where,
    orderBy: {
      createdAt: "asc",
    },
    include: {
      group: {
        select: {
          telegramChatId: true,
          title: true,
        },
      },
    },
  });

  return rules.map((rule) => {
    const conditions = parseJsonArray<RuleCondition>(rule.conditions, []);
    const actions = parseJsonArray<RuleAction>(rule.actions, []);
    const escalation = parseJsonObject<RuleEscalation>(rule.escalation);

    const config: FirewallRuleConfig = {
      version: 1,
      name: rule.name,
      description: rule.description ?? undefined,
      enabled: rule.enabled,
      scope: rule.scope as "group" | "global",
      priority: rule.priority,
      matchAll: rule.matchAllConditions,
      conditions,
      actions,
      escalation: escalation ?? undefined,
      createdBy: rule.createdBy ?? undefined,
    };

    return {
      id: rule.id,
      scope: rule.scope,
      name: rule.name,
      description: rule.description ?? null,
      enabled: rule.enabled,
      priority: rule.priority,
      matchAllConditions: rule.matchAllConditions,
      severity: rule.severity,
      legacyType: rule.type ?? null,
      legacyPattern: rule.pattern ?? null,
      legacyAction: rule.action ?? null,
      conditions,
      actions,
      escalation,
      schedule: rule.schedule,
      metadata: rule.metadata,
      groupId: rule.groupId,
      chatId: rule.group?.telegramChatId ?? null,
      groupTitle: rule.group?.title ?? null,
      createdBy: rule.createdBy ?? null,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
      config,
    };
  });
}

export type FirewallRuleInput = {
  id?: string;
  groupChatId?: string | null;
  scope: "group" | "global";
  name: string;
  description?: string | null;
  enabled?: boolean;
  priority?: number;
  matchAll?: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
  escalation?: RuleEscalation;
  severity?: number;
  schedule?: Prisma.JsonValue;
  metadata?: Prisma.JsonValue;
  createdBy?: string | null;
  legacy?: {
    type?: string | null;
    pattern?: string | null;
    action?: string | null;
  };
};

export async function upsertFirewallRule(input: FirewallRuleInput): Promise<{ id: string; chatId: string | null; scope: string }> {
  logger.info("firewall rule upsert", { id: input.id ?? "new", scope: input.scope });
  const group = input.groupChatId
    ? await prisma.group.findUnique({ where: { telegramChatId: input.groupChatId } })
    : null;

  const conditions: RuleCondition[] = Array.isArray(input.conditions) ? input.conditions : [];
  const actions: RuleAction[] = Array.isArray(input.actions) ? input.actions : [];

  const data = {
    groupId: group?.id ?? null,
    scope: input.scope,
    name: input.name,
  type: input.legacy?.type ?? "",
  pattern: input.legacy?.pattern ?? "",
  action: input.legacy?.action ?? "",
    severity: input.severity ?? 1,
    schedule: input.schedule ?? undefined,
    metadata: input.metadata ?? undefined,
    description: input.description ?? undefined,
    enabled: input.enabled ?? true,
    priority: input.priority ?? 100,
    matchAllConditions: input.matchAll ?? false,
  conditions: conditions as unknown as Prisma.InputJsonValue,
  actions: actions as unknown as Prisma.InputJsonValue,
  escalation: input.escalation ? (input.escalation as unknown as Prisma.InputJsonValue) : undefined,
    createdBy: input.createdBy ?? undefined,
  } satisfies Prisma.FirewallRuleUncheckedCreateInput;

    if (input.id) {
    const updated = await prisma.firewallRule.update({
      where: { id: input.id },
      data,
      include: { group: { select: { telegramChatId: true } } },
    });
    return { id: updated.id, chatId: input.groupChatId ?? null, scope: updated.scope };
  }

  const created = await prisma.firewallRule.create({
    data,
    include: { group: { select: { telegramChatId: true } } },
  });
  return { id: created.id, chatId: input.groupChatId ?? null, scope: created.scope };
}

export async function deleteFirewallRule(id: string): Promise<void> {
  logger.info("firewall rule delete", { id });
  await prisma.firewallRule
    .delete({ where: { id } })
    .catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return;
      }
      throw error;
    });
}

export type RuleAuditInput = {
  groupChatId: string;
  ruleId?: string;
  offenderId?: string;
  action: string;
  payload?: Prisma.JsonValue;
};

export async function appendRuleAudit(input: RuleAuditInput): Promise<void> {
  const group = await prisma.group.findUnique({ where: { telegramChatId: input.groupChatId } });
  if (!group) {
    logger.warn("appendRuleAudit: group not found", { chatId: input.groupChatId });
    return;
  }

  await prisma.ruleAudit.create({
    data: {
      groupId: group.id,
      ruleId: input.ruleId,
      offenderId: input.offenderId,
      action: input.action,
      payload: input.payload as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function listRuleAudits(
  groupChatId: string,
  limit = 100,
  options?: { before?: Date | string },
) {
  const group = await prisma.group.findUnique({ where: { telegramChatId: groupChatId } });
  if (!group) {
    return [];
  }

  const whereClause: any = { groupId: group.id };
  if (options?.before) {
    const beforeDate = typeof options.before === "string" ? new Date(options.before) : options.before;
    whereClause.createdAt = { lt: beforeDate };
  }

  const audits = await prisma.ruleAudit.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return audits.map((audit) => ({
    id: audit.id,
    ruleId: audit.ruleId,
    offenderId: audit.offenderId,
    action: audit.action,
    payload: audit.payload,
    createdAt: audit.createdAt,
  }));
}

export async function findFirewallRuleById(
  id: string,
): Promise<{
  id: string;
  scope: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  matchAllConditions: boolean;
  legacyType: string | null;
  legacyPattern: string | null;
  legacyAction: string | null;
  conditions: RuleCondition[];
  actions: RuleAction[];
  escalation: RuleEscalation | null;
  severity: number;
  schedule: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
  createdBy: string | null;
  chatId: string | null;
  config: FirewallRuleConfig;
  updatedAt: Date;
  groupTitle: string | null;
} | null> {
  const rule = await prisma.firewallRule.findUnique({
    where: { id },
    include: { group: { select: { telegramChatId: true, title: true } } },
  });
  if (!rule) {
    return null;
  }
  const conditions = parseJsonArray<RuleCondition>(rule.conditions, []);
  const actions = parseJsonArray<RuleAction>(rule.actions, []);
  const escalation = parseJsonObject<RuleEscalation>(rule.escalation);

  return {
    id: rule.id,
    scope: rule.scope,
    name: rule.name,
    description: rule.description ?? null,
    enabled: rule.enabled,
    priority: rule.priority,
    matchAllConditions: rule.matchAllConditions,
    legacyType: rule.type ?? null,
    legacyPattern: rule.pattern ?? null,
    legacyAction: rule.action ?? null,
    conditions,
    actions,
    escalation,
    severity: rule.severity,
    schedule: rule.schedule,
    metadata: rule.metadata,
    createdBy: rule.createdBy ?? null,
    chatId: rule.group?.telegramChatId ?? null,
    updatedAt: rule.updatedAt,
    groupTitle: rule.group?.title ?? null,
    config: {
      version: 1,
      name: rule.name,
      description: rule.description ?? undefined,
      enabled: rule.enabled,
      scope: rule.scope as "group" | "global",
      priority: rule.priority,
      matchAll: rule.matchAllConditions,
      conditions,
      actions,
      escalation: escalation ?? undefined,
      createdBy: rule.createdBy ?? undefined,
    },
  };
}

export { toRuleConfig, RuleRecord };
