import { NextResponse } from 'next/server';
import { diffRun, type Alert, type SavedSearch } from '@/lib/alerts';
import { getSavedSearch, getSeen, listProperties, listSavedSearches, saveRun } from '@/lib/db';
import { search } from '@/lib/search';

export const dynamic = 'force-dynamic';

interface RunResult {
  search: SavedSearch;
  alerts: Alert[];
  matches: number;
  baselined: boolean;
}

/**
 * Run saved searches and report what changed since the last run.
 *
 * `dryRun` evaluates without recording the new baseline, so the page can be
 * refreshed without silently consuming the alerts it is about to show.
 */
export async function POST(request: Request) {
  let body: { id?: string; dryRun?: boolean } = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
  }

  const searches = body.id ? [getSavedSearch(body.id)].filter((s) => s !== null) : listSavedSearches();
  if (searches.length === 0) {
    return NextResponse.json({ error: 'לא נמצא חיפוש שמור' }, { status: 404 });
  }

  const properties = listProperties();
  const at = new Date().toISOString();
  const runs: RunResult[] = [];

  for (const saved of searches) {
    const results = search(properties, saved.query, saved.profile);
    const outcome = diffRun(saved, results, getSeen(saved.id));
    if (!body.dryRun) saveRun(saved.id, outcome.nextSeen, at);
    runs.push({
      search: { ...saved, lastRunAt: body.dryRun ? saved.lastRunAt : at },
      alerts: outcome.alerts,
      matches: Object.keys(outcome.nextSeen).length,
      baselined: outcome.baselined,
    });
  }

  return NextResponse.json({
    ranAt: at,
    dryRun: body.dryRun ?? false,
    totalAlerts: runs.reduce((n, r) => n + r.alerts.length, 0),
    runs,
  });
}
