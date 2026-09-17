/** How a gush/helka was arrived at, which decides how much the user should trust it. */
export type ParcelConfidence =
  /** An exact address match against a building already in the index. */
  | 'exact'
  /** Same street and city, different house number — the parcel is a neighbour's, not necessarily this one's. */
  | 'street'
  /** Returned by an official geocoder. */
  | 'official'
  /** Nothing found. */
  | 'none';

export interface ParcelResolution {
  gush: number | null;
  helka: number | null;
  confidence: ParcelConfidence;
  sourceId: string;
  /** The address as the resolver understood it, so the user can see what was searched. */
  matchedAddress: string | null;
  /** Other buildings that matched less well, for a user to choose from. */
  alternatives: Array<{ gush: number; helka: number; address: string }>;
  note?: string;
}

export interface ParcelResolver {
  readonly id: string;
  readonly label: string;
  /** Never throws. An unreachable or ignorant resolver returns `confidence: 'none'`. */
  resolve(address: string): Promise<ParcelResolution>;
}

export function noParcel(sourceId: string, note: string): ParcelResolution {
  return {
    gush: null,
    helka: null,
    confidence: 'none',
    sourceId,
    matchedAddress: null,
    alternatives: [],
    note,
  };
}
