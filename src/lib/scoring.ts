import type { Property } from '@/types/property';
import type { Economics } from './finance';
import { FEATURE_LABEL, type SearchQuery } from './query';
import { pct } from './format';

export interface Score {
  value: number;
  reasons: string[];
}

const BASE = 52;

/**
 * Match score, 0–100, always returned with the reasons behind it.
 *
 * Three components, per the spec: fit to the request (~60%), deal quality (~25%),
 * information quality (~15%). Penalties are explicit and never hide a property.
 */
export function scoreProperty(p: Property, e: Economics, q: SearchQuery): Score {
  let value = BASE;
  const reasons: string[] = [];

  // --- fit to what was asked
  if (q.roomsMin && p.rooms >= q.roomsMin) {
    value += 8;
    reasons.push(`${p.rooms} חדרים`);
  }
  if (q.city && p.city === q.city) {
    value += 8;
    reasons.push(p.neighborhood);
  }
  if (q.sqmMin && p.sqm >= q.sqmMin) {
    value += 5;
    reasons.push(`${p.sqm} מ״ר`);
  }
  for (const key of q.features ?? []) {
    const has =
      key === 'parking' ? p.features.parking > 0 : key === 'balcony' ? p.balconySqm > 0 : p.features[key];
    if (has) {
      value += 5;
      reasons.push(FEATURE_LABEL[key]);
    }
  }
  if (q.priceMax && p.price <= q.priceMax) value += 6;

  // --- deal quality
  if (e.deltaVsArea !== null) {
    if (e.deltaVsArea <= -0.1) {
      value += 12;
      reasons.push(`${Math.round(Math.abs(e.deltaVsArea) * 100)}% מתחת לחציון`);
    } else if (e.deltaVsArea <= -0.03) {
      value += 6;
    } else if (e.deltaVsArea > 0.08) {
      value -= 8;
    }
  }
  if (e.grossYield !== undefined) {
    if (e.grossYield >= 0.045) {
      value += 9;
      reasons.push(`תשואה ${pct(e.grossYield)}`);
    } else if (e.grossYield >= 0.035) {
      value += 4;
    }
  }
  if (p.priceDrop > 0) {
    value += 5;
    reasons.push('ירידת מחיר');
  }
  if (p.publisherKind === 'private') {
    value += 3;
    reasons.push('ללא דמי תיווך');
  }

  // --- information quality: a well-documented listing outranks three lines of text
  if (p.registryVerified) value += 4;
  if (p.comparables.length >= 3) value += 4;

  // --- penalties
  if (p.splitPermit === 'unknown' || p.splitPermit === 'none') value -= 25;
  if (p.registryKind === 'housingCompany') value -= 8;
  if (!p.registryVerified) value -= 4;

  return { value: Math.max(8, Math.min(99, Math.round(value))), reasons: reasons.slice(0, 3) };
}
