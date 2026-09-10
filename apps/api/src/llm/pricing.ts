/** USD per million tokens. Source: claude-api skill price table, 2026-06. Re-check quarterly. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};
/** USD per 1,000 web search requests (server tool surcharge). */
const WEB_SEARCH_PER_1K = 10;

export function estimateCostUsd(u: {
  model: string; inputTokens: number; outputTokens: number;
  cacheReadInputTokens: number; cacheCreationInputTokens: number; webSearchRequests: number;
}): number {
  const p = PRICES[u.model] ?? PRICES["claude-opus-5"]!;
  const perTok = (n: number, price: number) => (n / 1_000_000) * price;
  const total =
    perTok(u.inputTokens, p.input) + perTok(u.outputTokens, p.output) +
    perTok(u.cacheReadInputTokens, p.cacheRead) + perTok(u.cacheCreationInputTokens, p.cacheWrite) +
    (u.webSearchRequests / 1000) * WEB_SEARCH_PER_1K;
  return Math.round(total * 1_000_000) / 1_000_000;
}
