import { NextResponse } from 'next/server';
import { parseAddress } from '@/lib/address';
import { listCities } from '@/lib/db';
import { resolveParcelResolver } from '@/lib/sources/parcel';

export const dynamic = 'force-dynamic';

/**
 * Address → gush/helka.
 *
 * Always reports how the address was understood, so a user who gets no parcel can
 * tell whether the problem was their address or the index. A weak match is labelled
 * weak rather than filled in silently.
 */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get('address')?.trim() ?? '';
  if (!address) {
    return NextResponse.json({ error: 'יש להזין כתובת' }, { status: 400 });
  }

  const parsed = parseAddress(address, await listCities());
  const resolver = await resolveParcelResolver();
  const resolution = await resolver.resolve(address);

  return NextResponse.json({
    address,
    parsed,
    resolution,
    /** What the form should do with this, stated rather than inferred client-side. */
    action:
      resolution.confidence === 'exact' || resolution.confidence === 'official'
        ? 'fill'
        : resolution.confidence === 'street'
          ? 'suggest'
          : 'manual',
  });
}
