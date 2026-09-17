import type { SearchResult } from './search';
import type { SearchQuery } from './query';
import type { BuyerProfile } from '@/types/property';
import { pct, shekel } from './format';

export interface SavedSearch {
  id: string;
  name: string;
  query: SearchQuery;
  profile: BuyerProfile;
  /** Only results at or above this score are worth interrupting someone for. */
  minScore: number;
  createdAt: string;
  lastRunAt: string | null;
}

/** What a property looked like the last time this search ran. */
export interface SeenState {
  price: number;
  score: number;
}

export type AlertKind = 'new' | 'price-drop' | 'score-up';

export interface Alert {
  kind: AlertKind;
  propertyId: string;
  /** One line stating what happened and why it matters — never a bare "new listing". */
  headline: string;
  detail: string;
  score: number;
  price: number;
  previousPrice?: number;
}

/** A score has to move by this much before it is worth saying anything. */
export const SCORE_JUMP = 5;

export interface DiffOutcome {
  alerts: Alert[];
  /** The state to persist for the next run. */
  nextSeen: Record<string, SeenState>;
  /** True when this run only established a baseline. */
  baselined: boolean;
}

function marketContext(r: SearchResult): string {
  const parts: string[] = [];
  if (r.economics.deltaVsArea !== null && r.economics.deltaVsArea < 0) {
    parts.push(`${pct(Math.abs(r.economics.deltaVsArea))} מתחת לחציון האזור`);
  }
  if (r.economics.grossYield !== undefined && r.economics.grossYield >= 0.04) {
    parts.push(`תשואה ${pct(r.economics.grossYield)}`);
  }
  if (r.property.daysOnMarket > 60) parts.push(`${r.property.daysOnMarket} ימים בשוק`);
  return parts.join(' · ');
}

function describe(r: SearchResult): string {
  const p = r.property;
  return `${p.rooms} חדרים, ${p.sqm} מ״ר, ${p.neighborhood || p.city}`;
}

/**
 * Compare this run against the last one.
 *
 * The first run of a saved search only records a baseline: announcing every
 * existing match as "new" would be noise the moment someone saves a search, and
 * it would train them to ignore the next alert, which is the one that matters.
 */
export function diffRun(
  saved: SavedSearch,
  results: readonly SearchResult[],
  seen: Readonly<Record<string, SeenState>> | null,
): DiffOutcome {
  const qualifying = results.filter((r) => r.score.value >= saved.minScore);
  const nextSeen: Record<string, SeenState> = {};
  for (const r of qualifying) {
    nextSeen[r.property.id] = { price: r.property.price, score: r.score.value };
  }

  if (seen === null) {
    return { alerts: [], nextSeen, baselined: true };
  }

  const alerts: Alert[] = [];
  for (const r of qualifying) {
    const before = seen[r.property.id];
    const context = marketContext(r);

    if (!before) {
      alerts.push({
        kind: 'new',
        propertyId: r.property.id,
        headline: `נכס חדש שעונה על "${saved.name}" — ${shekel(r.property.price)}${context ? `, ${context}` : ''}`,
        detail: `${describe(r)}. ציון התאמה ${r.score.value}${r.score.reasons.length ? ` · ${r.score.reasons.join(' · ')}` : ''}`,
        score: r.score.value,
        price: r.property.price,
      });
      continue;
    }

    if (r.property.price < before.price) {
      const drop = before.price - r.property.price;
      alerts.push({
        kind: 'price-drop',
        propertyId: r.property.id,
        headline: `ירד ב־${shekel(drop)} (${pct(drop / before.price)})${context ? ` — כעת ${context}` : ''}`,
        detail: `${describe(r)}. ${shekel(before.price)} ← ${shekel(r.property.price)}`,
        score: r.score.value,
        price: r.property.price,
        previousPrice: before.price,
      });
      continue;
    }

    if (r.score.value - before.score >= SCORE_JUMP) {
      alerts.push({
        kind: 'score-up',
        propertyId: r.property.id,
        headline: `ההתאמה עלתה מ־${before.score} ל־${r.score.value}${context ? ` — ${context}` : ''}`,
        detail: `${describe(r)}. ${r.score.reasons.join(' · ')}`,
        score: r.score.value,
        price: r.property.price,
      });
    }
  }

  // A price drop outranks a new listing: it is the rarer event and the more actionable one.
  const rank: Record<AlertKind, number> = { 'price-drop': 0, new: 1, 'score-up': 2 };
  alerts.sort((a, b) => rank[a.kind] - rank[b.kind] || b.score - a.score);

  return { alerts, nextSeen, baselined: false };
}
