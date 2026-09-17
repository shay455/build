import { describe, expect, it } from 'vitest';
import { parseQuery } from '@/lib/query';

const CITIES = ['תל אביב-יפו', 'חיפה', 'באר שבע', 'רמת גן', 'קריית ביאליק'];

describe('parseQuery', () => {
  it('parses rooms, city, budget and features together', () => {
    const q = parseQuery('4 חדרים בחיפה עד 2 מיליון עם מעלית וחניה', CITIES);
    expect(q).toMatchObject({ roomsMin: 4, city: 'חיפה', priceMax: 2_000_000, deal: 'sale' });
    expect(q.features).toEqual(expect.arrayContaining(['elevator', 'parking']));
  });

  it('resolves city short forms', () => {
    expect(parseQuery('דירה בת״א', CITIES).city).toBe('תל אביב-יפו');
  });

  it('prefers the longest city match over a prefix of it', () => {
    expect(parseQuery('3 חדרים בקריית ביאליק', CITIES).city).toBe('קריית ביאליק');
  });

  it('reads a bare number under 100 as millions', () => {
    expect(parseQuery('עד 3.5', CITIES).priceMax).toBe(3_500_000);
  });

  it('infers rent from a budget in the thousands', () => {
    expect(parseQuery('סטודיו עד 6000', CITIES)).toMatchObject({ deal: 'rent', assetType: 'studio' });
  });

  it('infers a purchase from a budget in the millions', () => {
    expect(parseQuery('יחידת דיור עד 1.3 מיליון', CITIES)).toMatchObject({
      deal: 'sale',
      assetType: 'housingUnit',
      priceMax: 1_300_000,
    });
  });

  it('does not override an explicit rental request with the budget heuristic', () => {
    expect(parseQuery('להשכרה עד 2 מיליון', CITIES).deal).toBe('rent');
  });

  it('parses a yield threshold and marks the search as an investor search', () => {
    const q = parseQuery('להשקעה תשואה מעל 4% עם ממ״ד', CITIES);
    expect(q.yieldMin).toBeCloseTo(0.04, 6);
    expect(q.investor).toBe(true);
    expect(q.features).toContain('mamad');
  });

  it('parses fractional rooms', () => {
    expect(parseQuery('3.5 חדרים', CITIES).roomsMin).toBe(3.5);
  });

  it('returns an empty intent for empty input', () => {
    expect(parseQuery('   ', CITIES)).toEqual({});
  });
});
