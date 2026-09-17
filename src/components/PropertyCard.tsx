'use client';

import { Facade } from './Facade';
import { ASSET_TYPE_LABEL } from '@/lib/query';
import { num, pct, ratePct, shekel, shortShekel, signedPct } from '@/lib/format';
import { DEFAULT_MORTGAGE } from '@/lib/finance';
import { ADDITIONAL_HOME_ORDER_EXPIRES } from '@/lib/tax';
import type { SearchResult } from '@/lib/search';
import type { BuyerProfile, Condition, Property } from '@/types/property';

const CONDITION_LABEL: Record<Condition, string> = {
  new: 'חדש',
  renovated: 'משופץ',
  kept: 'שמור',
  needsWork: 'דורש שיפוץ',
};

const PROFILE_LABEL: Record<BuyerProfile, string> = {
  single: 'דירה יחידה',
  upgrade: 'משפר דיור',
  additional: 'דירה נוספת / השקעה',
  oleh: 'עולה חדש — תקנה 12א',
  reg11: 'זכאי תקנה 11',
};

const REGISTRY_LABEL = { tabu: 'טאבו', rmi: 'רמ״י', housingCompany: 'חברה משכנת' } as const;

const SOURCE_LABEL: Record<string, string> = {
  manual: 'הוזן ידנית',
  nadlan: 'נדל״ן — רשות המסים',
  fixture: 'נתוני דוגמה מקומיים',
};

function Row({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dotted border-line-2 py-1 text-[13px] last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className={`num text-end ${strong ? 'font-bold' : 'font-semibold'}`}>{value}</span>
    </div>
  );
}

function Drawer({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="border-b border-line-2 open:bg-surface-2">
      <summary className="flex items-center justify-between gap-2 px-3.5 py-2 text-[13px] font-bold text-ink-2 hover:text-ink">
        {title}
      </summary>
      <div className="px-3.5 pb-3">{children}</div>
    </details>
  );
}

