import type { Comparable } from '@/types/property';
import { summarise, unavailable, type MarketSource, type MarketSnapshot, type ParcelRef } from './types';

/**
 * Adapter for the Israel Tax Authority's Nadlan transaction database.
 *
 * STATUS: written against the documented request shape, NOT verified against the
 * live service — the build environment's network policy blocks gov.il, so this has
 * never executed a real request. Treat the parsing below as a first draft: run it
 * against the real endpoint and correct the field names before enabling it.
 *
 * It is disabled unless MARKET_SOURCE=nadlan, and `resolveSource` falls back to
 * fixtures otherwise. It never throws and never invents a number: anything it
 * cannot parse becomes an `unavailable` snapshot, which the UI renders as
 * "no basis for comparison" rather than as a confident zero.
 */
export const NADLAN_ENDPOINT =
  process.env.NADLAN_ENDPOINT ?? 'https://www.nadlan.gov.il/Nadlan.REST/Main/GetAssestAndDeals';

const TIMEOUT_MS = Number(process.env.NADLAN_TIMEOUT_MS ?? 8000);

interface NadlanDeal {
  DEALDATE?: string;
  DEALAMOUNT?: string;
  DEALNATURE?: string;
  ASSETROOMNUM?: string;
}

/** "15.03.2026" or an ISO date → "MM/YYYY", which is the granularity we display. */
function toMonthYear(raw: string | undefined): string | null {
  if (!raw) return null;
  const dotted = raw.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (dotted) return `${dotted[2].padStart(2, '0')}/${dotted[3]}`;
  const iso = raw.match(/(\d{4})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[1]}`;
  return null;
}

/** Nadlan returns amounts with thousands separators and sometimes a currency sign. */
function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseDeals(deals: readonly NadlanDeal[]): Comparable[] {
  const out: Comparable[] = [];
  for (const d of deals) {
    const date = toMonthYear(d.DEALDATE);
    const price = toNumber(d.DEALAMOUNT);
    const sqm = toNumber(d.DEALNATURE);
    // A deal without all three is not a comparable. Dropping it is correct;
    // guessing the missing field would poison the median.
    if (date && price && sqm) out.push({ date, sqm, price });
  }
  return out;
}

export class NadlanSource implements MarketSource {
  readonly id = 'nadlan';
  readonly label = 'נדל״ן — רשות המסים';

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchByParcel(ref: ParcelRef): Promise<MarketSnapshot> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(NADLAN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ MoreData: `${ref.gush}-${ref.helka}`, PageNo: 1, OrderByFilled: 'DEALDATE' }),
        signal: controller.signal,
      });

      if (!res.ok) {
        return unavailable(this.id, `נדל״ן החזיר סטטוס ${res.status}`);
      }

      const json: unknown = await res.json();
      const deals =
        json && typeof json === 'object' && Array.isArray((json as { AllResults?: unknown }).AllResults)
          ? ((json as { AllResults: NadlanDeal[] }).AllResults)
          : [];

      const comparables = parseDeals(deals);
      if (comparables.length === 0) {
        return unavailable(this.id, `לא נמצאו עסקאות מדווחות לגוש ${ref.gush} חלקה ${ref.helka}`);
      }
      return summarise(comparables.slice(0, 8), this.id);
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? 'הבקשה עברה את זמן ההמתנה' : 'המקור אינו זמין';
      return unavailable(this.id, `${reason} — לא הוצג נתון השוואה`);
    } finally {
      clearTimeout(timer);
    }
  }
}
