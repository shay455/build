'use client';

import { useState } from 'react';
import { SOURCE_GUIDE } from '@/lib/sources/url-policy';
import type { ExtractedListing } from '@/lib/extract';

interface ExtractResponse {
  fetched: boolean;
  extracted?: ExtractedListing;
  action?: 'paste-text';
  message?: string;
  policy?: { source: string; reason: string };
  error?: string;
}

const FIELD_LABEL: Record<string, string> = {
  deal: 'סוג עסקה',
  price: 'מחיר',
  assetType: 'סוג נכס',
  rooms: 'חדרים',
  sqm: 'שטח',
  balconySqm: 'מרפסת',
  floor: 'קומה',
  floorsInBuilding: 'מתוך קומות',
  builtYear: 'שנת בנייה',
  condition: 'מצב',
  city: 'עיר',
  street: 'רחוב',
  gush: 'גוש',
  helka: 'חלקה',
  arnona: 'ארנונה',
  vaad: 'ועד בית',
  availableFrom: 'תאריך כניסה',
  elevator: 'מעלית',
  parking: 'חניה',
  mamad: 'ממ״ד',
  storage: 'מחסן',
  furnished: 'מרוהט',
  accessible: 'גישה לנכים',
  separateEntrance: 'כניסה נפרדת',
  bars: 'סורגים',
};

const CONFIDENCE_TONE = {
  explicit: 'bg-good-soft text-good',
  inferred: 'bg-warn-soft text-warn',
  guessed: 'bg-surface-3 text-muted',
} as const;

function display(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'יש' : 'אין';
  if (typeof value === 'number') return value.toLocaleString('he-IL');
  return String(value);
}

/**
 * Paste a listing, get a filled form.
 *
 * Everything extracted is shown with the words it came from, because the user is
 * the one who has to certify it. An extractor that fills a form silently is worse
 * than one that shows its working and admits what it missed.
 */
export function PasteListing({ onExtracted }: { onExtracted: (e: ExtractedListing) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [showSources, setShowSources] = useState(false);

  const looksLikeUrl = /^https?:\/\/\S+$/i.test(text.trim());

  async function run() {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(looksLikeUrl ? { url: text.trim() } : { text }),
      });
      const json = (await res.json()) as ExtractResponse;
      setResult(json);
      if (json.extracted) onExtracted(json.extracted);
    } catch {
      setResult({ fetched: false, error: 'החילוץ נכשל. נסו שוב.' });
    } finally {
      setBusy(false);
    }
  }

  const found = result?.extracted
    ? [
        ...Object.entries(result.extracted).filter(
          ([k, v]) => k !== 'features' && k !== 'missing' && v !== undefined,
        ),
        ...Object.entries(result.extracted.features),
      ]
    : [];

  return (
    <section className="rounded-xl border border-accent-soft bg-accent-soft/40 p-4">
      <h2 className="font-display text-base font-bold">הדבקת מודעה</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">
        הדביקו טקסט של מודעה מכל מקור — יד2, פוסט בפייסבוק, הודעת ווטסאפ, תיאור סרטון — והשדות ימולאו
        אוטומטית. כל שדה מוצג עם המילים שממנו נגזר, כדי שתוכלו לאשר או לתקן.{' '}
        <button
          type="button"
          onClick={() => setShowSources((v) => !v)}
          className="font-semibold text-accent-ink underline"
        >
          מה עובד מאיזה מקור?
        </button>
      </p>

      {showSources && (
        <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="bg-surface-2 text-muted">
                <th className="p-2 text-start font-semibold">מקור</th>
                <th className="p-2 text-start font-semibold">מה עובד</th>
                <th className="p-2 text-start font-semibold">למה</th>
              </tr>
            </thead>
            <tbody>
              {SOURCE_GUIDE.map((s) => (
                <tr key={s.name} className="border-t border-line-2">
                  <td className="p-2 font-semibold">{s.name}</td>
                  <td className="p-2">{s.works}</td>
                  <td className="p-2 text-muted">{s.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <label htmlFor="paste" className="sr-only">
        טקסט המודעה או קישור
      </label>
      <textarea
        id="paste"
        rows={5}
        className="mt-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'דירה למכירה בפלורנטין, תל אביב\nרחוב ויטל 14, 3 חדרים, 72 מ״ר, קומה 2 מתוך 4\nמשופצת, ללא מעלית. מחיר 3,150,000 ש״ח'}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !text.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          {busy ? 'מחלץ…' : looksLikeUrl ? 'חילוץ מהקישור' : 'חילוץ מהטקסט'}
        </button>
        {text.trim() && (
          <button
            type="button"
            onClick={() => {
              setText('');
              setResult(null);
            }}
            className="text-xs font-semibold text-muted underline"
          >
            ניקוי
          </button>
        )}
        {looksLikeUrl && <span className="text-xs text-muted">זוהה קישור — ייתכן שיידרש טקסט במקום</span>}
      </div>

      {result?.error && <p className="mt-2 text-xs font-semibold text-crit">{result.error}</p>}

      {result?.action === 'paste-text' && (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn" role="status">
          {result.message}
        </p>
      )}

      {result?.extracted && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <p className="text-xs font-bold text-ink-2">
            זוהו {found.length} שדות. ירוק = נאמר במפורש, כתום = הוסק מההקשר.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {found.map(([key, field]) => {
              const f = field as { value: unknown; confidence: keyof typeof CONFIDENCE_TONE; evidence: string };
              return (
                <span
                  key={key}
                  title={`מהטקסט: ${f.evidence}`}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CONFIDENCE_TONE[f.confidence]}`}
                >
                  {FIELD_LABEL[key] ?? key}: {display(f.value)}
                </span>
              );
            })}
          </div>

          {result.extracted.missing.length > 0 && (
            <p className="mt-2 text-xs text-crit">
              חסר וצריך למלא ידנית: {result.extracted.missing.map((m) => FIELD_LABEL[m] ?? m).join(', ')}
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted">
            השדות מולאו בטופס שמתחת. עברו עליהם לפני השמירה — החילוץ הוא נקודת התחלה, לא אימות.
          </p>
        </div>
      )}
    </section>
  );
}
