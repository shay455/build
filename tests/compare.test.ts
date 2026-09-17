import { describe, expect, it } from 'vitest';
import { buildComparison, pickBest, type CompareCell } from '@/lib/compare';
import { economics } from '@/lib/finance';
import { flagsFor } from '@/lib/flags';
import { scoreProperty } from '@/lib/scoring';
import { makeProperty } from './factory';
import type { SearchResult } from '@/lib/search';
import type { Property } from '@/types/property';

function toResult(p: Property): SearchResult {
  const e = economics(p, 'single');
  return { property: p, economics: e, score: scoreProperty(p, e, {}), flags: flagsFor(p, e) };
}

const cell = (value: number | null): CompareCell => ({ text: String(value), value });

describe('pickBest', () => {
  it('picks the smallest for a lower-is-better row', () => {
    expect(pickBest([cell(10), cell(5), cell(20)], 'lower')).toBe(1);
  });

  it('picks the largest for a higher-is-better row', () => {
    expect(pickBest([cell(10), cell(5), cell(20)], 'higher')).toBe(2);
  });

  it('declines to pick when the row has no direction', () => {
    expect(pickBest([cell(1), cell(2)], 'none')).toBeNull();
  });

  it('declines when every value is identical', () => {
    expect(pickBest([cell(7), cell(7), cell(7)], 'lower')).toBeNull();
  });

  it('declines on a tie for the winning value', () => {
    expect(pickBest([cell(5), cell(5), cell(9)], 'lower')).toBeNull();
  });

  it('still picks when a non-winning value ties', () => {
    expect(pickBest([cell(9), cell(9), cell(2)], 'lower')).toBe(2);
  });

  it('needs at least two numbers to compare', () => {
    expect(pickBest([cell(5)], 'lower')).toBeNull();
    expect(pickBest([cell(5), cell(null)], 'lower')).toBeNull();
  });

  it('never lets a null cell win', () => {
    expect(pickBest([cell(null), cell(10), cell(4)], 'lower')).toBe(2);
    expect(pickBest([cell(null), cell(10), cell(4)], 'higher')).toBe(1);
  });

  it('handles negative values, which a cashflow row produces', () => {
    expect(pickBest([cell(-500), cell(200)], 'higher')).toBe(1);
  });
});

describe('buildComparison', () => {
  const cheap = toResult(makeProperty({ id: 'a', price: 1_500_000, sqm: 100, areaMedianPpsm: 20_000, expectedMonthlyRent: 5_500 }));
  const big = toResult(makeProperty({ id: 'b', price: 2_500_000, sqm: 140, areaMedianPpsm: 20_000, expectedMonthlyRent: 6_000 }));

  const find = (title: string, label: string) => {
    const g = buildComparison([cheap, big]).find((x) => x.title === title)!;
    return g.rows.find((r) => r.label === label)!;
  };

  it('returns nothing for an empty selection', () => {
    expect(buildComparison([])).toEqual([]);
  });

  it('marks the cheaper property as best on price', () => {
    expect(find('מחיר', 'מחיר').bestIndex).toBe(0);
  });

  it('marks the larger property as best on floor area', () => {
    expect(find('הנכס', 'שטח בנוי').bestIndex).toBe(1);
  });

  it('gives every row one cell per property', () => {
    for (const group of buildComparison([cheap, big])) {
      for (const r of group.rows) expect(r.cells, `${group.title}/${r.label}`).toHaveLength(2);
    }
  });

  it('shows investment and entry-cost groups for sales', () => {
    const titles = buildComparison([cheap, big]).map((g) => g.title);
    expect(titles).toContain('עלות כניסה');
    expect(titles).toContain('השקעה');
  });

  it('omits those groups for rentals and prices per month instead', () => {
    const r1 = toResult(makeProperty({ id: 'r1', deal: 'rent', price: 5_000, areaMedianRent: 5_500 }));
    const r2 = toResult(makeProperty({ id: 'r2', deal: 'rent', price: 6_200, areaMedianRent: 5_500 }));
    const groups = buildComparison([r1, r2]);
    const titles = groups.map((g) => g.title);
    expect(titles).not.toContain('עלות כניסה');
    expect(titles).not.toContain('השקעה');
    expect(groups.find((g) => g.title === 'שכר דירה')!.rows[0].label).toBe('שכר דירה לחודש');
  });

  it('refuses to declare a winner across a mixed sale-and-rent selection', () => {
    const sale = toResult(makeProperty({ id: 's', price: 2_000_000 }));
    const rent = toResult(makeProperty({ id: 'r', deal: 'rent', price: 5_000 }));
    const groups = buildComparison([sale, rent]);
    const priceGroup = groups.find((g) => g.title.startsWith('מחיר'))!;
    expect(priceGroup.title).toContain('לא ניתן להשוואה');
    expect(priceGroup.rows[0].bestIndex).toBeNull();
    expect(groups.find((g) => g.title === 'עלות חודשית')!.rows.at(-1)!.bestIndex).toBeNull();
  });

  it('does not rank days on market, which cuts both ways', () => {
    const row = find('מקור ומטא', 'ימים בשוק');
    expect(row.direction).toBe('none');
    expect(row.bestIndex).toBeNull();
    expect(row.note).toBeTruthy();
  });

  it('reports a thin sample in the delta row instead of a number', () => {
    const thin = toResult(makeProperty({ id: 't', price: 2_000_000, sqm: 100, areaMedianPpsm: 25_000, marketStatus: 'thin', marketSampleSize: 2 }));
    const ok = toResult(makeProperty({ id: 'o', price: 2_000_000, sqm: 100, areaMedianPpsm: 25_000, marketStatus: 'ok', marketSampleSize: 6 }));
    const group = buildComparison([thin, ok]).find((g) => g.title === 'מחיר')!;
    const row = group.rows.find((r) => r.label === 'פער מול חציון האזור')!;
    expect(row.cells[0].text).toContain('מדגם קטן');
    expect(row.cells[0].value).toBeNull();
    expect(row.bestIndex).toBeNull();
  });

  it('prefers fewer red flags', () => {
    const clean = toResult(makeProperty({ id: 'c' }));
    const flagged = toResult(makeProperty({ id: 'f', assetType: 'housingUnit', splitPermit: 'unknown' }));
    const row = buildComparison([clean, flagged]).find((g) => g.title === 'מקור ומטא')!.rows[0];
    expect(row.label).toBe('דגלים אדומים');
    expect(row.bestIndex).toBe(0);
  });

  it('works with a single property without inventing winners', () => {
    for (const group of buildComparison([cheap])) {
      for (const r of group.rows) expect(r.bestIndex, `${group.title}/${r.label}`).toBeNull();
    }
  });
});
