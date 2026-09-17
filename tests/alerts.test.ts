import { describe, expect, it } from 'vitest';
import { diffRun, SCORE_JUMP, type SavedSearch, type SeenState } from '@/lib/alerts';
import { evaluate } from '@/lib/search';
import { makeProperty } from './factory';
import type { SearchResult } from '@/lib/search';
import type { Property } from '@/types/property';

const saved: SavedSearch = {
  id: 's1',
  name: '4 חדרים בחיפה',
  query: { deal: 'sale', city: 'חיפה' },
  profile: 'single',
  minScore: 60,
  createdAt: '2026-09-01',
  lastRunAt: null,
};

const res = (over: Partial<Property> = {}): SearchResult =>
  evaluate(makeProperty({ price: 2_000_000, sqm: 100, areaMedianPpsm: 25_000, ...over }), saved.query, 'single');

const seenOf = (r: SearchResult, over: Partial<SeenState> = {}): Record<string, SeenState> => ({
  [r.property.id]: { price: r.property.price, score: r.score.value, ...over },
});

describe('first run', () => {
  it('records a baseline instead of announcing every existing match', () => {
    const a = res({ id: 'a' });
    const b = res({ id: 'b' });
    const out = diffRun(saved, [a, b], null);
    expect(out.baselined).toBe(true);
    expect(out.alerts).toHaveLength(0);
    expect(Object.keys(out.nextSeen)).toEqual(['a', 'b']);
  });
});

describe('new listings', () => {
  it('alerts on a property that was not there last time', () => {
    const old = res({ id: 'old' });
    const fresh = res({ id: 'fresh' });
    const out = diffRun(saved, [old, fresh], seenOf(old));
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0]).toMatchObject({ kind: 'new', propertyId: 'fresh' });
  });

  it('says what makes it worth looking at, not just that it is new', () => {
    const fresh = res({ id: 'fresh', price: 2_000_000, sqm: 100, areaMedianPpsm: 25_000, expectedMonthlyRent: 7_000 });
    const out = diffRun(saved, [fresh], { other: { price: 1, score: 1 } });
    expect(out.alerts[0].headline).toContain('מתחת לחציון האזור');
    expect(out.alerts[0].headline).toContain('תשואה');
    expect(out.alerts[0].detail).toContain('ציון התאמה');
  });

  it('stays quiet when nothing changed', () => {
    const p = res({ id: 'p' });
    expect(diffRun(saved, [p], seenOf(p)).alerts).toHaveLength(0);
  });
});

describe('price drops', () => {
  it('reports the amount and the share', () => {
    const now = res({ id: 'p', price: 1_800_000 });
    const out = diffRun(saved, [now], { p: { price: 2_000_000, score: now.score.value } });
    expect(out.alerts[0]).toMatchObject({ kind: 'price-drop', previousPrice: 2_000_000, price: 1_800_000 });
    expect(out.alerts[0].headline).toContain('₪200,000');
    expect(out.alerts[0].headline).toContain('10.0%');
  });

  it('ignores a price rise', () => {
    const now = res({ id: 'p', price: 2_200_000 });
    expect(diffRun(saved, [now], { p: { price: 2_000_000, score: now.score.value } }).alerts).toHaveLength(0);
  });
});

describe('score movement', () => {
  it('alerts only once the jump is large enough', () => {
    const now = res({ id: 'p' });
    const small = diffRun(saved, [now], { p: { price: now.property.price, score: now.score.value - (SCORE_JUMP - 1) } });
    expect(small.alerts).toHaveLength(0);

    const big = diffRun(saved, [now], { p: { price: now.property.price, score: now.score.value - SCORE_JUMP } });
    expect(big.alerts[0]).toMatchObject({ kind: 'score-up' });
  });

  it('never fires for a score that fell', () => {
    const now = res({ id: 'p' });
    expect(diffRun(saved, [now], { p: { price: now.property.price, score: 99 } }).alerts).toHaveLength(0);
  });
});

describe('the score floor', () => {
  it('excludes results below it from both alerts and the baseline', () => {
    const weak = res({ id: 'weak', assetType: 'housingUnit', splitPermit: 'unknown' });
    expect(weak.score.value).toBeLessThan(saved.minScore);
    const out = diffRun(saved, [weak], {});
    expect(out.alerts).toHaveLength(0);
    expect(out.nextSeen).toEqual({});
  });

  it('lets a property through once it clears the floor', () => {
    const strong = res({ id: 'p' });
    expect(diffRun({ ...saved, minScore: 0 }, [strong], {}).alerts).toHaveLength(1);
  });
});

describe('ordering', () => {
  it('puts a price drop above a new listing', () => {
    const dropped = res({ id: 'dropped', price: 1_700_000 });
    const fresh = res({ id: 'fresh' });
    const out = diffRun(saved, [dropped, fresh], { dropped: { price: 2_000_000, score: dropped.score.value } });
    expect(out.alerts.map((a) => a.kind)).toEqual(['price-drop', 'new']);
  });

  it('breaks ties on score, highest first', () => {
    const a = res({ id: 'a', price: 1_500_000, sqm: 120, areaMedianPpsm: 25_000 });
    const b = res({ id: 'b', price: 2_400_000, sqm: 100, areaMedianPpsm: 25_000 });
    const out = diffRun({ ...saved, minScore: 0 }, [a, b], {});
    expect(out.alerts[0].score).toBeGreaterThanOrEqual(out.alerts[1].score);
  });
});

describe('the next baseline', () => {
  it('reflects the run that just happened, so an alert does not repeat', () => {
    const now = res({ id: 'p', price: 1_800_000 });
    const first = diffRun(saved, [now], { p: { price: 2_000_000, score: now.score.value } });
    expect(first.alerts).toHaveLength(1);
    const second = diffRun(saved, [now], first.nextSeen);
    expect(second.alerts).toHaveLength(0);
  });

  it('drops properties that no longer match, so they alert again if they return', () => {
    const p = res({ id: 'p' });
    const gone = diffRun(saved, [], { p: { price: p.property.price, score: p.score.value } });
    expect(gone.nextSeen).toEqual({});
    expect(diffRun(saved, [p], gone.nextSeen).alerts[0].kind).toBe('new');
  });
});
