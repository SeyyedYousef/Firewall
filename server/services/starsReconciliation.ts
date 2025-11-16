import { prisma } from "../db/client.js";
import type { BotState, GroupStarsRecord } from "../../bot/state.js";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataToRecord(value: unknown): JsonObject {
  return isRecord(value) ? (value as JsonObject) : {};
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  return null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return null;
}

function normalizeTelemetryEntry(entry: unknown) {
  if (!isRecord(entry)) {
    return null;
  }
  const event = typeof entry.event === "string" ? entry.event : "unknown";
  const timestamp =
    typeof entry.timestamp === "string" && entry.timestamp.trim().length > 0
      ? entry.timestamp
      : new Date().toISOString();
  const payload = entry.payload ?? null;
  return { event, timestamp, payload };
}

function extractTelemetry(metadata: JsonObject): Array<{ event: string; timestamp: string; payload: {} | null }> {
  const raw = metadata.telemetry;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => normalizeTelemetryEntry(entry))
    .filter((entry): entry is { event: string; timestamp: string; payload: {} | null } => entry !== null);
}

export type StarsTransactionInspector = {
  id: string;
  status: string;
  createdAt: string | null;
  completedAt: string | null;
  amount: number;
  expiresAt: string | null;
  planId: string | null;
  planDays: number | null;
  metadataIssues: string[];
  telemetry: Array<{ event: string; timestamp: string; payload: unknown }>;
};

export type StarsReconciliationIssue = {
  groupId: string;
  stateExpiresAt: string | null;
  expectedExpiresAt: string | null;
  latestTransactionId: string | null;
  latestTransactionStatus: string | null;
  issues: string[];
  transactions: StarsTransactionInspector[];
};

export interface StarsReconciliationOptions {
  state?: BotState;
  toleranceSeconds?: number;
  pendingThresholdMinutes?: number;
}

function collectStateGroups(state?: BotState): Map<string, GroupStarsRecord> {
  if (!state) {
    return new Map();
  }
  return new Map<string, GroupStarsRecord>(Object.entries(state.stars.groups));
}

function pickLatestCompleted(transactions: StarsTransactionInspector[]): StarsTransactionInspector | undefined {
  return transactions
    .filter((tx) => tx.status === "completed")
    .sort((a, b) => {
      const aTime = Date.parse(a.completedAt ?? a.createdAt ?? "0");
      const bTime = Date.parse(b.completedAt ?? b.createdAt ?? "0");
      return bTime - aTime;
    })[0];
}

