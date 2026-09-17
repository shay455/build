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
