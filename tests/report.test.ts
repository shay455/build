import { describe, expect, it } from 'vitest';
import { buildChecklist, buildReport, DISCLAIMER } from '@/lib/report';
import { evaluate } from '@/lib/search';
import { makeProperty } from './factory';
import type { BuyerProfile, Property } from '@/types/property';

const report = (over: Partial<Property> = {}, profile: BuyerProfile = 'single') =>
  buildReport(evaluate(makeProperty(over), {}, profile), profile, new Date('2026-09-17T00:00:00Z'));

const titles = (p: Partial<Property>, profile: BuyerProfile = 'single') =>
  buildChecklist(makeProperty(p), profile).map((i) => i.title);

describe('checklist severity', () => {
  it('leads with blockers, then required, then advised', () => {
    const items = buildChecklist(
      makeProperty({ assetType: 'housingUnit', splitPermit: 'unknown', caveats: 2, bettermentRisk: 'high' }),
      'single',
    );
    const rank = { blocking: 0, required: 1, advised: 2 } as const;
    const seq = items.map((i) => rank[i.severity]);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
    expect(items[0].severity).toBe('blocking');
  });
});

describe('what the record does not say produces an item', () => {
  it('blocks on a housing unit with no located split permit', () => {
    const items = buildChecklist(makeProperty({ assetType: 'housingUnit', splitPermit: 'unknown' }), 'single');
    const item = items.find((i) => i.title.includes('היתר פיצול'))!;
    expect(item.severity).toBe('blocking');
    expect(item.why).toContain('התשואה');
  });

  it('raises an unverified registry to blocking, and keeps a verified one as required', () => {
    const unverified = buildChecklist(makeProperty({ registryVerified: false }), 'single');
    const verified = buildChecklist(makeProperty({ registryVerified: true }), 'single');
    expect(unverified.find((i) => i.title.includes('נסח טאבו'))!.severity).toBe('blocking');
    expect(verified.find((i) => i.title.includes('נסח טאבו'))!.severity).toBe('required');
  });

  it('always asks for a current extract, even on a verified record', () => {
    expect(titles({ registryVerified: true })).toContain('נסח טאבו מעודכן');
  });

  it('blocks on a lease and names its end date', () => {
    const items = buildChecklist(makeProperty({ tenure: 'lease', leaseEndsAt: '2041' }), 'single');
    const item = items.find((i) => i.title.includes('חכירה'))!;
    expect(item.severity).toBe('blocking');
    expect(item.title).toContain('2041');
  });

  it('phrases a single caveat in the singular', () => {
    expect(titles({ caveats: 1 }).join(' ')).toContain('הערת האזהרה הרשומה');
    expect(titles({ caveats: 3 }).join(' ')).toContain('3 הערות האזהרה הרשומות');
  });

  it('says why the valuation needs checking, differently for each reason', () => {
    const why = (p: Partial<Property>) =>
      buildChecklist(makeProperty(p), 'single').find((i) => i.title.includes('אימות שווי'))!.why;
    expect(why({ marketStatus: 'manual' })).toContain('הוזן ידנית');
    expect(why({ marketStatus: 'thin', marketSampleSize: 2 })).toContain('2 עסקאות');
    expect(why({ marketStatus: 'unavailable' })).toContain('לא אותרו');
  });

  it('omits the valuation item once the sample is adequate', () => {
    expect(titles({ marketStatus: 'ok', marketSampleSize: 6 })).not.toContain('אימות שווי מול עסקאות השוואה');
  });
});

describe('the checklist follows the buyer profile', () => {
  it('blocks an upgrader on the statutory sale window', () => {
    const item = buildChecklist(makeProperty(), 'upgrade').find((i) => i.title.includes('חלון מכירת'))!;
    expect(item.severity).toBe('blocking');
    expect(item.why).toContain('24 חודשים');
  });

  it('warns an investor that the rates are a temporary order', () => {
    expect(titles({}, 'additional').join(' ')).toContain('תוקף שיעורי הדירה הנוספת');
  });

  it('tells an oleh and a Regulation 11 buyer that the relief is not automatic', () => {
    for (const profile of ['oleh', 'reg11'] as BuyerProfile[]) {
      expect(titles({}, profile).join(' '), profile).toContain('בקשה להקלה');
    }
  });

  it('gives a first-home buyer none of those', () => {
    const t = titles({}, 'single').join(' ');
    expect(t).not.toContain('חלון מכירת');
    expect(t).not.toContain('תוקף שיעורי');
  });

  it('checks the rental law instead of purchase tax on a rental', () => {
    const t = titles({ deal: 'rent' }).join(' ');
    expect(t).toContain('שכירות הוגנת');
    expect(t).not.toContain('הצהרת מס רכישה');
  });
});

describe('buildReport', () => {
  it('names the property and the tax track in the title block', () => {
    const r = report({ rooms: 2, neighborhood: 'מרכז' }, 'additional');
    expect(r.title).toContain('2 חדרים');
    expect(r.profileLabel).toContain('דירה נוספת');
    expect(r.generatedAt).toBe('2026-09-17');
  });

  it('carries the subtitle identity a lawyer needs', () => {
    const r = report({ gush: 6128, helka: 341, tatHelka: 3 });
    expect(r.subtitle).toContain('גוש 6128');
    expect(r.subtitle).toContain('חלקה 341/3');
  });

  it('includes tax and investment sections for a sale', () => {
    const t = report({}, 'single').sections.map((s) => s.title).join(' | ');
    expect(t).toContain('מס רכישה ועלות כניסה');
    expect(t).toContain('עלות חודשית ותשואה');
  });

  it('replaces them with rental terms for a rental', () => {
    const t = report({ deal: 'rent', price: 5000 }).sections.map((s) => s.title).join(' | ');
    expect(t).not.toContain('מס רכישה');
    expect(t).toContain('עלות חודשית');
  });

  it('states in the market section why a delta was withheld', () => {
    const s = report({ marketStatus: 'thin', marketSampleSize: 2 }).sections.find((x) => x.title.includes('שוק'))!;
    expect(s.rows.find((r) => r.label === 'פער מול האזור')!.value).toContain('מדגם של 2 עסקאות');
  });

  it('never omits the disclaimer', () => {
    expect(report().disclaimer).toBe(DISCLAIMER);
    expect(report().disclaimer).toContain('אינו שומת מקרקעין');
  });

  it('every section has at least one row', () => {
    for (const s of report().sections) expect(s.rows.length, s.title).toBeGreaterThan(0);
  });
});
