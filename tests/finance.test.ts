import { describe, expect, it } from 'vitest';
import { LTV_CAP, economics, monthlyPayment } from '@/lib/finance';
import { makeProperty } from './factory';

describe('mortgage', () => {
  it('computes a level payment', () => {
    // 1,000,000 at 4.9% over 25 years
    expect(Math.round(monthlyPayment(1_000_000))).toBe(5_788);
  });

  it('returns zero for a non-positive principal', () => {
    expect(monthlyPayment(0)).toBe(0);
    expect(monthlyPayment(-5)).toBe(0);
  });

  it('handles a zero-rate loan without dividing by zero', () => {
    expect(monthlyPayment(120_000, { annualRate: 0, years: 10 })).toBe(1000);
  });
});

describe('economics — sale', () => {
  const p = makeProperty({ price: 2_000_000, sqm: 100, areaMedianPpsm: 25_000, expectedMonthlyRent: 6_000 });

  it('prices per sqm and against the area median', () => {
    const e = economics(p, 'single');
    expect(e.ppsm).toBe(20_000);
    expect(e.deltaVsArea).toBeCloseTo(-0.2, 5);
  });

  it('applies the Bank of Israel LTV cap per profile', () => {
    expect(economics(p, 'single').ltv).toBe(LTV_CAP.single);
    expect(economics(p, 'additional').ltv).toBe(0.5);
    expect(economics(p, 'upgrade').ltv).toBe(0.7);
  });

  it('requires more equity from an investor than from a first-home buyer', () => {
    const first = economics(p, 'single').equityRequired!;
    const investor = economics(p, 'additional').equityRequired!;
    expect(investor).toBeGreaterThan(first);
  });

  it('divides net yield by total acquisition cost, not by price', () => {
    const e = economics(p, 'additional');
    expect(e.grossYield).toBeCloseTo((6000 * 12) / 2_000_000, 6);
    expect(e.netYield!).toBeLessThan(e.grossYield!);
    // Acquisition includes purchase tax and closing costs, so it exceeds the price.
    expect(e.acquisitionTotal!).toBeGreaterThan(p.price);
  });

  it('charges no agent fee on a private listing', () => {
    const priv = economics(makeProperty({ publisherKind: 'private' }), 'single');
    expect(priv.closing!.agent).toBe(0);
  });
});

describe('economics — rent', () => {
  const r = makeProperty({
    deal: 'rent',
    price: 5_000,
    areaMedianRent: 5_500,
    arnona: 400,
    vaad: 200,
    utilities: 300,
    depositMonths: 2,
  });

  it('sums the full monthly cost, not just the rent', () => {
    const e = economics(r, 'single');
    expect(e.monthlyAllIn).toBe(5_900);
  });

  it('benchmarks against area rent and computes the deposit', () => {
    const e = economics(r, 'single');
    expect(e.deltaVsArea).toBeCloseTo(-0.0909, 4);
    expect(e.deposit).toBe(10_000);
    expect(e.tax).toBeUndefined();
  });
});
