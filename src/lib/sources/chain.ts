import { noParcel, type ParcelResolution, type ParcelResolver } from './parcel-types';

/**
 * Tries resolvers in order and returns the first confident answer, keeping the
 * best weak answer as a fallback. Pure and dependency-free so it stays testable
 * outside a server runtime.
 */
export class ChainResolver implements ParcelResolver {
  readonly id = 'chain';
  readonly label = 'שרשרת מקורות';

  constructor(private readonly links: readonly ParcelResolver[]) {}

  async resolve(address: string): Promise<ParcelResolution> {
    let fallback: ParcelResolution | null = null;
    const notes: string[] = [];

    for (const link of this.links) {
      const r = await link.resolve(address);
      if (r.confidence === 'exact' || r.confidence === 'official') return r;
      if (r.confidence === 'street' && !fallback) fallback = r;
      if (r.note) notes.push(`${link.label}: ${r.note}`);
    }

    if (fallback) return fallback;
    return noParcel(this.id, notes.join(' · ') || 'לא נמצאה התאמה באף מקור');
  }
}
