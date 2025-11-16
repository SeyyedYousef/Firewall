#!/usr/bin/env ts-node
import { spawn } from "node:child_process";

async function runCommand(command: string, args: string[], title: string): Promise<void> {
  process.stdout.write(`\n▶ ${title}\n$ ${command} ${args.join(" ")}\n`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${title} failed with exit code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function main(): Promise<void> {
  await runCommand("npm", ["run", "lint"], "Linting");
  await runCommand("npm", ["run", "test", "--", "--run"], "Unit tests");
  await runCommand("npm", ["run", "build"], "Type-check & build");
  await runCommand("npx", ["prisma", "migrate", "status", "--schema", "prisma/schema.prisma"], "Prisma migrate status");
  await runCommand("npm", ["run", "stars:reconcile"], "Stars reconciliation smoke test");
  console.log("\n✅ Release checklist completed successfully.");
}

main().catch((error) => {
  console.error("\n❌ Release checklist failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