function Chip({ tone = 'plain', children }: { tone?: 'plain' | 'accent' | 'ok' | 'warn' | 'crit'; children: React.ReactNode }) {
  const tones = {
    plain: 'border-line bg-surface-2 text-ink-2',
    accent: 'border-transparent bg-accent-soft text-accent-ink',
    ok: 'border-transparent bg-good-soft text-good',
    warn: 'border-transparent bg-warn-soft text-warn',
    crit: 'border-transparent bg-crit-soft text-crit',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function featureList(p: Property): string[] {
  const f = p.features;
  const out = [
    f.elevator ? 'מעלית' : 'ללא מעלית',
    f.parking > 0 ? `חניה × ${f.parking}` : 'ללא חניה',
    f.mamad ? 'ממ״ד' : 'ללא ממ״ד',
  ];
  if (p.balconySqm > 0) out.push(`מרפסת ${p.balconySqm} מ״ר`);
  if (f.storage) out.push('מחסן');
  if (f.accessible) out.push('גישה לנכים');
  if (f.furnished) out.push('מרוהט');
  if (f.separateEntrance) out.push('כניסה נפרדת');
  if (f.bars) out.push('סורגים');
  out.push(`מיזוג: ${f.ac}`);
  return out;
}

function ringClass(n: number): string {
  if (n >= 80) return 'bg-good';
  if (n >= 62) return 'bg-accent';
  if (n >= 45) return 'bg-warn';
  return 'bg-muted';
}

export function PropertyCard({
  result,
  profile,
  selected = false,
  selectable = true,
  onToggleSelect,
}: {
  result: SearchResult;
  profile: BuyerProfile;
  selected?: boolean;
  /** False once the comparison is full, so the control explains itself instead of failing silently. */
  selectable?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const { property: p, economics: e, score, flags } = result;
  const sale = p.deal === 'sale';
  const delta = e.deltaVsArea;
  const deltaTone =
    delta === null ? 'bg-surface-3 text-muted' : delta <= -0.03 ? 'bg-good-soft text-good' : delta >= 0.03 ? 'bg-crit-soft text-crit' : 'bg-surface-3 text-muted';
  // With too few transactions behind it, a percentage is false precision. Say the
  // sample is thin instead — the number the user would have trusted is the harm.
  const deltaText =
    delta !== null
      ? `${signedPct(delta)} ${sale ? 'מול חציון האזור' : 'מול שכ״ד אזורי'}`
      : e.comparableBasis === 'thin'
        ? `מדגם קטן — ${p.marketSampleSize} עסקאות`
        : 'אין בסיס השוואה';

  const headlineFlags = flags.slice(0, 4);
  const restFlags = flags.slice(4);

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-xl border bg-surface hover:border-accent ${
        selected ? 'border-accent ring-1 ring-accent' : 'border-line'
      }`}
    >
      <div className="relative aspect-video max-w-full overflow-hidden bg-surface-3">
        <Facade property={p} />
        <div className="absolute top-2 start-2 flex flex-wrap gap-1.5">
          <Chip tone="accent">{sale ? 'מכירה' : 'שכירות'}</Chip>
          <Chip>{ASSET_TYPE_LABEL[p.assetType]}</Chip>
        </div>
        <div className="absolute top-2 end-2 flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 shadow">
          <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold text-white ${ringClass(score.value)}`}>
            {score.value}
          </span>
          <span className="text-[10px] font-bold tracking-wide text-muted">התאמה</span>
        </div>
        {p.priceDrop > 0 ? (
          <span className="absolute bottom-2 start-2 rounded bg-surface px-2 py-0.5 text-xs font-bold text-ink-2 shadow">
            ירד {shortShekel(p.priceDrop)}
          </span>
        ) : delta !== null && delta <= -0.08 ? (
          <span className="absolute bottom-2 start-2 rounded bg-surface px-2 py-0.5 text-xs font-bold text-ink-2 shadow">
            מתחת לחציון האזור
          </span>
        ) : p.daysOnMarket <= 14 ? (
          <span className="absolute bottom-2 start-2 rounded bg-surface px-2 py-0.5 text-xs font-bold text-ink-2 shadow">
            חדש בשוק
          </span>
        ) : null}
      </div>

      <div className="px-3.5 pt-3">
        <h3 className="text-lg font-bold leading-tight">
          {ASSET_TYPE_LABEL[p.assetType]} {p.rooms} חדרים · {p.neighborhood || p.city}
        </h3>
        <p className="mt-0.5 text-[13px] text-muted">
          {p.street}
          {p.street ? ', ' : ''}
          {p.city} ·{' '}
          <span className="font-mono text-[12px]">
            גוש {p.gush} חלקה {p.helka}
            {p.tatHelka ? `/${p.tatHelka}` : ''}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 px-3.5 pt-2">
        <span className="num font-display text-2xl font-black leading-none">
          {shekel(p.price)}
          {!sale && <span className="text-sm font-semibold"> / חודש</span>}
        </span>
        {sale && e.ppsm !== null && <span className="num pb-0.5 text-xs text-muted">{shekel(e.ppsm)} למ״ר</span>}
        <span className={`num rounded px-1.5 py-0.5 text-xs font-bold ${deltaTone}`}>{deltaText}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-px border-y border-line-2 bg-line-2 sm:grid-cols-4">
        {[
          [p.sqm, 'מ״ר'],
          [p.rooms, 'חדרים'],
          [p.floor === 0 ? 'קרקע' : `${p.floor}/${p.floorsInBuilding}`, 'קומה'],
          [p.builtYear, 'שנת בנייה'],
        ].map(([value, label]) => (
          <div key={String(label)} className="bg-surface px-1.5 py-2 text-center">
            <dd className="num text-base font-bold leading-tight">{value}</dd>
            <dt className="text-[10px] tracking-wide text-muted">{label}</dt>
          </div>
        ))}
      </dl>

      {score.reasons.length > 0 && (
        <div className="px-3.5 pt-3">
          <p className="mb-1.5 text-[10px] font-bold tracking-widest text-muted">למה זה כאן</p>
          <div className="flex flex-wrap gap-1.5">
            {score.reasons.map((r) => (
              <Chip key={r} tone="accent">
                {r}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {headlineFlags.length > 0 && (
        <ul className="flex flex-col gap-1.5 px-3.5 pt-3">
          {headlineFlags.map((f) => (
            <li
              key={f.text}
              className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs leading-snug ${
                f.level === 'crit' ? 'bg-crit-soft text-crit' : f.level === 'warn' ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good'
              }`}
            >
              <span aria-hidden className="font-bold">
                {f.level === 'crit' ? '●' : f.level === 'warn' ? '▲' : '✓'}
              </span>
              <span>{f.text}</span>
            </li>
          ))}
          {restFlags.length > 0 && (
            <li className="text-[11px] text-muted">ועוד {restFlags.length} הערות במגירת הרישום</li>
          )}
        </ul>
      )}

      <div className="mt-3 border-t border-line-2">
        <Drawer title="מאפיינים ומצב">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {featureList(p).map((x) => (
              <Chip key={x}>{x}</Chip>
            ))}
          </div>
          <Row label="מצב הנכס" value={CONDITION_LABEL[p.condition]} />
          {p.aspects && <Row label="כיווני אוויר" value={p.aspects} />}
          {p.lotSqm ? <Row label="שטח מגרש" value={`${p.lotSqm} מ״ר`} /> : null}
          <Row label="תאריך כניסה" value={p.availableFrom} />
          {!sale && (
            <>
              <Row label="פיקדון" value={`${p.depositMonths} חודשים (${shekel(e.deposit ?? 0)})`} />
              <Row label="תקופה מינימלית" value={`${p.minLeaseMonths} חודשים`} />
              <Row label="חיות מחמד" value={p.petsAllowed ? 'מותר' : 'לא מותר'} />
            </>
          )}
        </Drawer>

        <Drawer title={sale ? 'עלות חודשית משוערת' : 'עלות חודשית מלאה'}>
          {sale ? (
            <>
              <Row label="החזר משכנתא" value={shekel(e.monthlyMortgage ?? 0)} />
              <Row label="ארנונה" value={shekel(p.arnona)} />
              <Row label="ועד בית" value={shekel(p.vaad)} />
              <Row label="סה״כ לחודש" value={shekel(e.monthlyAllIn)} strong />
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                מבוסס על מימון {pct(e.ltv ?? 0, 0)}, ריבית {pct(DEFAULT_MORTGAGE.annualRate, 2)} ו־
                {DEFAULT_MORTGAGE.years} שנים. שינוי פרופיל הקונה משנה את מגבלת המימון.
              </p>
            </>
          ) : (
            <>
              <Row label="שכר דירה" value={shekel(p.price)} />
              <Row label="ארנונה" value={shekel(p.arnona)} />
              <Row label="ועד בית" value={shekel(p.vaad)} />
              <Row label="חשמל ומים (משוער)" value={shekel(p.utilities)} />
              <Row label="סה״כ לחודש" value={shekel(e.monthlyAllIn)} strong />
            </>
          )}
        </Drawer>

        {sale && e.tax && e.closing && (
          <>
            <Drawer title={`מיסוי ועלות רכישה · ${PROFILE_LABEL[profile]}`}>
              {e.tax.brackets.map((b) => (
                <Row
                  key={`${b.from}-${b.rate}`}
                  label={
                    <>
                      <span className="font-mono text-[12px]">
                        {num(b.from)}–{b.to === Infinity ? '∞' : num(b.to)}
                      </span>{' '}
                      · {ratePct(b.rate)}
                    </>
                  }
                  value={shekel(b.amount)}
                />
              ))}
              <Row label="מס רכישה משוער" value={shekel(e.tax.amount)} strong />
              {e.tax.notes.map((n) => (
                <p
                  key={n}
                  className={`mt-1.5 text-[11px] leading-relaxed ${e.tax!.reliefCeilingLost || e.tax!.cliffApplied ? 'text-warn' : 'text-muted'}`}
                >
                  {n}
                </p>
              ))}
              <div className="h-2" />
              <Row label="עו״ד (משוער)" value={shekel(e.closing.lawyer)} />
              <Row
                label={`תיווך${p.publisherKind === 'agency' ? ` ${p.agentFeePct}% + מע״מ` : ''}`}
                value={e.closing.agent > 0 ? shekel(e.closing.agent) : '—'}
              />
              <Row label="שמאי ואגרות" value={shekel(e.closing.appraiser + e.closing.misc)} />
              <Row label="סה״כ עלות כניסה" value={shekel(e.acquisitionTotal ?? 0)} strong />
              <Row
                label={`הון עצמי נדרש (${pct(1 - (e.ltv ?? 0), 0)} + עלויות)`}
                value={shekel(e.equityRequired ?? 0)}
                strong
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                כל סכומי המס משוערים ואינם חישוב מחייב. לאימות מול{' '}
                <a
                  className="underline"
                  href="https://www.gov.il/he/service/real_eatate_taxsimulator"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  סימולטור רשות המסים
                </a>
                . שיעורי דירה נוספת הם הוראת שעה עד {ADDITIONAL_HOME_ORDER_EXPIRES}.
              </p>
            </Drawer>

            <Drawer title="השקעה ותשואה">
              <Row label="שכ״ד צפוי באזור" value={shekel(p.expectedMonthlyRent)} />
              <Row label="תשואה ברוטו" value={pct(e.grossYield ?? 0, 2)} strong />
              <Row label="תשואה נטו (על עלות כוללת)" value={pct(e.netYield ?? 0, 2)} strong />
              <Row
                label="תזרים חודשי מול משכנתא"
                value={`${(e.monthlyCashflow ?? 0) >= 0 ? '+' : ''}${shekel(e.monthlyCashflow ?? 0)}`}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                נטו מחושב בניכוי 4% תקופות ריקות, 5% תחזוקה, ביטוח וועד בית, וחלקי עלות הרכישה הכוללת ולא חלקי
                המחיר. תקרת הפטור ממס על הכנסה משכירות היא פרמטר מערכת שטרם אומת ואינה מגולמת כאן.
              </p>
            </Drawer>
          </>
        )}

        <Drawer title="רישום, תכנון וסביבה">
          <Row label="סוג רישום" value={`${REGISTRY_LABEL[p.registryKind]} · ${p.tenure === 'lease' ? 'חכירה' : 'בעלות'}`} />
          {p.leaseEndsAt && <Row label="סיום חכירה" value={p.leaseEndsAt} />}
          <Row label="הערות אזהרה" value={p.caveats === 0 ? 'לא נמצאו' : p.caveats} />
          <Row label="משכנתאות רשומות" value={p.mortgages} />
          <Row
            label="אימות מול נסח"
            value={p.registryVerified ? 'אומת' : <span className="text-warn">לא אומת</span>}
          />
          {p.splitPermit && (
            <Row
              label="היתר פיצול"
              value={
                p.splitPermit === 'granted' ? 'קיים' : <span className="text-crit">{p.splitPermit === 'none' ? 'אין' : 'לא אותר'}</span>
              }
            />
          )}
          <Row
            label="התחדשות עירונית"
            value={p.urbanRenewal ? `${p.urbanRenewal}${p.renewalStage ? ` · ${p.renewalStage}` : ''}` : 'אין תוכנית פעילה'}
          />
          {p.bettermentRisk && (
            <Row
              label="חשיפה להיטל השבחה"
              value={{ low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' }[p.bettermentRisk]}
            />
          )}
          <Row label="תחבורה ציבורית" value={`${p.walkTransitMin} דק׳ הליכה`} />
          <Row label="בית ספר" value={`${p.walkSchoolMin} דק׳ הליכה`} />
          <Row label="פארק" value={`${p.walkParkMin} דק׳ הליכה`} />
          {restFlags.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {restFlags.map((f) => (
                <li
                  key={f.text}
                  className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs leading-snug ${
                    f.level === 'crit' ? 'bg-crit-soft text-crit' : f.level === 'warn' ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good'
                  }`}
                >
                  <span aria-hidden className="font-bold">
                    {f.level === 'crit' ? '●' : f.level === 'warn' ? '▲' : '✓'}
                  </span>
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Drawer>

        {sale && p.comparables.length > 0 && (
          <Drawer title={`עסקאות השוואה · ${SOURCE_LABEL[p.marketSourceId] ?? p.marketSourceId}`}>
            {p.comparables.map((c) => (
              <Row
                key={`${c.date}-${c.sqm}`}
                label={`${c.date} · ${c.sqm} מ״ר`}
                value={
                  <>
                    {shekel(c.price)}{' '}
                    <span className="font-normal text-muted">({shekel(c.price / c.sqm)}/מ״ר)</span>
                  </>
                }
              />
            ))}
            <Row label="חציון האזור למ״ר" value={shekel(p.areaMedianPpsm)} strong />
            <Row
              label="מדגם"
              value={
                p.marketSampleSize > 0 ? `${p.marketSampleSize} עסקאות` : `${p.comparables.length} עסקאות (הוזן ידנית)`
              }
            />
            {p.marketStatus === 'thin' && (
              <p className="mt-1.5 rounded-md bg-warn-soft px-2 py-1.5 text-[11px] leading-relaxed text-warn">
                המדגם קטן מכדי לגזור ממנו אחוז. הנתונים מוצגים כפי שהם, בלי פער מחושב.
              </p>
            )}
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              מקור: {SOURCE_LABEL[p.marketSourceId] ?? p.marketSourceId}
              {p.marketFetchedAt ? ` · נשלף ${p.marketFetchedAt.slice(0, 10)}` : ' · לא נשלף ממקור, הוזן ידנית'} ·
              העסקה האחרונה {p.marketAsOf}. אינדיקציה בלבד ולא שומה: ללא ביקור בנכס וללא התאמות שיטת ההשוואה.
            </p>
          </Drawer>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line-2 px-3.5 py-2.5">
        {onToggleSelect && (
          <button
            type="button"
            onClick={() => onToggleSelect(p.id)}
            disabled={!selected && !selectable}
            aria-pressed={selected}
            title={!selected && !selectable ? `ההשוואה מלאה` : undefined}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-bold disabled:opacity-50 ${
              selected ? 'border-transparent bg-accent text-white' : 'border-line bg-surface text-ink-2 hover:border-accent hover:text-accent-ink'
            }`}
          >
            {selected ? '✓ בהשוואה' : 'הוספה להשוואה'}
          </button>
        )}
        <a
          href={`/api/report/${encodeURIComponent(p.id)}?profile=${profile}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-ink-2 hover:border-accent hover:text-accent-ink"
        >
          דוח נכס
        </a>
        <span className="rounded-md border border-transparent bg-accent-soft px-2.5 py-1.5 text-xs font-bold text-accent-ink">
          ציון {score.value}/100
        </span>
        <span className="ms-auto text-[11px] text-muted">
          {p.source} · {p.daysOnMarket} ימים · {p.publisherKind === 'agency' ? 'תיווך' : 'פרטי'}
        </span>
      </div>
    </article>
  );
}
