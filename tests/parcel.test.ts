import { describe, expect, it } from 'vitest';
import { GazetteerResolver } from '@/lib/sources/gazetteer';
import { GovMapResolver, readParcel } from '@/lib/sources/govmap';
import { ChainResolver } from '@/lib/sources/chain';
import { noParcel, type ParcelResolution, type ParcelResolver } from '@/lib/sources/parcel-types';

const ENTRIES = [
  { city: 'תל אביב-יפו', street: 'ויטל 14', gush: 7025, helka: 88 },
  { city: 'תל אביב-יפו', street: 'ויטל 16', gush: 7025, helka: 89 },
  { city: 'חיפה', street: 'חורב 22', gush: 10812, helka: 57 },
  { city: 'ראשון לציון', street: 'הרצל 55', gush: 3928, helka: 8 },
];

const gaz = new GazetteerResolver(ENTRIES);

describe('GazetteerResolver', () => {
  it('resolves an exact building, however the address is written', async () => {
    for (const written of ['ויטל 14, תל אביב-יפו', "רח' ויטל 14 ת״א", 'רחוב ויטל 14, תל אביב, דירה 3']) {
      const r = await gaz.resolve(written);
      expect(r, written).toMatchObject({ gush: 7025, helka: 88, confidence: 'exact' });
    }
  });

  it('returns a street-level match without claiming the helka', async () => {
    const r = await gaz.resolve('ויטל 99, תל אביב');
    expect(r.confidence).toBe('street');
    expect(r.gush).toBe(7025);
    expect(r.helka).toBeNull();
    expect(r.note).toContain('החלקה חייבת אימות');
  });

  it('offers the other buildings on that street as alternatives', async () => {
    const r = await gaz.resolve('ויטל 99, תל אביב');
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.alternatives[0]).toMatchObject({ gush: 7025 });
  });

  it('does not cross cities on a shared street name', async () => {
    const r = await gaz.resolve('הרצל 55, חיפה');
    expect(r.confidence).toBe('none');
  });

  it('says which half of the address was missing', async () => {
    expect((await gaz.resolve('ויטל 14')).note).toContain('לא העיר');
    expect((await gaz.resolve('תל אביב')).note).toContain('לא שם הרחוב');
    expect((await gaz.resolve('123')).note).toContain('לא זוהו עיר ורחוב');
  });

  it('is empty-safe', async () => {
    expect((await new GazetteerResolver([]).resolve('ויטל 14, תל אביב')).confidence).toBe('none');
  });
});

describe('GovMap adapter', () => {
  it('reads a gush-helka pair out of a result', () => {
    expect(readParcel({ Values: ['גוש 7025 חלקה 88'], ObjectName: '7025-88' })).toEqual({ gush: 7025, helka: 88 });
    expect(readParcel({ ResultLable: '10812/57' })).toEqual({ gush: 10812, helka: 57 });
  });

  it('returns null rather than a partial parcel', () => {
    expect(readParcel({ ResultLable: 'רחוב ויטל' })).toBeNull();
    expect(readParcel({})).toBeNull();
  });

  it('degrades to none on an error status', async () => {
    const r = await new GovMapResolver(async () => new Response('', { status: 403 })).resolve('ויטל 14');
    expect(r).toMatchObject({ confidence: 'none', gush: null });
    expect(r.note).toContain('403');
  });

  it('degrades to none when the network throws', async () => {
    const r = await new GovMapResolver(async () => {
      throw new Error('blocked');
    }).resolve('ויטל 14');
    expect(r.confidence).toBe('none');
  });

  it('parses a real-shaped payload', async () => {
    const r = await new GovMapResolver(async () =>
      Response.json({ data: [{ ResultLable: 'ויטל 14, תל אביב-יפו', Values: ['7025-88'] }] }),
    ).resolve('ויטל 14');
    expect(r).toMatchObject({ gush: 7025, helka: 88, confidence: 'official' });
  });
});

describe('ChainResolver', () => {
  const stub = (id: string, out: ParcelResolution): ParcelResolver => ({
    id,
    label: id,
    resolve: async () => out,
  });

  it('returns the first confident answer and stops', async () => {
    let called = 0;
    const second: ParcelResolver = {
      id: 'second',
      label: 'second',
      resolve: async () => {
        called++;
        return noParcel('second', 'x');
      },
    };
    const chain = new ChainResolver([
      stub('first', { gush: 1, helka: 2, confidence: 'exact', sourceId: 'first', matchedAddress: null, alternatives: [] }),
      second,
    ]);
    expect((await chain.resolve('x')).gush).toBe(1);
    expect(called).toBe(0);
  });

  it('prefers a later official answer over an earlier street-level one', async () => {
    const chain = new ChainResolver([
      stub('gaz', { gush: 7025, helka: null, confidence: 'street', sourceId: 'gaz', matchedAddress: null, alternatives: [] }),
      stub('gov', { gush: 9, helka: 9, confidence: 'official', sourceId: 'gov', matchedAddress: null, alternatives: [] }),
    ]);
    expect(await chain.resolve('x')).toMatchObject({ gush: 9, helka: 9, confidence: 'official' });
  });

  it('falls back to the weak answer when nothing better arrives', async () => {
    const chain = new ChainResolver([
      stub('gaz', { gush: 7025, helka: null, confidence: 'street', sourceId: 'gaz', matchedAddress: null, alternatives: [] }),
      stub('gov', noParcel('gov', 'blocked')),
    ]);
    expect(await chain.resolve('x')).toMatchObject({ confidence: 'street', gush: 7025 });
  });

  it('collects the reasons when every link fails', async () => {
    const chain = new ChainResolver([stub('a', noParcel('a', 'סיבה א')), stub('b', noParcel('b', 'סיבה ב'))]);
    const r = await chain.resolve('x');
    expect(r.confidence).toBe('none');
    expect(r.note).toContain('סיבה א');
    expect(r.note).toContain('סיבה ב');
  });
});
