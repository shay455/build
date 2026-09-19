import type { BuyerProfile, Flag, Property } from '@/types/property';
import { economics, type Economics } from './finance';
import { flagsFor } from './flags';
import type { SearchQuery } from './query';
import { scoreProperty, type Score } from './scoring';

export type SortKey = 'match' | 'price-asc' | 'price-desc' | 'ppsm' | 'yield' | 'fresh' | 'stale';

export interface SearchResult {
  property: Property;
  economics: Economics;
  score: Score;
  flags: Flag[];
}

/**
 * Everything the UI needs about one property for a given user: the money, the
 * score with its reasons, and the flags. Filtering is a separate concern, so this
 * also serves the comparison view, where the user has already chosen the property.
 */
export function evaluate(property: Property, q: SearchQuery, profile: BuyerProfile): SearchResult {
  const e = economics(property, profile);
  return { property, economics: e, score: scoreProperty(property, e, q), flags: flagsFor(property, e) };
}

/** Hard filters exclude; the score only orders what survives. */
export function passesFilters(p: Property, q: SearchQuery, e: Economics): boolean {
  if (q.deal && p.deal !== q.deal) return false;
  if (q.city && p.city !== q.city) return false;
  if (q.assetType && p.assetType !== q.assetType) return false;
  if (q.roomsMin && p.rooms < q.roomsMin) return false;
  if (q.priceMin && p.price < q.priceMin) return false;
  if (q.priceMax && p.price > q.priceMax) return false;
  if (q.sqmMin && p.sqm < q.sqmMin) return false;
  if (q.yieldMin && (e.grossYield === undefined || e.grossYield < q.yieldMin)) return false;

  for (const key of q.features ?? []) {
    if (key === 'parking') {
      if (p.features.parking <= 0) return false;
    } else if (key === 'balcony') {
      if (p.balconySqm <= 0) return false;
    } else if (!p.features[key]) {
      return false;
    }
  }
  return true;
}

const COMPARATORS: Record<SortKey, (a: SearchResult, b: SearchResult) => number> = {
  match: (a, b) => b.score.value - a.score.value,
  'price-asc': (a, b) => a.property.price - b.property.price,
  'price-desc': (a, b) => b.property.price - a.property.price,
  ppsm: (a, b) => (a.economics.ppsm ?? Infinity) - (b.economics.ppsm ?? Infinity),
  yield: (a, b) => (b.economics.grossYield ?? 0) - (a.economics.grossYield ?? 0),
  fresh: (a, b) => a.property.daysOnMarket - b.property.daysOnMarket,
  stale: (a, b) => b.property.daysOnMarket - a.property.daysOnMarket,
};

export function search(
  properties: readonly Property[],
  q: SearchQuery,
  profile: BuyerProfile,
  sort: SortKey = 'match',
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const property of properties) {
    const evaluated = evaluate(property, q, profile);
    if (!passesFilters(property, q, evaluated.economics)) continue;
    results.push(evaluated);
  }
  return results.sort(COMPARATORS[sort] ?? COMPARATORS.match);
}

/** A filter that, on its own, is what keeps the result set empty. */
export interface Blocker {
  key: keyof SearchQuery;
  /** What to tell the user, phrased as the constraint they set. */
  label: string;
  /** How many properties would match if this one constraint were dropped. */
  wouldMatch: number;
}

export interface EmptyDiagnosis {
  /** Everything in the index, both deal types. */
  total: number;
  /** How many are of the requested deal type at all. */
  sameDeal: number;
  /** Constraints that would each, alone, unblock the search. Most permissive first. */
  blockers: Blocker[];
}

/**
 * Explain an empty result set.
 *
 * "No properties match" is true and useless. Removing one constraint at a time
 * shows which one is actually doing the excluding, which is the thing the user
 * can act on — and with a small index, usually it is the price ceiling.
 */
export function diagnoseEmpty(
  properties: readonly Property[],
  q: SearchQuery,
  profile: BuyerProfile,
  labels: { city: (v: string) => string; assetType: (v: string) => string; feature: (v: string) => string },
): EmptyDiagnosis {
  const sameDeal = properties.filter((p) => !q.deal || p.deal === q.deal).length;

  const describe: Partial<Record<keyof SearchQuery, () => string>> = {
    city: () => `עיר: ${labels.city(q.city!)}`,
    assetType: () => `סוג נכס: ${labels.assetType(q.assetType!)}`,
    roomsMin: () => `${q.roomsMin}+ חדרים`,
    priceMin: () => `מחיר מ־${q.priceMin!.toLocaleString('he-IL')}`,
    priceMax: () => `מחיר עד ${q.priceMax!.toLocaleString('he-IL')}`,
    sqmMin: () => `שטח מ־${q.sqmMin} מ״ר`,
    yieldMin: () => `תשואה מעל ${(q.yieldMin! * 100).toFixed(1)}%`,
    features: () => (q.features ?? []).map(labels.feature).join(', '),
  };

  const blockers: Blocker[] = [];
  for (const key of Object.keys(describe) as Array<keyof SearchQuery>) {
    if (q[key] === undefined || (key === 'features' && (q.features ?? []).length === 0)) continue;
    const relaxed: SearchQuery = { ...q, [key]: undefined };
    const wouldMatch = search(properties, relaxed, profile).length;
    if (wouldMatch > 0) blockers.push({ key, label: describe[key]!(), wouldMatch });
  }

  blockers.sort((a, b) => b.wouldMatch - a.wouldMatch);
  return { total: properties.length, sameDeal, blockers };
}
