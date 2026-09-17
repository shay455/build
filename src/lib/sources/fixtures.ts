import { summarise, unavailable, type MarketSource, type MarketSnapshot, type ParcelRef } from './types';
import { SEED_PROPERTIES } from '@/lib/seed-data';
import type { Comparable } from '@/types/property';

/**
 * Offline stand-in for the transaction database, so the enrichment pipeline is
 * exercisable without network access. It serves the comparables carried by the
 * seed inventory and nothing else — it never synthesises a transaction, so a
 * parcel it does not know returns `unavailable` exactly as a live miss would.
 */
export class FixtureSource implements MarketSource {
  readonly id = 'fixture';
  readonly label = 'נתוני דוגמה מקומיים';

  private readonly byParcel: Map<string, Comparable[]>;

  constructor(seed: readonly { gush: number; helka: number; comparables: Comparable[] }[] = SEED_PROPERTIES) {
    this.byParcel = new Map();
    for (const p of seed) {
      if (p.comparables.length > 0) this.byParcel.set(`${p.gush}-${p.helka}`, p.comparables);
    }
  }

  async fetchByParcel(ref: ParcelRef): Promise<MarketSnapshot> {
    const hit = this.byParcel.get(`${ref.gush}-${ref.helka}`);
    if (!hit) {
      return unavailable(this.id, `אין עסקאות במאגר הדוגמה לגוש ${ref.gush} חלקה ${ref.helka}`);
    }
    return summarise(hit, this.id, 'נתוני דוגמה — לא נשלפו ממקור רשמי');
  }
}
