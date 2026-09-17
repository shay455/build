import 'server-only';
import { FixtureSource } from './fixtures';
import { NadlanSource } from './nadlan';
import type { MarketSource, MarketSnapshot, ParcelRef } from './types';
import { readCache, writeCache } from '@/lib/db';

export * from './types';
export { FixtureSource } from './fixtures';
export { NadlanSource, parseDeals } from './nadlan';

/**
 * Which source backs market data.
 *
 * Defaults to fixtures. `MARKET_SOURCE=nadlan` switches to the live adapter, which
 * has never run against the real service — see the note in nadlan.ts before relying on it.
 */
export function resolveSource(): MarketSource {
  return process.env.MARKET_SOURCE === 'nadlan' ? new NadlanSource() : new FixtureSource();
}

/** A fetched snapshot is good for a day; transaction data moves in weeks, not minutes. */
const TTL_MS = Number(process.env.MARKET_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);

/**
 * Cached parcel lookup. The cache is keyed by source as well as parcel, so switching
 * MARKET_SOURCE never serves one source's numbers under another's name.
 */
export async function getMarketSnapshot(
  ref: ParcelRef,
  source: MarketSource = resolveSource(),
  { force = false }: { force?: boolean } = {},
): Promise<MarketSnapshot & { cached: boolean }> {
  const key = `${source.id}:${ref.gush}-${ref.helka}`;

  if (!force) {
    const row = await readCache(key);
    if (row && new Date(row.expiresAt) > new Date()) {
      return { ...(JSON.parse(row.payload) as MarketSnapshot), cached: true };
    }
  }

  const snapshot = await source.fetchByParcel(ref);

  // An unavailable result is cached briefly too, so a dead source is not hammered
  // once per card render — but for minutes, not a day.
  const ttl = snapshot.status === 'unavailable' ? Math.min(TTL_MS, 5 * 60 * 1000) : TTL_MS;
  await writeCache(
    key,
    JSON.stringify(snapshot),
    snapshot.fetchedAt,
    new Date(Date.now() + ttl).toISOString(),
  );

  return { ...snapshot, cached: false };
}
