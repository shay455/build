'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface EnrichResponse {
  source: { id: string; label: string };
  enriched: number;
  skipped: Array<{ id: string; reason: string }>;
}

/** Pulls market data for the whole index and reports honestly what it could not get. */
export function EnrichButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EnrichResponse | null>(null);
  const [error, setError] = useState('');

  async function run() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'ההעשרה נכשלה');
        return;
      }
      setResult(json as EnrichResponse);
      router.refresh();
    } catch {
      setError('לא הצלחנו להגיע למקור. הנתונים הקיימים לא שונו.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-bold text-ink-2 hover:border-accent hover:text-accent-ink disabled:opacity-60"
      >
        {busy ? 'שולף…' : 'רענון נתוני שוק ממקור'}
      </button>
      {result && (
        <p className="text-xs text-muted" role="status">
          {result.source.label}: עודכנו {result.enriched} נכסים
          {result.skipped.length > 0 && (
            <>
              {' · '}
              <span className="text-warn">{result.skipped.length} ללא נתונים ({result.skipped[0].reason})</span>
            </>
          )}
        </p>
      )}
      {error && (
        <p className="text-xs font-semibold text-crit" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
