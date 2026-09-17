'use client';

import { buildComparison, MAX_COMPARE } from '@/lib/compare';
import { ASSET_TYPE_LABEL } from '@/lib/query';
import type { SearchResult } from '@/lib/search';

/**
 * Side-by-side comparison of up to four properties.
 *
 * A cell is marked as winning only where "better" is defined and the data actually
 * separates the columns — see pickBest. Rows where the question is meaningless
 * (days on market, aspects, entrance) carry no highlight at all.
 */
export function ComparisonPanel({
  results,
  onRemove,
  onClose,
}: {
  results: SearchResult[];
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const groups = buildComparison(results);
  if (results.length === 0) return null;

  const mixedDeals = new Set(results.map((r) => r.property.deal)).size > 1;

  return (
    <section
      className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm"
      aria-label="השוואת נכסים"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
        <h2 className="font-display text-base font-bold">
          השוואה · {results.length} מתוך {MAX_COMPARE}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink-2 hover:border-accent hover:text-accent-ink"
        >
          סגירה
        </button>
      </div>

      {mixedDeals && (
        <p className="border-b border-line-2 bg-warn-soft px-4 py-2 text-xs font-semibold text-warn">
          ההשוואה כוללת גם מכירה וגם שכירות. המספרים נמדדים ביחידות שונות, ולכן לא סומן „עדיף” בשורות
          הכספיות.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="sr-only">טבלת השוואה בין הנכסים שנבחרו</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky end-0 z-10 w-40 border-b border-line bg-surface-2 p-2 text-start text-xs text-muted">
                שדה
              </th>
              {results.map((r) => (
                <th key={r.property.id} scope="col" className="border-b border-s border-line-2 bg-surface-2 p-2 text-start align-top">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-display text-sm font-bold leading-tight">
                        {ASSET_TYPE_LABEL[r.property.assetType]} {r.property.rooms}ח׳
                      </div>
                      <div className="text-[11px] font-normal text-muted">
                        {r.property.neighborhood || r.property.city}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(r.property.id)}
                      aria-label={`הסרת ${r.property.street || r.property.city} מההשוואה`}
                      className="rounded px-1 text-muted hover:text-crit"
                    >
                      ✕
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {groups.map((group) => (
            <tbody key={group.title}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={results.length + 1}
                  className="border-y border-line-2 bg-accent-soft px-2 py-1.5 text-start text-[11px] font-bold tracking-wider text-accent-ink"
                >
                  {group.title}
                </th>
              </tr>
              {group.rows.map((r) => (
                <tr key={`${group.title}-${r.label}`} className="align-top">
                  <th
                    scope="row"
                    className="sticky end-0 z-10 border-b border-line-2 bg-surface p-2 text-start text-xs font-normal text-muted"
                  >
                    {r.label}
                    {r.note && <span className="mt-0.5 block text-[10px] leading-snug opacity-80">{r.note}</span>}
                  </th>
                  {r.cells.map((c, i) => (
                    <td
                      key={`${r.label}-${results[i]?.property.id ?? i}`}
                      className={`num border-b border-s border-line-2 p-2 text-[13px] ${
                        r.bestIndex === i ? 'bg-good-soft font-bold text-good' : ''
                      }`}
                    >
                      {c.text}
                      {r.bestIndex === i && <span className="sr-only"> — הטוב ביותר בשורה זו</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <p className="border-t border-line-2 px-4 py-3 text-[11px] leading-relaxed text-muted">
        הדגשה ירוקה מסמנת את הערך העדיף בשורה, ורק כאשר „עדיף” מוגדר והנתונים באמת מפרידים בין
        העמודות. בשורות כמו „ימים בשוק” או „כיווני אוויר” אין עדיפות אובייקטיבית ולכן אין הדגשה. כל
        סכומי המס והתשואה משוערים ואינם חישוב מחייב.
      </p>
    </section>
  );
}
