'use client';

import { useCallback, useEffect, useState } from 'react';
import { ASSET_TYPE_LABEL, FEATURE_LABEL, type FeatureKey } from '@/lib/query';
import { shekel } from '@/lib/format';
import type { Alert, AlertKind, SavedSearch } from '@/lib/alerts';

interface Run {
  search: SavedSearch;
  alerts: Alert[];
  matches: number;
  baselined: boolean;
}

const KIND_LABEL: Record<AlertKind, string> = {
  'price-drop': 'ירידת מחיר',
  new: 'נכס חדש',
  'score-up': 'התאמה עלתה',
};

const KIND_TONE: Record<AlertKind, string> = {
  'price-drop': 'bg-good-soft text-good',
  new: 'bg-accent-soft text-accent-ink',
  'score-up': 'bg-warn-soft text-warn',
};

const PROFILE_LABEL: Record<string, string> = {
  single: 'דירה יחידה',
  upgrade: 'משפר דיור',
  additional: 'דירה נוספת',
  oleh: 'עולה חדש',
  reg11: 'תקנה 11',
};

/** The saved query, written back out as the sentence a person would have typed. */
function describeQuery(q: SavedSearch['query']): string {
  const parts: string[] = [q.deal === 'rent' ? 'שכירות' : 'מכירה'];
  if (q.assetType) parts.push(ASSET_TYPE_LABEL[q.assetType]);
  if (q.roomsMin) parts.push(`${q.roomsMin}+ חדרים`);
  if (q.city) parts.push(q.city);
  if (q.priceMax) parts.push(`עד ${shekel(q.priceMax)}`);
  if (q.sqmMin) parts.push(`מ־${q.sqmMin} מ״ר`);
  if (q.yieldMin) parts.push(`תשואה ${(q.yieldMin * 100).toFixed(1)}%+`);
  for (const f of q.features ?? []) parts.push(FEATURE_LABEL[f as FeatureKey] ?? f);
  return parts.join(' · ');
}

export function AlertsBoard() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ranAt, setRanAt] = useState<string | null>(null);

  const load = useCallback(async (commit: boolean) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/searches/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun: !commit }),
      });
      if (res.status === 404) {
        setRuns([]);
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'הבדיקה נכשלה');
        return;
      }
      setRuns(json.runs as Run[]);
      if (commit) setRanAt(json.ranAt as string);
    } catch {
      setError('לא הצלחנו להריץ את החיפושים השמורים.');
    } finally {
      setLoading(false);
    }
  }, []);

  // A page load must not consume the alerts it is showing, so it previews.
  useEffect(() => {
    void load(false);
  }, [load]);

  async function remove(id: string) {
    await fetch(`/api/searches?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    void load(false);
  }

  if (loading && runs.length === 0) return <p className="text-sm text-muted">טוען…</p>;
  if (error) return <p className="rounded-lg bg-crit-soft px-4 py-3 text-sm font-semibold text-crit">{error}</p>;

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface p-6 text-center">
        <p className="text-[15px] font-semibold">אין עדיין חיפושים שמורים</p>
        <p className="mt-1 text-sm text-muted">
          במסך החיפוש, אחרי שהגדרתם מה אתם מחפשים, לחצו „שמירת החיפוש”. מכאן תוכלו לבדוק מה השתנה.
        </p>
      </div>
    );
  }

  const total = runs.reduce((n, r) => n + r.alerts.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          {loading ? 'בודק…' : 'בדיקה וסימון כנקרא'}
        </button>
        <p className="text-xs text-muted">
          {total === 0 ? 'אין שינויים מאז הבדיקה האחרונה.' : `${total} שינויים ממתינים.`}
          {ranAt && ` נבדק ${new Date(ranAt).toLocaleString('he-IL')}.`}
          {' '}
          תצוגה מקדימה אינה מסמנת כנקרא.
        </p>
      </div>

      {runs.map((run) => (
        <section key={run.search.id} className="overflow-hidden rounded-xl border border-line bg-surface">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-2 bg-surface-2 px-4 py-2.5">
            <div>
              <h2 className="font-display text-base font-bold">{run.search.name}</h2>
              <p className="text-xs text-muted">
                {describeQuery(run.search.query)} · {PROFILE_LABEL[run.search.profile] ?? run.search.profile} · סף ציון{' '}
                {run.search.minScore}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted">{run.matches} נכסים עונים</span>
              <button
                type="button"
                onClick={() => void remove(run.search.id)}
                className="text-xs font-semibold text-muted underline hover:text-crit"
              >
                מחיקה
              </button>
            </div>
          </header>

          {run.baselined ? (
            <p className="px-4 py-3 text-sm text-muted">
              בדיקה ראשונה — נרשם מצב הפתיחה. מכאן והלאה תדווח רק על שינויים, כדי שההתראה הראשונה שתקבלו
              תהיה כזו שבאמת קרתה.
            </p>
          ) : run.alerts.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">אין שינויים מאז הבדיקה האחרונה.</p>
          ) : (
            <ul className="divide-y divide-line-2">
              {run.alerts.map((a) => (
                <li key={`${a.kind}-${a.propertyId}`} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${KIND_TONE[a.kind]}`}>
                    {KIND_LABEL[a.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug">{a.headline}</p>
                    <p className="mt-0.5 text-xs text-muted">{a.detail}</p>
                  </div>
                  <span className="num text-xs font-bold text-accent-ink">{a.score}/100</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
