import { NextResponse } from 'next/server';
import { getProperty, listProperties, updateMarketData } from '@/lib/db';
import { getMarketSnapshot, resolveSource } from '@/lib/sources';

export const dynamic = 'force-dynamic';

interface EnrichBody {
  /** One property, or omit both to enrich the whole index. */
  id?: string;
  ids?: string[];
  /** Bypass the cache. */
  force?: boolean;
}

/**
 * Pull market data for one or more properties and write it back with provenance.
 *
 * A source that returns nothing leaves the stored figures alone and records the
 * miss on the response — overwriting a human's entry with a zero would be worse
 * than having no answer.
 */
export async function POST(request: Request) {
  let body: EnrichBody = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as EnrichBody;
  } catch {
    return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
  }

  const requested = body.id ? [body.id] : body.ids;
  const targets = requested
    ? (await Promise.all(requested.map((id) => getProperty(id)))).filter((p) => p !== null)
    : await listProperties();

  if (targets.length === 0) {
    return NextResponse.json({ error: 'לא נמצא נכס להעשרה' }, { status: 404 });
  }

  const source = resolveSource();
  const enriched: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const p of targets) {
    const snapshot = await getMarketSnapshot({ gush: p.gush, helka: p.helka, city: p.city }, source, {
      force: body.force ?? false,
    });

    if (snapshot.status === 'unavailable' || snapshot.medianPpsm === null) {
      skipped.push({ id: p.id, reason: snapshot.note ?? 'המקור לא החזיר עסקאות' });
      continue;
    }

    await updateMarketData(p.id, {
      areaMedianPpsm: Math.round(snapshot.medianPpsm),
      comparables: snapshot.comparables,
      marketAsOf: snapshot.asOf ?? p.marketAsOf,
      marketSourceId: snapshot.sourceId,
      marketStatus: snapshot.status,
      marketSampleSize: snapshot.sampleSize,
      marketFetchedAt: snapshot.fetchedAt,
    });
    enriched.push(p.id);
  }

  return NextResponse.json({
    source: { id: source.id, label: source.label },
    enriched: enriched.length,
    skipped,
    ids: enriched,
  });
}
