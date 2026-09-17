import { describe, expect, it } from 'vitest';
import { FixtureSource } from '@/lib/sources/fixtures';
import { NadlanSource, parseDeals } from '@/lib/sources/nadlan';
import { summarise, THIN_SAMPLE_THRESHOLD, unavailable } from '@/lib/sources/types';
import { economics } from '@/lib/finance';
import { makeProperty } from './factory';
import type { Comparable } from '@/types/property';

const comps = (n: number): Comparable[] =>
  Array.from({ length: n }, (_, i) => ({ date: `0${i + 1}/2026`, sqm: 100, price: 2_000_000 + i * 100_000 }));

describe('summarise', () => {
  it('takes the median price per sqm, not the mean', () => {
    const s = summarise(
      [
        { date: '01/2026', sqm: 100, price: 1_000_000 },
        { date: '02/2026', sqm: 100, price: 2_000_000 },
        { date: '03/2026', sqm: 100, price: 9_000_000 },
      ],
      'test',
    );
    expect(s.medianPpsm).toBe(20_000);
  });

  it('averages the two middle values on an even sample', () => {
    const s = summarise(
      [
        { date: '01/2026', sqm: 100, price: 1_000_000 },
        { date: '02/2026', sqm: 100, price: 2_000_000 },
        { date: '03/2026', sqm: 100, price: 3_000_000 },
        { date: '04/2026', sqm: 100, price: 4_000_000 },
      ],
      'test',
    );
    expect(s.medianPpsm).toBe(25_000);
  });

  it('marks a sample below the threshold as thin', () => {
    expect(summarise(comps(THIN_SAMPLE_THRESHOLD - 1), 'test').status).toBe('thin');
    expect(summarise(comps(THIN_SAMPLE_THRESHOLD), 'test').status).toBe('ok');
  });

  it('reports the newest transaction as asOf', () => {
    const s = summarise(
      [
        { date: '03/2025', sqm: 80, price: 1_000_000 },
        { date: '11/2026', sqm: 80, price: 1_200_000 },
        { date: '07/2026', sqm: 80, price: 1_100_000 },
      ],
      'test',
    );
    expect(s.asOf).toBe('11/2026');
  });

  it('returns unavailable rather than a zero median for no comparables', () => {
    const s = summarise([], 'test');
    expect(s.status).toBe('unavailable');
    expect(s.medianPpsm).toBeNull();
  });
});

describe('nadlan adapter', () => {
  it('parses dotted dates, separated amounts and sizes', () => {
    expect(parseDeals([{ DEALDATE: '15.03.2026', DEALAMOUNT: '3,150,000', DEALNATURE: '72' }])).toEqual([
      { date: '03/2026', sqm: 72, price: 3_150_000 },
    ]);
  });

  it('parses ISO dates too', () => {
    expect(parseDeals([{ DEALDATE: '2026-03-15', DEALAMOUNT: '1000000', DEALNATURE: '50' }])[0].date).toBe('03/2026');
  });

  it('drops a deal missing any of date, price or size instead of guessing', () => {
    expect(
      parseDeals([
        { DEALDATE: '15.03.2026', DEALAMOUNT: '3150000' },
        { DEALAMOUNT: '3150000', DEALNATURE: '72' },
        { DEALDATE: '15.03.2026', DEALNATURE: '72' },
        { DEALDATE: '15.03.2026', DEALAMOUNT: '0', DEALNATURE: '72' },
      ]),
    ).toEqual([]);
  });

  it('returns unavailable on a non-OK response, never throws', async () => {
    const src = new NadlanSource(async () => new Response('nope', { status: 503 }));
    const s = await src.fetchByParcel({ gush: 1, helka: 2 });
    expect(s.status).toBe('unavailable');
    expect(s.note).toContain('503');
  });

  it('returns unavailable when the network fails', async () => {
    const src = new NadlanSource(async () => {
      throw new Error('ECONNREFUSED');
    });
    const s = await src.fetchByParcel({ gush: 1, helka: 2 });
    expect(s.status).toBe('unavailable');
    expect(s.medianPpsm).toBeNull();
  });

  it('survives a well-formed response with an unexpected body shape', async () => {
    const src = new NadlanSource(async () => Response.json({ Unexpected: true }));
    expect((await src.fetchByParcel({ gush: 1, helka: 2 })).status).toBe('unavailable');
  });

  it('summarises a real-shaped payload', async () => {
    const src = new NadlanSource(async () =>
      Response.json({
        AllResults: [
          { DEALDATE: '01.08.2026', DEALAMOUNT: '2,120,000', DEALNATURE: '115' },
          { DEALDATE: '12.04.2026', DEALAMOUNT: '2,240,000', DEALNATURE: '120' },
          { DEALDATE: '09.01.2026', DEALAMOUNT: '1,950,000', DEALNATURE: '108' },
        ],
      }),
    );
    const s = await src.fetchByParcel({ gush: 10812, helka: 57 });
    expect(s.status).toBe('ok');
    expect(s.sampleSize).toBe(3);
    expect(s.asOf).toBe('08/2026');
    expect(Math.round(s.medianPpsm!)).toBe(18_435);
  });
});

describe('fixture source', () => {
  const src = new FixtureSource([
    { gush: 10812, helka: 57, comparables: comps(3) },
    { gush: 1, helka: 1, comparables: [] },
  ]);

  it('serves comparables it knows', async () => {
    const s = await src.fetchByParcel({ gush: 10812, helka: 57 });
    expect(s.status).toBe('ok');
    expect(s.sourceId).toBe('fixture');
  });

  it('reports a miss instead of inventing transactions', async () => {
    const s = await src.fetchByParcel({ gush: 9999, helka: 1 });
    expect(s.status).toBe('unavailable');
    expect(s.comparables).toEqual([]);
  });
});

describe('sample quality gates the quoted delta', () => {
  const base = { price: 2_000_000, sqm: 100, areaMedianPpsm: 25_000 };

  it('quotes a percentage on an adequate sample', () => {
    const e = economics(makeProperty({ ...base, marketStatus: 'ok', marketSampleSize: 5 }), 'single');
    expect(e.deltaVsArea).toBeCloseTo(-0.2, 5);
    expect(e.comparableBasis).toBe('ok');
  });

  it('withholds the percentage on a thin sample', () => {
    const e = economics(makeProperty({ ...base, marketStatus: 'thin', marketSampleSize: 2 }), 'single');
    expect(e.deltaVsArea).toBeNull();
    expect(e.comparableBasis).toBe('thin');
  });

  it('withholds it when the source had nothing', () => {
    const e = economics(makeProperty({ ...base, marketStatus: 'unavailable' }), 'single');
    expect(e.deltaVsArea).toBeNull();
  });

  it('reports no basis when there is no area median at all', () => {
    const e = economics(makeProperty({ ...base, areaMedianPpsm: 0, marketStatus: 'ok' }), 'single');
    expect(e.comparableBasis).toBe('unavailable');
    expect(e.deltaVsArea).toBeNull();
  });

  it('still trusts a manually entered median', () => {
    const e = economics(makeProperty({ ...base, marketStatus: 'manual' }), 'single');
    expect(e.deltaVsArea).toBeCloseTo(-0.2, 5);
  });
});

describe('unavailable()', () => {
  it('carries the reason so the UI can explain itself', () => {
    const s = unavailable('nadlan', 'החיבור נכשל');
    expect(s).toMatchObject({ status: 'unavailable', sourceId: 'nadlan', note: 'החיבור נכשל', sampleSize: 0 });
  });
});
