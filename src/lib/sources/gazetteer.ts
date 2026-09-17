import { addressKey, addressKeyFromStored, canonical, parseAddress } from '@/lib/address';
import { noParcel, type ParcelResolution, type ParcelResolver } from './parcel-types';

export interface GazetteerEntry {
  city: string;
  street: string;
  gush: number;
  helka: number;
}

/**
 * Resolves an address from buildings already in the index.
 *
 * This covers the common case without any network: every apartment in one building
 * shares its gush and helka, so once any unit at an address is indexed, the next
 * one resolves. It is deliberately conservative — a street-level match is returned
 * as a weaker `street` confidence rather than passed off as the building's own parcel.
 */
export class GazetteerResolver implements ParcelResolver {
  readonly id = 'gazetteer';
  readonly label = 'מאגר הנכסים המקומי';

  private readonly byAddress = new Map<string, GazetteerEntry>();
  private readonly byStreet = new Map<string, GazetteerEntry[]>();
  private readonly cities: string[];

  constructor(entries: readonly GazetteerEntry[]) {
    const cities = new Set<string>();
    for (const e of entries) {
      cities.add(e.city);
      this.byAddress.set(addressKeyFromStored(e.city, e.street), e);

      const parsed = parseAddress(e.street);
      const streetKey = `${canonical(e.city)}|${parsed.street}`;
      const list = this.byStreet.get(streetKey);
      if (list) list.push(e);
      else this.byStreet.set(streetKey, [e]);
    }
    this.cities = [...cities];
  }

  async resolve(address: string): Promise<ParcelResolution> {
    const parsed = parseAddress(address, this.cities);
    // Say which half is missing: "add the city" is actionable, "unrecognised" is not.
    if (!parsed.street && !parsed.city) {
      return noParcel(this.id, 'לא זוהו עיר ורחוב בכתובת');
    }
    if (!parsed.city) {
      return noParcel(this.id, `זוהה הרחוב "${parsed.street}" אך לא העיר — יש להוסיף שם עיר`);
    }
    if (!parsed.street) {
      return noParcel(this.id, `זוהתה העיר ${parsed.city} אך לא שם הרחוב`);
    }

    const exact = this.byAddress.get(addressKey(parsed.city, parsed.street, parsed.houseNumber));
    if (exact) {
      return {
        gush: exact.gush,
        helka: exact.helka,
        confidence: 'exact',
        sourceId: this.id,
        matchedAddress: `${exact.street}, ${exact.city}`,
        alternatives: [],
        note: 'נמצאה התאמה מדויקת לבניין שכבר קיים במאגר',
      };
    }

    const onStreet = this.byStreet.get(`${canonical(parsed.city)}|${parsed.street}`) ?? [];
    if (onStreet.length > 0) {
      const [first, ...rest] = onStreet;
      return {
        gush: first.gush,
        helka: null, // Same street, different building: the helka is not this one's.
        confidence: 'street',
        sourceId: this.id,
        matchedAddress: `${first.street}, ${first.city}`,
        alternatives: rest.slice(0, 4).map((e) => ({
          gush: e.gush,
          helka: e.helka,
          address: `${e.street}, ${e.city}`,
        })),
        note: 'נמצא רק אותו רחוב, לא אותו מספר בית. הגוש סביר, החלקה חייבת אימות.',
      };
    }

    return noParcel(this.id, `לא נמצא בניין ב${parsed.street}, ${parsed.city} במאגר המקומי`);
  }
}
