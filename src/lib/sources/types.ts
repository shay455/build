import type { Comparable, MarketStatus } from '@/types/property';

export type { MarketStatus };

/** Below this, a median is an anecdote. */
export const THIN_SAMPLE_THRESHOLD = 3;

export interface MarketSnapshot {
  medianPpsm: number | null;
  comparables: Comparable[];
  sampleSize: number;
  status: MarketStatus;
  /** Which adapter produced this, for display and for debugging a wrong number. */
  sourceId: string;
  /** When we fetched it. */
  fetchedAt: string;
  /** The date of the newest transaction behind it, which is what actually ages. */
  asOf: string | null;
  note?: string;
}

export interface ParcelRef {
  gush: number;
  helka: number;
  city?: string;
}

export interface MarketSource {
  readonly id: string;
  readonly label: string;
  /** Never throws: an unreachable source returns an `unavailable` snapshot. */
  fetchByParcel(ref: ParcelRef): Promise<MarketSnapshot>;
}

export function unavailable(sourceId: string, note: string): MarketSnapshot {
  return {
    medianPpsm: null,
    comparables: [],
    sampleSize: 0,
    status: 'unavailable',
    sourceId,
    fetchedAt: new Date().toISOString(),
    asOf: null,
    note,
  };
}

/** Median price per sqm over the comparables, with the thin-sample rule applied. */
export function summarise(
  comparables: Comparable[],
  sourceId: string,
  note?: string,
): MarketSnapshot {
  const fetchedAt = new Date().toISOString();
  if (comparables.length === 0) {
    return { medianPpsm: null, comparables, sampleSize: 0, status: 'unavailable', sourceId, fetchedAt, asOf: null, note };
  }

  const perSqm = comparables
    .filter((c) => c.sqm > 0)
    .map((c) => c.price / c.sqm)
    .sort((a, b) => a - b);

  const mid = Math.floor(perSqm.length / 2);
  const medianPpsm =
    perSqm.length === 0 ? null : perSqm.length % 2 === 1 ? perSqm[mid] : (perSqm[mid - 1] + perSqm[mid]) / 2;

  // Comparable dates are "MM/YYYY"; compare on year then month.
  const asOf = comparables
    .map((c) => c.date)
    .sort((a, b) => {
      const [am, ay] = a.split('/');
      const [bm, by] = b.split('/');
      return by.localeCompare(ay) || bm.localeCompare(am);
    })[0] ?? null;

  return {
    medianPpsm,
    comparables,
    sampleSize: comparables.length,
    status: perSqm.length < THIN_SAMPLE_THRESHOLD ? 'thin' : 'ok',
    sourceId,
    fetchedAt,
    asOf,
    note,
  };
}
