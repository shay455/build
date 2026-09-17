'use client';

import { useState } from 'react';
import type { SearchQuery } from '@/lib/query';
import type { BuyerProfile } from '@/types/property';

/**
 * Saves the current filters as a standing mandate.
 *
 * The score floor is asked for, not assumed: it is what separates a useful alert
 * from a stream of near-misses, and only the person searching knows where their
 * line is.
 */
export function SaveSearchButton({
  query,
  profile,
  suggestedName,
  matchCount,
}: {
  query: SearchQuery;
  profile: BuyerProfile;
  suggestedName: string;
  matchCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [minScore, setMinScore] = useState('60');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/searches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: (name.trim() || suggestedName).slice(0, 80),
          query,
          profile,
          minScore: Number(minScore) || 0,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.issues?.[0]?.message ?? json.error ?? 'השמירה נכשלה');
        return;
      }
      setDone(`נשמר כ„${json.search.name}”. הבדיקה הראשונה תרשום את מצב הפתיחה.`);
      setOpen(false);
      setName('');
    } catch {
      setError('לא הצלחנו לשמור את החיפוש.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!open && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setDone('');
          }}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink-2 hover:border-accent hover:text-accent-ink"
        >
          שמירת החיפוש
        </button>
      )}

      {open && (
        <div className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-line bg-surface-2 p-3">
          <div className="min-w-0 flex-1 basis-56">
            <label className="mb-1 block text-[11px] font-bold tracking-wider text-muted" htmlFor="save-name">
              שם החיפוש
            </label>
            <input
              id="save-name"
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={suggestedName}
              autoComplete="off"
            />
          </div>
          <div className="w-32">
            <label className="mb-1 block text-[11px] font-bold tracking-wider text-muted" htmlFor="save-score">
              סף ציון להתראה
            </label>
            <input
              id="save-score"
              type="number"
              min={0}
              max={100}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? 'שומר…' : 'שמירה'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-line px-3 py-2 text-sm font-bold text-ink-2"
          >
            ביטול
          </button>
          <p className="basis-full text-[11px] text-muted">
            כרגע {matchCount} נכסים עונים על החיפוש. רק תוצאות מהציון הזה ומעלה יפיקו התראה.
          </p>
        </div>
      )}

      {done && <p className="text-xs font-semibold text-good">{done}</p>}
      {error && <p className="text-xs font-semibold text-crit">{error}</p>}
    </div>
  );
}
