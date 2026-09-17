'use client';

import { useMemo, useState } from 'react';
import { ComparisonPanel } from './ComparisonPanel';
import { PropertyCard } from './PropertyCard';
import { MAX_COMPARE } from '@/lib/compare';
import { ASSET_TYPE_LABEL, FEATURE_LABEL, parseQuery, type FeatureKey, type SearchQuery } from '@/lib/query';
import { evaluate, search, type SortKey } from '@/lib/search';
import type { AssetType, BuyerProfile, Deal, Property } from '@/types/property';

const PROFILE_OPTIONS: Array<[BuyerProfile, string]> = [
  ['single', 'דירה יחידה'],
  ['upgrade', 'משפר דיור (מוכר תוך החלון)'],
  ['additional', 'דירה נוספת / השקעה'],
  ['oleh', 'עולה חדש — דירת מגורים יחידה'],
  ['reg11', 'זכאי תקנה 11 (נכה / עיוור / נפגע פעולת איבה / משפחה שכולה)'],
];

const SORT_OPTIONS: Array<[SortKey, string]> = [
  ['match', 'התאמה'],
  ['price-asc', 'מחיר — מהנמוך'],
  ['price-desc', 'מחיר — מהגבוה'],
  ['ppsm', 'מחיר למ״ר'],
  ['yield', 'תשואה ברוטו'],
  ['fresh', 'פורסם לאחרונה'],
  ['stale', 'הכי הרבה ימים בשוק'],
];

const EXAMPLES = [
  '4 חדרים בחיפה עד 2 מיליון עם מעלית וחניה',
  'להשקעה תשואה מעל 4% עם ממ״ד',
  'סטודיו להשכרה בתל אביב עד 6000',
  'יחידת דיור עד 1.3 מיליון',
];

interface Filters {
  deal: Deal;
  city: string;
  assetType: string;
  roomsMin: string;
  priceMin: string;
  priceMax: string;
  sqmMin: string;
  yieldMin: string;
  features: FeatureKey[];
}

const EMPTY: Filters = {
  deal: 'sale',
  city: '',
  assetType: '',
  roomsMin: '',
  priceMin: '',
  priceMax: '',
  sqmMin: '',
  yieldMin: '',
  features: [],
};

function fromParsed(parsed: SearchQuery, current: Filters): Filters {
  return {
    deal: parsed.deal ?? current.deal,
    city: parsed.city ?? '',
    assetType: parsed.assetType ?? '',
    roomsMin: parsed.roomsMin ? String(parsed.roomsMin) : '',
    priceMin: '',
    priceMax: parsed.priceMax ? String(Math.round(parsed.priceMax)) : '',
    sqmMin: parsed.sqmMin ? String(parsed.sqmMin) : '',
    yieldMin: parsed.yieldMin ? (parsed.yieldMin * 100).toFixed(1) : '',
    features: parsed.features ?? [],
  };
}

function toQuery(f: Filters): SearchQuery {
  const n = (s: string) => (s.trim() === '' ? undefined : Number(s));
  return {
    deal: f.deal,
    city: f.city || undefined,
    assetType: (f.assetType || undefined) as AssetType | undefined,
    roomsMin: n(f.roomsMin),
    priceMin: n(f.priceMin),
    priceMax: n(f.priceMax),
    sqmMin: n(f.sqmMin),
    yieldMin: f.yieldMin.trim() === '' ? undefined : Number(f.yieldMin) / 100,
    features: f.features.length ? f.features : undefined,
  };
}

const field =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink focus:border-accent';
const label = 'mb-1 block text-[11px] font-bold tracking-wider text-muted';

