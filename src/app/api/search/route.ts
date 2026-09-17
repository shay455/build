import { NextResponse } from 'next/server';
import { listCities, listProperties } from '@/lib/db';
import { parseQuery, type SearchQuery } from '@/lib/query';
import { search, type SortKey } from '@/lib/search';
import type { BuyerProfile } from '@/types/property';

export const dynamic = 'force-dynamic';

const PROFILES = new Set<BuyerProfile>(['single', 'upgrade', 'additional', 'oleh', 'reg11']);

/**
 * Search endpoint. `q` is free Hebrew text; explicit parameters override whatever
 * the parser inferred from it, so a caller can always be unambiguous.
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const cities = await listCities();

  const parsed: SearchQuery = sp.has('q') ? parseQuery(sp.get('q') ?? '', cities) : {};
  const override = <T>(key: string, cast: (raw: string) => T): T | undefined => {
    const raw = sp.get(key);
    return raw === null || raw === '' ? undefined : cast(raw);
  };

  const query: SearchQuery = {
    ...parsed,
    deal: override('deal', (v) => (v === 'rent' ? 'rent' : 'sale')) ?? parsed.deal,
    city: override('city', String) ?? parsed.city,
    roomsMin: override('roomsMin', Number) ?? parsed.roomsMin,
    priceMin: override('priceMin', Number) ?? parsed.priceMin,
    priceMax: override('priceMax', Number) ?? parsed.priceMax,
    sqmMin: override('sqmMin', Number) ?? parsed.sqmMin,
    yieldMin: override('yieldMin', Number) ?? parsed.yieldMin,
  };

  const profileParam = sp.get('profile') as BuyerProfile | null;
  const profile: BuyerProfile = profileParam && PROFILES.has(profileParam) ? profileParam : 'single';
  const sort = (sp.get('sort') as SortKey | null) ?? 'match';

  const results = search(await listProperties(), query, profile, sort);

  return NextResponse.json({
    query,
    profile,
    count: results.length,
    cities,
    results,
    disclaimer:
      'כל הסכומים משוערים ונוצרו אוטומטית. אינם שומה, ייעוץ משפטי או חישוב מס מחייב.',
  });
}
