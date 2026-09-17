'use client';

import { useState } from 'react';

export interface ResolvedAddress {
  city: string;
  street: string;
  gush: string;
  helka: string;
}

interface ResolveResponse {
  parsed: { street: string; houseNumber: string | null; city: string | null; dropped: string[] };
  resolution: {
    gush: number | null;
    helka: number | null;
    confidence: 'exact' | 'street' | 'official' | 'none';
    sourceId: string;
    matchedAddress: string | null;
    alternatives: Array<{ gush: number; helka: number; address: string }>;
    note?: string;
  };
  action: 'fill' | 'suggest' | 'manual';
}

const TONE: Record<ResolveResponse['action'], string> = {
  fill: 'bg-good-soft text-good',
  suggest: 'bg-warn-soft text-warn',
  manual: 'bg-surface-2 text-muted',
};

/**
 * Address → gush/helka, with the confidence stated.
 *
 * A weak match fills the city and street but leaves the parcel fields for the user,
 * because a neighbouring building's helka entered as this one's is worse than a
 * blank field: every official lookup downstream would then be for the wrong property.
 */
export function AddressLookup({ onResolved }: { onResolved: (r: Partial<ResolvedAddress>) => void }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ResolveResponse | null>(null);
  const [error, setError] = useState('');

  async function lookup() {
    if (!address.trim()) return;
    setBusy(true);
    setError('');
    setRes(null);
    try {
      const r = await fetch(`/api/resolve?address=${encodeURIComponent(address)}`);
      const json = await r.json();
      if (!r.ok) {
        setError(json.error ?? 'האיתור נכשל');
        return;
      }
      const data = json as ResolveResponse;
      setRes(data);

      const street = data.parsed.houseNumber
        ? `${data.parsed.street} ${data.parsed.houseNumber}`
        : data.parsed.street;

      onResolved({
        city: data.parsed.city ?? '',
        street,
        ...(data.action === 'fill'
          ? { gush: String(data.resolution.gush ?? ''), helka: String(data.resolution.helka ?? '') }
          : {}),
      });
    } catch {
      setError('לא הצלחנו להגיע לשירות האיתור. אפשר להזין גוש וחלקה ידנית.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-dashed border-line bg-surface-2 p-3">
      <label className="mb-1 block text-[11px] font-bold tracking-wider text-muted" htmlFor="address-lookup">
        איתור לפי כתובת
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="address-lookup"
          className="min-w-0 flex-1 basis-64 rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void lookup();
            }
          }}
          placeholder="למשל: רח׳ ויטל 14, ת״א"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => void lookup()}
          disabled={busy || !address.trim()}
          className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-bold text-ink-2 hover:border-accent hover:text-accent-ink disabled:opacity-60"
        >
          {busy ? 'מאתר…' : 'אתר גוש וחלקה'}
        </button>
      </div>

      {res && (
        <div className={`mt-2 rounded-md px-2.5 py-2 text-xs leading-relaxed ${TONE[res.action]}`} role="status">
          {res.action === 'fill' && (
            <>
              נמצא: גוש {res.resolution.gush} חלקה {res.resolution.helka}
              {res.resolution.matchedAddress ? ` · ${res.resolution.matchedAddress}` : ''} — השדות מולאו.
            </>
          )}
          {res.action === 'suggest' && (
            <>
              נמצא אותו רחוב אך לא אותו מספר בית. הגוש הסביר הוא {res.resolution.gush}, אך החלקה שייכת לבניין
              אחר ולכן לא מולאה — יש לאמת מול נסח.
              {res.resolution.alternatives.length > 0 && (
                <span className="mt-1 block">
                  בניינים סמוכים במאגר:{' '}
                  {res.resolution.alternatives.map((a) => `${a.address} (${a.gush}/${a.helka})`).join(' · ')}
                </span>
              )}
            </>
          )}
          {res.action === 'manual' && <>{res.resolution.note ?? 'לא נמצאה התאמה'} — יש להזין גוש וחלקה ידנית.</>}
          {res.parsed.dropped.length > 0 && (
            <span className="mt-1 block opacity-80">התעלמנו מ: {res.parsed.dropped.join(', ')}</span>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs font-semibold text-crit" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
