import 'server-only';
import { ChainResolver } from './chain';
import { GazetteerResolver } from './gazetteer';
import { GovMapResolver } from './govmap';
import type { ParcelResolver } from './parcel-types';
import { listProperties } from '@/lib/db';

export * from './parcel-types';
export { ChainResolver } from './chain';
export { GazetteerResolver } from './gazetteer';
export { GovMapResolver, readParcel } from './govmap';

/**
 * `PARCEL_SOURCE` is a comma-separated order, default `gazetteer`.
 * Add `govmap` to consult the official geocoder — see the note in govmap.ts first.
 */
export async function resolveParcelResolver(): Promise<ParcelResolver> {
  const wanted = (process.env.PARCEL_SOURCE ?? 'gazetteer').split(',').map((s) => s.trim());
  const links: ParcelResolver[] = [];

  for (const name of wanted) {
    if (name === 'gazetteer') {
      const properties = await listProperties();
      links.push(
        new GazetteerResolver(
          properties.map((p) => ({ city: p.city, street: p.street, gush: p.gush, helka: p.helka })),
        ),
      );
    } else if (name === 'govmap') {
      links.push(new GovMapResolver());
    }
  }

  if (links.length === 0) links.push(new GazetteerResolver([]));
  return links.length === 1 ? links[0] : new ChainResolver(links);
}
