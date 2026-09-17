import { noParcel, type ParcelResolution, type ParcelResolver } from './parcel-types';

/**
 * Adapter for the national GIS address search (GovMap / Survey of Israel).
 *
 * STATUS: written against the documented request shape, NOT verified against the
 * live service — the build environment's network policy blocks gov.il, so this has
 * never executed a real request. Field names below are a documented first draft;
 * run it once against the real endpoint and correct `readParcel` before enabling it.
 *
 * Disabled unless PARCEL_SOURCE includes `govmap`. It never throws and never
 * guesses a parcel: anything unparseable becomes `confidence: 'none'`, which the
 * form shows as "enter it manually" rather than as a wrong gush.
 */
export const GOVMAP_ENDPOINT = process.env.GOVMAP_ENDPOINT ?? 'https://ags.govmap.gov.il/Search/SearchLocation';

const TIMEOUT_MS = Number(process.env.GOVMAP_TIMEOUT_MS ?? 8000);

interface GovMapResult {
  ResultLable?: string;
  Values?: string[];
  ObjectName?: string;
}

/** GovMap returns the parcel as a "gush-helka" style string in the result values. */
export function readParcel(result: GovMapResult): { gush: number; helka: number } | null {
  const haystack = [result.ObjectName, result.ResultLable, ...(result.Values ?? [])]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
  const m = haystack.match(/(\d{3,6})\s*[-\/]\s*(\d{1,4})/);
  if (!m) return null;
  const gush = Number(m[1]);
  const helka = Number(m[2]);
  return Number.isFinite(gush) && Number.isFinite(helka) && gush > 0 && helka > 0 ? { gush, helka } : null;
}

export class GovMapResolver implements ParcelResolver {
  readonly id = 'govmap';
  readonly label = 'GovMap — המרכז למיפוי ישראל';

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async resolve(address: string): Promise<ParcelResolution> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(GOVMAP_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyword: address, lstResult: null }),
        signal: controller.signal,
      });

      if (!res.ok) return noParcel(this.id, `GovMap החזיר סטטוס ${res.status}`);

      const json: unknown = await res.json();
      const results =
        json && typeof json === 'object' && Array.isArray((json as { data?: unknown }).data)
          ? ((json as { data: GovMapResult[] }).data)
          : [];

      const parsed = results
        .map((r) => ({ r, parcel: readParcel(r) }))
        .filter((x): x is { r: GovMapResult; parcel: { gush: number; helka: number } } => x.parcel !== null);

      if (parsed.length === 0) return noParcel(this.id, 'GovMap לא החזיר גוש וחלקה לכתובת זו');

      const [best, ...rest] = parsed;
      return {
        gush: best.parcel.gush,
        helka: best.parcel.helka,
        confidence: 'official',
        sourceId: this.id,
        matchedAddress: best.r.ResultLable ?? address,
        alternatives: rest.slice(0, 4).map((x) => ({
          gush: x.parcel.gush,
          helka: x.parcel.helka,
          address: x.r.ResultLable ?? '',
        })),
      };
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? 'הבקשה עברה את זמן ההמתנה' : 'המקור אינו זמין';
      return noParcel(this.id, `${reason} — לא אותר גוש/חלקה`);
    } finally {
      clearTimeout(timer);
    }
  }
}