export function SearchApp({ properties, cities }: { properties: Property[]; cities: string[] }) {
  const initial = '4 חדרים עד 5.5 מיליון עם מעלית וחניה';
  const [text, setText] = useState(initial);
  const [filters, setFilters] = useState<Filters>(() => fromParsed(parseQuery(initial, cities), EMPTY));
  const [profile, setProfile] = useState<BuyerProfile>('single');
  const [sort, setSort] = useState<SortKey>('match');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const results = useMemo(
    () => search(properties, toQuery(filters), profile, sort),
    [properties, filters, profile, sort],
  );

  const criticalCount = results.filter((r) => r.flags.some((f) => f.level === 'crit')).length;

  // Selection is held by id and resolved against the full inventory, so a property
  // stays in the comparison after a filter change stops it matching the search.
  const compared = useMemo(() => {
    const byId = new Map(properties.map((p) => [p.id, p]));
    const q = toQuery(filters);
    return compareIds
      .map((id) => byId.get(id))
      .filter((p): p is Property => p !== undefined)
      .map((p) => evaluate(p, q, profile));
  }, [properties, compareIds, filters, profile]);

  const toggleCompare = (id: string) =>
    setCompareIds((ids) => {
      if (ids.includes(id)) {
        const next = ids.filter((x) => x !== id);
        if (next.length === 0) setCompareOpen(false);
        return next;
      }
      if (ids.length >= MAX_COMPARE) return ids;
      return [...ids, id];
    });
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const runText = (value: string) => {
    setText(value);
    setFilters((f) => fromParsed(parseQuery(value, cities), f));
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div className="border-b border-line bg-surface-2 px-4 py-2.5 text-xs font-bold tracking-wide text-muted">
        חיפוש
      </div>

      <div className="p-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            runText(text);
          }}
        >
          <label htmlFor="ask" className="sr-only">
            שאילתת חיפוש בשפה חופשית
          </label>
          <input
            id="ask"
            className="min-w-0 flex-1 basis-72 rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-[15px] text-ink"
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            placeholder="למשל: 3 חדרים ברמת גן עד 2.5 מיליון עם ממ״ד"
            autoComplete="off"
          />
          <button type="submit" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-white">
            חפש
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-bold text-ink-2"
            onClick={() => {
              setText('');
              setFilters((f) => ({ ...EMPTY, deal: f.deal }));
            }}
          >
            נקה
          </button>
        </form>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">נסו:</span>
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => runText(q)}
              className="rounded-full border border-dashed border-line px-2.5 py-1 text-xs font-semibold text-accent-ink hover:border-solid hover:bg-accent-soft"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5 border-t border-line-2 pt-4">
          <div>
            <label className={label} htmlFor="f-deal">
              סוג עסקה
            </label>
            <select id="f-deal" className={field} value={filters.deal} onChange={(e) => set('deal', e.target.value as Deal)}>
              <option value="sale">מכירה</option>
              <option value="rent">שכירות</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="f-city">
              עיר
            </label>
            <select id="f-city" className={field} value={filters.city} onChange={(e) => set('city', e.target.value)}>
              <option value="">כל הערים</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="f-type">
              סוג נכס
            </label>
            <select id="f-type" className={field} value={filters.assetType} onChange={(e) => set('assetType', e.target.value)}>
              <option value="">כל הסוגים</option>
              {Object.entries(ASSET_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="f-rooms">
              חדרים (מינימום)
            </label>
            <select id="f-rooms" className={field} value={filters.roomsMin} onChange={(e) => set('roomsMin', e.target.value)}>
              <option value="">הכול</option>
              {['1', '2', '2.5', '3', '3.5', '4', '4.5', '5', '6'].map((r) => (
                <option key={r} value={r}>
                  {r}+
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1.5">
            <div className="min-w-0 flex-1">
              <label className={label} htmlFor="f-pmin">
                מחיר מ־
              </label>
              <input id="f-pmin" type="number" inputMode="numeric" className={field} value={filters.priceMin} onChange={(e) => set('priceMin', e.target.value)} placeholder="0" />
            </div>
            <div className="min-w-0 flex-1">
              <label className={label} htmlFor="f-pmax">
                עד
              </label>
              <input id="f-pmax" type="number" inputMode="numeric" className={field} value={filters.priceMax} onChange={(e) => set('priceMax', e.target.value)} placeholder="ללא הגבלה" />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="f-sqm">
              שטח מינימלי (מ״ר)
            </label>
            <input id="f-sqm" type="number" inputMode="numeric" className={field} value={filters.sqmMin} onChange={(e) => set('sqmMin', e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className={label} htmlFor="f-yield">
              תשואה ברוטו מינימלית %
            </label>
            <input id="f-yield" type="number" inputMode="decimal" step="0.1" className={field} value={filters.yieldMin} onChange={(e) => set('yieldMin', e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className={label} htmlFor="f-profile">
              פרופיל הקונה (למס רכישה)
            </label>
            <select id="f-profile" className={field} value={profile} onChange={(e) => setProfile(e.target.value as BuyerProfile)}>
              {PROFILE_OPTIONS.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="מאפיינים נדרשים">
          {(Object.keys(FEATURE_LABEL) as FeatureKey[]).map((key) => {
            const on = filters.features.includes(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set('features', on ? filters.features.filter((f) => f !== key) : [...filters.features, key])
                }
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  on ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink-2'
                }`}
              >
                {FEATURE_LABEL[key]}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 border-t border-line-2 pt-3.5">
          <p className="text-sm text-ink-2">
            <span className="font-display text-lg font-bold text-ink">{results.length}</span> נכסים ·{' '}
            {PROFILE_OPTIONS.find(([k]) => k === profile)?.[1]}
            {criticalCount > 0 && (
              <span className="ms-2 rounded-full bg-crit-soft px-2 py-0.5 text-xs font-semibold text-crit">
                {criticalCount} עם דגל אדום
              </span>
            )}
          </p>
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <label htmlFor="f-sort">מיון</label>
            <select
              id="f-sort"
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORT_OPTIONS.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        {compareIds.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent-soft bg-accent-soft px-3 py-2">
            <span className="text-[13px] font-semibold text-accent-ink">
              {compareIds.length} נכסים נבחרו להשוואה
              {compareIds.length >= MAX_COMPARE && ' (המקסימום)'}
            </span>
            <button
              type="button"
              onClick={() => setCompareOpen((v) => !v)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white"
            >
              {compareOpen ? 'הסתרת ההשוואה' : 'הצגת ההשוואה'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCompareIds([]);
                setCompareOpen(false);
              }}
              className="text-xs font-semibold text-accent-ink underline"
            >
              ניקוי הבחירה
            </button>
          </div>
        )}

        {compareOpen && compared.length > 0 && (
          <ComparisonPanel results={compared} onRemove={toggleCompare} onClose={() => setCompareOpen(false)} />
        )}

        {results.length === 0 ? (
          <p className="py-10 text-center text-[15px] text-muted">
            אין נכסים שעונים על כל הקריטריונים.
            <br />
            נסו להסיר מאפיין נדרש, להעלות את תקרת המחיר, או לבחור עיר אחרת.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
            {results.map((r) => (
              <PropertyCard
                key={r.property.id}
                result={r}
                profile={profile}
                selected={compareIds.includes(r.property.id)}
                selectable={compareIds.length < MAX_COMPARE}
                onToggleSelect={toggleCompare}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
