import { desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { config } from "./config.js";

/**
 * List prices in USD as of September 2026. Update here when a vendor changes its rate card;
 * everything else reads from this table.
 */
export const PRICES = {
  anthropic: {
    // per million tokens: [input, output, cache read]
    "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
    "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
    "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
  } as Record<string, { input: number; output: number; cacheRead: number }>,
  gemini: {
    // per image
    "gemini-3-pro-image": { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
    "gemini-3.1-flash-image": { "1K": 0.067, "2K": 0.134, "4K": 0.151 },
  } as Record<string, Record<string, number>>,
  fal: {
    // per second of output video, audio on
    "fal-ai/kling-video/v3/standard/image-to-video": 0.126,
    "fal-ai/kling-video/v3/pro/image-to-video": 0.168,
  } as Record<string, number>,
  whatsapp: { service: 0, utilityIL: 0.0053, marketingIL: 0.0353 },
};

export interface TokenUsage { inputTokens: number; outputTokens: number; cacheReadTokens?: number }

export function claudeCostUsd(model: string, u: TokenUsage): number {
  const p = PRICES.anthropic[model];
  if (!p) return 0;
  const uncached = Math.max(0, u.inputTokens - (u.cacheReadTokens ?? 0));
  return (uncached * p.input + (u.cacheReadTokens ?? 0) * p.cacheRead + u.outputTokens * p.output) / 1_000_000;
}

export function geminiImageCostUsd(model: string, size: string): number {
  return PRICES.gemini[model]?.[size] ?? 0;
}

export async function recordClaudeCall(jobId: number | null, model: string, action: string, u: TokenUsage) {
  await db.insert(schema.apiCalls).values({
    jobId, provider: "anthropic", model, action,
    inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens ?? 0,
    costUsd: claudeCostUsd(model, u).toFixed(6),
  });
}

export async function recordImageCall(jobId: number | null, model: string, action: string, size: string, units = 1) {
  await db.insert(schema.apiCalls).values({
    jobId, provider: "gemini", model, action, units: String(units),
    costUsd: (geminiImageCostUsd(model, size) * units).toFixed(6),
  });
}

export async function recordVideoCall(jobId: number | null, model: string, seconds: number) {
  await db.insert(schema.apiCalls).values({
    jobId, provider: "fal", model, action: "video", units: String(seconds),
    costUsd: ((PRICES.fal[model] ?? 0) * seconds).toFixed(6),
  });
}

export async function jobCostUsd(jobId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.apiCalls.costUsd}), 0)` })
    .from(schema.apiCalls)
    .where(eq(schema.apiCalls.jobId, jobId));
  return Number(row?.total ?? 0);
}

/** Month-to-date spend, grouped by provider, plus job count. Used by the `עלויות` command. */
export async function monthSummary() {
  const start = new Date();
  start.setDate(1); start.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ provider: schema.apiCalls.provider, total: sql<string>`sum(${schema.apiCalls.costUsd})` })
    .from(schema.apiCalls)
    .where(gte(schema.apiCalls.createdAt, start))
    .groupBy(schema.apiCalls.provider);
  const [jobsRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.jobs)
    .where(gte(schema.jobs.createdAt, start));
  const totalUsd = rows.reduce((s, r) => s + Number(r.total), 0);
  return { rows, totalUsd, totalIls: totalUsd * config().USD_ILS, jobs: Number(jobsRow?.n ?? 0) };
}

export const usdToIls = (usd: number) => usd * config().USD_ILS;
export const latestJobsOrder = desc(schema.jobs.createdAt);
