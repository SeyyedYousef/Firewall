#!/usr/bin/env ts-node
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BotState } from "../bot/state.js";
import { prisma } from "../server/db/client.js";
import { findStarsReconciliationIssues } from "../server/services/starsReconciliation.js";

function loadStateFromDisk(): BotState | undefined {
  try {
    const projectDir = resolve(fileURLToPath(import.meta.url), "..", "..");
    const statePath = process.env.BOT_STATE_PATH
      ? resolve(process.cwd(), process.env.BOT_STATE_PATH)
      : resolve(projectDir, "data", "bot-state.json");
    const raw = readFileSync(statePath, "utf8");
    return JSON.parse(raw) as BotState;
  } catch {
    return undefined;
  }
}

function formatIssueSummary(issue: Awaited<ReturnType<typeof findStarsReconciliationIssues>>[number]): string {
  const lines: string[] = [];
  lines.push(`Group: ${issue.groupId}`);
  if (issue.stateExpiresAt) {
    lines.push(`  State expiry:    ${issue.stateExpiresAt}`);
  } else {
    lines.push("  State expiry:    (missing)");
  }
  if (issue.expectedExpiresAt) {
    lines.push(`  Expected expiry: ${issue.expectedExpiresAt}`);
  } else {
    lines.push("  Expected expiry: (missing)");
  }
  lines.push(`  Issues: ${issue.issues.join(", ")}`);
  const latest = issue.transactions[issue.transactions.length - 1];
  if (latest) {
    lines.push(`  Latest TX: ${latest.id} (${latest.status})`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const state = loadStateFromDisk();
  const issues = await findStarsReconciliationIssues({ state });

  if (issues.length === 0) {
    console.log("✓ Stars subscriptions are in sync. No mismatches detected.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${issues.length} potential mismatch${issues.length === 1 ? "" : "es"}:\n`);
  for (const issue of issues) {
    console.log(formatIssueSummary(issue));
    console.log("");
  }

  await prisma.$disconnect();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Failed to reconcile Stars subscriptions:", error);
  prisma
    .$disconnect()
    .catch(() => undefined)
    .finally(() => {
      process.exitCode = 1;
    });
});
