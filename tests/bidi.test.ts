import { describe, expect, it } from 'vitest';
import { forPdf } from '@/lib/bidi';

/**
 * `forPdf` compensates for fontkit's incomplete bidi, so its output looks wrong in
 * isolation — that is the point. The assertions below state what the compensation
 * must do; that the compensation produces a correct PAGE was established by
 * rendering to an image and reading it, which no text extractor can confirm
 * because each applies its own bidi pass.
 */
describe('forPdf', () => {
  it('leaves text with no Hebrew untouched', () => {
    // fontkit does not reorder these, so correcting them is what turns a tax
    // bracket label "0–1,978,745" into "0–547,879,1".
    for (const s of ['0–1,978,745 · 0%', '1,978,746–2,347,040 · 3.5%', '₪12,890', 'nadlan.gov.il']) {
      expect(forPdf(s), s).toBe(s);
    }
  });

  it('pre-reverses a digit run when Hebrew is present, so fontkit restores it', () => {
    expect(forPdf('גוש 6128')).toContain('8216');
    expect(forPdf('שנת בנייה 1969')).toContain('9691');
  });

  it('pre-reverses a grouped amount as one run', () => {
    expect(forPdf('מס רכישה ₪1,190,000')).toContain('000,091,1');
  });

  it('keeps a slashed parcel and a dated value as single runs', () => {
    expect(forPdf('חלקה 341/3')).toContain('3/143');
    expect(forPdf('נבדק 2026-09-17')).toContain('71-90-6202');
  });

  it('pre-reverses a Latin run in Hebrew text', () => {
    expect(forPdf('מקור: nadlan.gov.il')).toContain('li.vog.naldan');
  });

  it('mirrors brackets that sit in the Hebrew part', () => {
    expect(forPdf('אין ממ״ד (בניין משנת 1969)')).toContain(')');
    expect(forPdf('(תשואה)')).toBe(')תשואה(');
    expect(forPdf('[חוסם] בדיקה')).toBe(']חוסם[ בדיקה');
  });

  it('carries a trailing percent sign with its number', () => {
    expect(forPdf('תשואה 4.64%')).toContain('%46.4');
  });

  it('keeps two percentages joined by a slash as one run', () => {
    // Were they split into two runs, fontkit's reversal would swap them and
    // "8%/10%" would render as "10%/8%" — the rates of two different tax tracks,
    // exchanged. Verified on the rendered page, not by a round trip: a percent
    // sign that has moved to the front of a run is no longer part of one.
    expect(forPdf('שיעורי 8%/10%')).toBe('שיעורי %01/%8');
  });

  it('preserves length, so nothing is dropped or duplicated', () => {
    for (const s of [
      'ירד ב־₪60,000 (9.0%) מאז הפרסום',
      'קומה 5 מתוך 8 · 34 מ״ר · 2 חדרים',
      '[חוסם] חלון מכירת הדירה הקיימת (24 חודשים)',
    ]) {
      expect(Array.from(forPdf(s)).length, s).toBe(Array.from(s).length);
    }
  });

  it('applying it twice restores the input, which is what fontkit does to the output', () => {
    for (const s of ['גוש 6128 חלקה 341/3', 'אין ממ״ד (בניין משנת 1969).', 'קומה 5 מתוך 8 · 34 מ״ר']) {
      expect(forPdf(forPdf(s)), s).toBe(s);
    }
  });

  it('does not round-trip a percent sign, and does not need to', () => {
    // A run must start with a digit or letter, so once "%" has moved to the front
    // it is outside the run and a second pass cannot put it back. That matters only
    // to this round-trip property, never to output: the transform runs exactly once
    // per string, and the rendered page was checked by eye.
    expect(forPdf('תשואה 4.64%')).toBe('תשואה %46.4');
    expect(forPdf(forPdf('תשואה 4.64%'))).toBe('תשואה %4.64');
  });

  it('is a no-op on an empty string', () => {
    expect(forPdf('')).toBe('');
  });
});
