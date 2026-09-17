import { describe, expect, it } from 'vitest';
import { purchaseTax, TAX_AMOUNTS } from '@/lib/tax';

describe('purchase tax — single home', () => {
  it('matches the worked example: 2.5M first apartment', () => {
    // 0% to 1,978,745 + 3.5% on 368,295 + 5% on 152,960
    const r = purchaseTax(2_500_000, 'single');
    expect(Math.round(r.amount)).toBe(20_538);
    expect(r.effectiveRate).toBeCloseTo(0.0082, 4);
  });

  it('charges nothing below the 0% ceiling', () => {
    expect(purchaseTax(TAX_AMOUNTS.A, 'single').amount).toBe(0);
    expect(purchaseTax(1_500_000, 'single').amount).toBe(0);
  });

  it('reaches the 10% band only above 20,183,565', () => {
    const under = purchaseTax(TAX_AMOUNTS.D, 'single');
    expect(under.brackets.some((b) => b.rate === 0.1)).toBe(false);
    const over = purchaseTax(TAX_AMOUNTS.D + 1_000_000, 'single');
    expect(over.brackets.at(-1)).toMatchObject({ rate: 0.1, base: 1_000_000 });
  });
});

describe('purchase tax — additional home', () => {
  it('charges 8% from the first shekel, with no exemption', () => {
    expect(purchaseTax(1_000_000, 'additional').amount).toBe(80_000);
  });

  it('flags the temporary order that expires 31.12.2026', () => {
    expect(purchaseTax(2_000_000, 'additional').notes.join(' ')).toContain('2026-12-31');
  });
});

describe('purchase tax — upgrader', () => {
  it('is taxed on the single-home ladder, not 8% from the first shekel', () => {
    const upgrade = purchaseTax(3_000_000, 'upgrade');
    const single = purchaseTax(3_000_000, 'single');
    const additional = purchaseTax(3_000_000, 'additional');
    expect(upgrade.amount).toBe(single.amount);
    expect(upgrade.amount).toBeLessThan(additional.amount);
  });

  it('states the sell-within-the-window condition', () => {
    expect(purchaseTax(3_000_000, 'upgrade').notes.join(' ')).toContain('24 חודשים');
  });
});

describe('purchase tax — oleh, Regulation 12a', () => {
  it('applies the 0.5% step below the ceiling', () => {
    const r = purchaseTax(3_000_000, 'oleh');
    // 0% to 1,978,745, then 0.5% on 1,021,255
    expect(Math.round(r.amount)).toBe(5_106);
    expect(r.reliefCeilingLost).toBeUndefined();
  });

  it('loses the relief entirely above the value ceiling', () => {
    const price = 21_000_000;
    const r = purchaseTax(price, 'oleh');
    expect(r.reliefCeilingLost).toBe(true);
    // Ordinary ladder on the FULL price — not the oleh ladder with a 10% top band.
    expect(r.amount).toBe(purchaseTax(price, 'single').amount);
    expect(r.brackets.some((b) => b.rate === 0.005)).toBe(false);
  });

  it('is exactly at the ceiling, not over it, at 20,183,565', () => {
    expect(purchaseTax(TAX_AMOUNTS.D, 'oleh').reliefCeilingLost).toBeUndefined();
    expect(purchaseTax(TAX_AMOUNTS.D + 1, 'oleh').reliefCeilingLost).toBe(true);
  });
});

describe('purchase tax — Regulation 11', () => {
  it('taxes only the excess when a single home is at or under the cliff', () => {
    const r = purchaseTax(TAX_AMOUNTS.REG11_CLIFF, 'reg11');
    // 0.5% on 2,500,000 - 1,978,745
    expect(Math.round(r.amount)).toBe(2_606);
    expect(r.cliffApplied).toBeUndefined();
  });

  it('is a cliff, not a bracket edge: one shekel more taxes the whole value', () => {
    const under = purchaseTax(TAX_AMOUNTS.REG11_CLIFF, 'reg11');
    const over = purchaseTax(TAX_AMOUNTS.REG11_CLIFF + 1, 'reg11');
    expect(over.cliffApplied).toBe(true);
    expect(Math.round(over.amount)).toBe(12_500);
    expect(over.amount / under.amount).toBeGreaterThan(4.5);
  });
});

describe('purchase tax — guards', () => {
  it('rejects a negative price', () => {
    expect(() => purchaseTax(-1, 'single')).toThrow(RangeError);
  });

  it('returns a zero effective rate at zero price rather than NaN', () => {
    expect(purchaseTax(0, 'single').effectiveRate).toBe(0);
  });
});
