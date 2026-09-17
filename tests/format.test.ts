import { describe, expect, it } from 'vitest';
import { pct, ratePct, shekel, shortShekel, signedPct } from '@/lib/format';

describe('shekel', () => {
  it('groups thousands', () => {
    expect(shekel(3_150_000)).toBe('₪3,150,000');
  });

  it('puts the sign outside the currency symbol', () => {
    // "₪-6,704" leaves the minus adrift from the number in an RTL line.
    expect(shekel(-6704)).toBe('-₪6,704');
  });

  it('rounds rather than truncating', () => {
    expect(shekel(1999.6)).toBe('₪2,000');
    expect(shekel(0)).toBe('₪0');
  });
});

describe('shortShekel', () => {
  it('abbreviates millions and thousands', () => {
    expect(shortShekel(3_000_000)).toBe('₪3M');
    expect(shortShekel(3_150_000)).toBe('₪3.15M');
    expect(shortShekel(240_000)).toBe('₪240K');
  });

  it('keeps small amounts exact', () => {
    expect(shortShekel(640)).toBe('₪640');
  });

  it('handles negatives', () => {
    expect(shortShekel(-240_000)).toBe('-₪240K');
  });
});

describe('percentages', () => {
  it('formats to one decimal by default', () => {
    expect(pct(0.0437)).toBe('4.4%');
    expect(pct(0.0437, 2)).toBe('4.37%');
  });

  it('drops a trailing zero on a bracket rate', () => {
    expect(ratePct(0.08)).toBe('8%');
    expect(ratePct(0.035)).toBe('3.5%');
    expect(ratePct(0.005)).toBe('0.5%');
    expect(ratePct(0)).toBe('0%');
  });

  it('marks a positive delta with a sign', () => {
    expect(signedPct(0.09)).toBe('+9%');
    expect(signedPct(-0.12)).toBe('-12%');
    expect(signedPct(0)).toBe('0%');
  });
});
