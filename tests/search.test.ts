import { describe, expect, it } from 'vitest';
import { search } from '@/lib/search';
import { flagsFor } from '@/lib/flags';
import { economics } from '@/lib/finance';
import { makeProperty } from './factory';
import type { Property } from '@/types/property';

const inventory: Property[] = [
  makeProperty({ id: 'cheap', city: 'חיפה', price: 1_500_000, sqm: 100, areaMedianPpsm: 20_000, expectedMonthlyRent: 5_500 }),
  makeProperty({ id: 'pricey', city: 'תל אביב-יפו', price: 4_000_000, sqm: 100, areaMedianPpsm: 38_000, expectedMonthlyRent: 8_000 }),
  makeProperty({
    id: 'split',
    city: 'רמת גן',
    assetType: 'housingUnit',
    price: 1_000_000,
    sqm: 30,
    areaMedianPpsm: 38_000,
    expectedMonthlyRent: 4_500,
    splitPermit: 'unknown',
  }),
  makeProperty({ id: 'lease', city: 'ירושלים', price: 2_000_000, tenure: 'lease', leaseEndsAt: '2041', registryKind: 'housingCompany' }),
];

describe('search', () => {
  it('filters by city and price ceiling', () => {
    const r = search(inventory, { deal: 'sale', city: 'חיפה', priceMax: 2_000_000 }, 'single');
    expect(r.map((x) => x.property.id)).toEqual(['cheap']);
  });

  it('excludes a property missing a required feature', () => {
    const noLift = makeProperty({ id: 'no-lift', features: { ...makeProperty().features, elevator: false } });
    const r = search([noLift], { deal: 'sale', features: ['elevator'] }, 'single');
    expect(r).toHaveLength(0);
  });

  it('treats a balcony requirement as balconySqm, not a feature flag', () => {
    const noBalcony = makeProperty({ id: 'flat', balconySqm: 0 });
    expect(search([noBalcony], { deal: 'sale', features: ['balcony'] }, 'single')).toHaveLength(0);
    expect(search([makeProperty({ balconySqm: 8 })], { deal: 'sale', features: ['balcony'] }, 'single')).toHaveLength(1);
  });

  it('applies a yield floor only to sale listings', () => {
    const r = search(inventory, { deal: 'sale', yieldMin: 0.04 }, 'single');
    expect(r.every((x) => x.economics.grossYield! >= 0.04)).toBe(true);
  });

  it('never hides a red-flagged property, only costs it points', () => {
    const r = search(inventory, { deal: 'sale', city: 'רמת גן' }, 'single');
    expect(r).toHaveLength(1);
    expect(r[0].flags.some((f) => f.level === 'crit')).toBe(true);
    const clean = search([makeProperty({ id: 'clean', city: 'רמת גן' })], { deal: 'sale', city: 'רמת גן' }, 'single');
    expect(r[0].score.value).toBeLessThan(clean[0].score.value);
  });

  it('sorts by price ascending when asked', () => {
    const r = search(inventory, { deal: 'sale' }, 'single', 'price-asc');
    expect(r.map((x) => x.property.price)).toEqual([...r.map((x) => x.property.price)].sort((a, b) => a - b));
  });

  it('separates sale and rent inventories', () => {
    const rent = makeProperty({ id: 'rent', deal: 'rent', price: 5000 });
    expect(search([...inventory, rent], { deal: 'rent' }, 'single').map((x) => x.property.id)).toEqual(['rent']);
  });
});

describe('flags', () => {
  it('raises a blocker for a housing unit with no located split permit', () => {
    const p = inventory[2];
    const f = flagsFor(p, economics(p, 'single'));
    expect(f[0].level).toBe('crit');
    expect(f[0].text).toContain('היתר פיצול');
  });

  it('warns on a lease and on rights held by a housing company', () => {
    const p = inventory[3];
    const texts = flagsFor(p, economics(p, 'single')).map((f) => f.text);
    expect(texts.some((t) => t.includes('חכירה עד 2041'))).toBe(true);
    expect(texts.some((t) => t.includes('חברה משכנת'))).toBe(true);
  });

  it('distinguishes an unverified registry from a clean one', () => {
    const unverified = makeProperty({ registryVerified: false });
    const verified = makeProperty({ registryVerified: true });
    const text = (p: Property) => flagsFor(p, economics(p, 'single')).map((f) => f.text).join(' ');
    expect(text(unverified)).toContain('לא אומת');
    expect(text(verified)).not.toContain('לא אומת');
  });
});