export async function findStarsReconciliationIssues(
  options: StarsReconciliationOptions = {},
): Promise<StarsReconciliationIssue[]> {
  const toleranceSeconds = options.toleranceSeconds ?? 60;
  const pendingThresholdMs = (options.pendingThresholdMinutes ?? 30) * 60_000;
  const now = Date.now();

  const stateGroups = collectStateGroups(options.state);

  const rawTransactions = await prisma.starTransaction.findMany({
    where: {
      status: {
        in: ["pending", "completed", "refunded"],
      },
    },
    orderBy: [
      {
        createdAt: "asc",
      },
    ],
    select: {
      id: true,
      status: true,
      amount: true,
      metadata: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const orphanIssues: StarsReconciliationIssue[] = [];
  const grouped = new Map<string, StarsTransactionInspector[]>();

  for (const record of rawTransactions) {
    const metadata = metadataToRecord(record.metadata);
    const telemetry = extractTelemetry(metadata);
    const groupChatId =
      toStringValue(metadata.groupChatId) ??
      toStringValue(metadata.groupId) ??
      toStringValue((metadata.group ?? {}) && (metadata.group as JsonObject).chatId);
    const expiresAt = toStringValue(metadata.expiresAt);
    const planId = toStringValue(metadata.planId);
    const planDays = toNumberValue(metadata.planDays);

    const metadataIssues: string[] = [];
    if (!groupChatId) {
      metadataIssues.push("metadata.groupChatId missing");
    }
    if (record.status === "completed" && !expiresAt) {
      metadataIssues.push("metadata.expiresAt missing");
    }
    if (!planId) {
      metadataIssues.push("metadata.planId missing");
    }
    if (planDays === null) {
      metadataIssues.push("metadata.planDays missing");
    }

    const inspector: StarsTransactionInspector = {
      id: record.id,
      status: record.status,
      createdAt: record.createdAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      amount: record.amount,
      expiresAt,
      planId,
      planDays,
      metadataIssues,
      telemetry,
    };

    if (!groupChatId) {
      orphanIssues.push({
        groupId: "unknown",
        stateExpiresAt: null,
        expectedExpiresAt: expiresAt,
        latestTransactionId: record.id,
        latestTransactionStatus: record.status,
        issues: ["transaction missing group reference", ...metadataIssues],
        transactions: [inspector],
      });
      continue;
    }

    if (!grouped.has(groupChatId)) {
      grouped.set(groupChatId, []);
    }
    grouped.get(groupChatId)!.push(inspector);
  }

  const allGroupIds = new Set<string>([...grouped.keys(), ...stateGroups.keys()]);
  const mismatches: StarsReconciliationIssue[] = [];

  for (const groupId of allGroupIds) {
    const txList = grouped.get(groupId) ?? [];
    const state = stateGroups.get(groupId);

    const issues: string[] = [];
    const latestCompleted = pickLatestCompleted(txList);
    const expectedExpiresAt = latestCompleted?.expiresAt ?? null;
    const stateExpiresAt = state?.expiresAt ?? null;

    if (!state && txList.some((tx) => tx.status === "completed")) {
      issues.push("state missing subscription record");
    }

    if (state && txList.every((tx) => tx.status !== "completed")) {
      issues.push("database missing completed transactions");
    }

    if (stateExpiresAt && expectedExpiresAt) {
      const diff = Math.abs(Date.parse(stateExpiresAt) - Date.parse(expectedExpiresAt));
      if (Number.isFinite(diff) && diff > toleranceSeconds * 1000) {
        issues.push(`expiry mismatch (${Math.round(diff / 1000)}s)`);
      }
    } else if (stateExpiresAt && !expectedExpiresAt) {
      issues.push("database missing expected expiry");
    } else if (!stateExpiresAt && expectedExpiresAt) {
      issues.push("state expiry missing");
    }

    const agedPending = txList.filter(
      (tx) =>
        tx.status === "pending" &&
        tx.createdAt !== null &&
        now - Date.parse(tx.createdAt) > pendingThresholdMs,
    );
    if (agedPending.length > 0) {
      issues.push(`pending transactions older than ${(pendingThresholdMs / 60000).toFixed(0)}m`);
    }

    const refundExists = txList.some((tx) => tx.status === "refunded");
    if (refundExists && stateExpiresAt) {
      const future = Date.parse(stateExpiresAt);
      if (Number.isFinite(future) && future > Date.now()) {
        issues.push("refund present but state still shows active subscription");
      }
    }

    const metadataIssuesPresent = txList.some((tx) => tx.metadataIssues.length > 0);
    if (metadataIssuesPresent) {
      issues.push("metadata issues detected");
    }

    if (issues.length > 0) {
      mismatches.push({
        groupId,
        stateExpiresAt,
        expectedExpiresAt,
        latestTransactionId: latestCompleted?.id ?? (txList[txList.length - 1]?.id ?? null),
        latestTransactionStatus: latestCompleted?.status ?? (txList[txList.length - 1]?.status ?? null),
        issues,
        transactions: txList.slice(-5),
      });
    }
  }

  return [...mismatches, ...orphanIssues].sort((a, b) => {
    const aTime = Date.parse(
      a.transactions[a.transactions.length - 1]?.completedAt ??
        a.transactions[a.transactions.length - 1]?.createdAt ??
        "0",
    );
    const bTime = Date.parse(
      b.transactions[b.transactions.length - 1]?.completedAt ??
        b.transactions[b.transactions.length - 1]?.createdAt ??
        "0",
    );
    return bTime - aTime;
  });
}
