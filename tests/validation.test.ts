import { describe, expect, it } from 'vitest';
import { propertyInputSchema, toProperty } from '@/lib/validation';

const base = {
  deal: 'sale',
  price: '1650000',
  city: 'אשקלון',
  gush: '1234',
  helka: '55',
  assetType: 'apartment',
  rooms: '4',
  sqm: '102',
  builtYear: '2008',
};

describe('propertyInputSchema', () => {
  it('coerces a form or CSV row of strings', () => {
    const r = propertyInputSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data!.price).toBe(1_650_000);
    expect(r.data!.gush).toBe(1234);
  });

  it('reports missing required fields in Hebrew', () => {
    const r = propertyInputSchema.safeParse({ ...base, gush: undefined, helka: undefined, price: undefined });
    expect(r.success).toBe(false);
    const messages = r.error!.issues.map((i) => i.message).join(' ');
    expect(messages).toContain('גוש הוא שדה חובה');
    expect(messages).toContain('חלקה היא שדה חובה');
    expect(messages).toContain('מחיר הוא שדה חובה');
    expect(messages).not.toMatch(/expected|received|Invalid/);
  });

  it('requires an explicit split-permit status on a housing unit', () => {
    const r = propertyInputSchema.safeParse({ ...base, assetType: 'housingUnit' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(['splitPermit']);
  });

  it('accepts "unknown" as that status', () => {
    expect(propertyInputSchema.safeParse({ ...base, assetType: 'housingUnit', splitPermit: 'unknown' }).success).toBe(true);
  });

  it('requires an end date on a lease', () => {
    const r = propertyInputSchema.safeParse({ ...base, tenure: 'lease' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path[0] === 'leaseEndsAt')).toBe(true);
  });

  it('rejects a non-positive price', () => {
    expect(propertyInputSchema.safeParse({ ...base, price: '-5' }).success).toBe(false);
  });
});

describe('toProperty', () => {
  it('keys the entity on gush/helka/tat-helka so two sources for one home collide', () => {
    const a = toProperty(propertyInputSchema.parse({ ...base, tatHelka: '8', source: 'יד2' }));
    const b = toProperty(propertyInputSchema.parse({ ...base, tatHelka: '8', source: 'מדלן' }));
    expect(a.id).toBe(b.id);
    expect(a.id).toBe('1234-55-8-sale');
  });

  it('keeps a sale and a rental of the same home apart', () => {
    const sale = toProperty(propertyInputSchema.parse({ ...base, tatHelka: '8' }));
    const rent = toProperty(propertyInputSchema.parse({ ...base, tatHelka: '8', deal: 'rent', price: '5200' }));
    expect(sale.id).not.toBe(rent.id);
  });

  it('never accepts a computed figure as input', () => {
    const p = toProperty(propertyInputSchema.parse(base));
    expect(p).not.toHaveProperty('grossYield');
    expect(p).not.toHaveProperty('purchaseTax');
    expect(p.comparables).toEqual([]);
  });
});
