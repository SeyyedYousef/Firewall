import { prisma } from "../db/client.js";

export type HealthStatus = {
  status: "ok" | "degraded" | "error";
  latencyMs?: number;
  error?: string;
};

export async function checkDatabaseHealth(): Promise<HealthStatus> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - started;
    return {
      status: "ok",
      latencyMs: Number(latencyMs.toFixed(2)),
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
