import type { SearchResult } from './search';
import { num, pct, shekel } from './format';
import { ASSET_TYPE_LABEL } from './query';
import type { Condition, Property } from '@/types/property';

/** Whether a smaller or a larger number is better for a row, or whether the question is meaningless. */
export type Direction = 'lower' | 'higher' | 'none';

export interface CompareCell {
  text: string;
  /** The comparable number, when the row has one. Null cells never win a row. */
  value: number | null;
}

export interface CompareRow {
  label: string;
  direction: Direction;
  cells: CompareCell[];
  /** Index of the winning column, or null when nothing wins. */
  bestIndex: number | null;
  note?: string;
}

export interface CompareGroup {
  title: string;
  rows: CompareRow[];
}

export const MAX_COMPARE = 4;

const CONDITION_LABEL: Record<Condition, string> = {
  new: 'חדש',
  renovated: 'משופץ',
  kept: 'שמור',
  needsWork: 'דורש שיפוץ',
};
const REGISTRY_LABEL = { tabu: 'טאבו', rmi: 'רמ״י', housingCompany: 'חברה משכנת' } as const;
const BETTERMENT_LABEL = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' } as const;
const yesNo = (b: boolean): CompareCell => ({ text: b ? 'יש' : 'אין', value: b ? 1 : 0 });
const text = (s: string): CompareCell => ({ text: s, value: null });

/**
 * Pick the winning column.
 *
 * Returns null when fewer than two columns carry a number, or when every number is
 * the same — highlighting a "winner" among identical values invents a distinction
 * the data does not support.
 */
export function pickBest(cells: readonly CompareCell[], direction: Direction): number | null {
  if (direction === 'none') return null;
  const numeric = cells.map((c, i) => ({ i, v: c.value })).filter((x): x is { i: number; v: number } => x.v !== null);
  if (numeric.length < 2) return null;

  const values = numeric.map((x) => x.v);
  if (Math.max(...values) === Math.min(...values)) return null;

  const target = direction === 'lower' ? Math.min(...values) : Math.max(...values);
  // On a tie for the winning value, nobody wins.
  if (numeric.filter((x) => x.v === target).length > 1) return null;
  return numeric.find((x) => x.v === target)!.i;
}

function row(
  label: string,
  direction: Direction,
  cells: CompareCell[],
  note?: string,
): CompareRow {
  return { label, direction, cells, bestIndex: pickBest(cells, direction), note };
}

const map = <T>(rs: readonly SearchResult[], f: (r: SearchResult) => T): T[] => rs.map(f);
const prop = (rs: readonly SearchResult[], f: (p: Property) => CompareCell): CompareCell[] =>
  rs.map((r) => f(r.property));

/**
 * Build the side-by-side comparison.
 *
 * Sale and rent are never compared against each other: the numbers carry different
 * units and a "cheaper" verdict across them would be nonsense. The caller is expected
 * to pass one deal type; a mixed set returns the shared rows only.
 */
export function buildComparison(results: readonly SearchResult[]): CompareGroup[] {
  if (results.length === 0) return [];
  const allSale = results.every((r) => r.property.deal === 'sale');
  const mixed = !allSale && results.some((r) => r.property.deal === 'sale');

  const groups: CompareGroup[] = [];

  groups.push({
    title: 'זיהוי',
    rows: [
      row('סוג נכס', 'none', prop(results, (p) => text(ASSET_TYPE_LABEL[p.assetType]))),
      row('מיקום', 'none', prop(results, (p) => text(`${p.neighborhood || '—'}, ${p.city}`))),
      row('כתובת', 'none', prop(results, (p) => text(p.street || '—'))),
      row('גוש / חלקה', 'none', prop(results, (p) => text(`${p.gush} / ${p.helka}${p.tatHelka ? `/${p.tatHelka}` : ''}`))),
      row('ציון התאמה', 'higher', map(results, (r) => ({ text: `${r.score.value}/100`, value: r.score.value }))),
    ],
  });

  groups.push({
    title: mixed ? 'מחיר (עסקאות מעורבות — לא ניתן להשוואה ישירה)' : allSale ? 'מחיר' : 'שכר דירה',
    rows: [
      row(
        allSale ? 'מחיר' : 'שכר דירה לחודש',
        mixed ? 'none' : 'lower',
        map(results, (r) => ({ text: shekel(r.property.price), value: r.property.price })),
      ),
      ...(allSale
        ? [
            row(
              'מחיר למ״ר',
              'lower',
              map(results, (r) => ({
                text: r.economics.ppsm !== null ? shekel(r.economics.ppsm) : '—',
                value: r.economics.ppsm,
              })),
            ),
            row(
              'פער מול חציון האזור',
              'lower',
              map(results, (r) => ({
                text:
                  r.economics.deltaVsArea !== null
                    ? pct(r.economics.deltaVsArea)
                    : r.economics.comparableBasis === 'thin'
                      ? `מדגם קטן (${r.property.marketSampleSize})`
                      : 'אין בסיס',
                value: r.economics.deltaVsArea,
              })),
              'פער מוצג רק כשהמדגם מספיק כדי לגזור ממנו אחוז.',
            ),
          ]
        : []),
    ],
  });

  groups.push({
    title: 'הנכס',
    rows: [
      row('שטח בנוי', 'higher', prop(results, (p) => ({ text: `${p.sqm} מ״ר`, value: p.sqm }))),
      row('חדרים', 'higher', prop(results, (p) => ({ text: String(p.rooms), value: p.rooms }))),
      row('מרפסת', 'higher', prop(results, (p) => ({ text: p.balconySqm > 0 ? `${p.balconySqm} מ״ר` : 'אין', value: p.balconySqm }))),
      row('קומה', 'none', prop(results, (p) => text(p.floor === 0 ? 'קרקע' : `${p.floor} מתוך ${p.floorsInBuilding}`))),
      row('שנת בנייה', 'higher', prop(results, (p) => ({ text: String(p.builtYear), value: p.builtYear }))),
      row('מצב', 'none', prop(results, (p) => text(CONDITION_LABEL[p.condition]))),
      row('כיווני אוויר', 'none', prop(results, (p) => text(p.aspects || '—'))),
    ],
  });

  groups.push({
    title: 'מאפיינים',
    rows: [
      row('מעלית', 'higher', prop(results, (p) => yesNo(p.features.elevator))),
      row('חניות', 'higher', prop(results, (p) => ({ text: String(p.features.parking), value: p.features.parking }))),
      row('ממ״ד', 'higher', prop(results, (p) => yesNo(p.features.mamad))),
      row('מחסן', 'higher', prop(results, (p) => yesNo(p.features.storage))),
      row('גישה לנכים', 'higher', prop(results, (p) => yesNo(p.features.accessible))),
      row('כניסה נפרדת', 'none', prop(results, (p) => yesNo(p.features.separateEntrance))),
      row('מיזוג', 'none', prop(results, (p) => text(p.features.ac))),
    ],
  });

  groups.push({
    title: 'עלות חודשית',
    rows: [
      ...(allSale
        ? [row('החזר משכנתא', 'lower', map(results, (r) => ({ text: shekel(r.economics.monthlyMortgage ?? 0), value: r.economics.monthlyMortgage ?? null })))]
        : [row('שכר דירה', 'lower', prop(results, (p) => ({ text: shekel(p.price), value: p.price })))]),
      row('ארנונה', 'lower', prop(results, (p) => ({ text: shekel(p.arnona), value: p.arnona }))),
      row('ועד בית', 'lower', prop(results, (p) => ({ text: shekel(p.vaad), value: p.vaad }))),
      ...(allSale ? [] : [row('חשמל ומים', 'lower', prop(results, (p) => ({ text: shekel(p.utilities), value: p.utilities })))]),
      row('סה״כ לחודש', mixed ? 'none' : 'lower', map(results, (r) => ({ text: shekel(r.economics.monthlyAllIn), value: r.economics.monthlyAllIn }))),
    ],
  });

  if (allSale) {
    groups.push({
      title: 'עלות כניסה',
      rows: [
        row('מס רכישה', 'lower', map(results, (r) => ({ text: shekel(r.economics.tax?.amount ?? 0), value: r.economics.tax?.amount ?? null }))),
        row('עו״ד', 'lower', map(results, (r) => ({ text: shekel(r.economics.closing?.lawyer ?? 0), value: r.economics.closing?.lawyer ?? null }))),
        row('תיווך', 'lower', map(results, (r) => ({ text: r.economics.closing?.agent ? shekel(r.economics.closing.agent) : '—', value: r.economics.closing?.agent ?? null }))),
        row('סה״כ עלות כניסה', 'lower', map(results, (r) => ({ text: shekel(r.economics.acquisitionTotal ?? 0), value: r.economics.acquisitionTotal ?? null }))),
        row('הון עצמי נדרש', 'lower', map(results, (r) => ({ text: shekel(r.economics.equityRequired ?? 0), value: r.economics.equityRequired ?? null }))),
      ],
    });

    groups.push({
      title: 'השקעה',
      rows: [
        row('שכ״ד צפוי', 'higher', prop(results, (p) => ({ text: shekel(p.expectedMonthlyRent), value: p.expectedMonthlyRent }))),
        row('תשואה ברוטו', 'higher', map(results, (r) => ({ text: pct(r.economics.grossYield ?? 0, 2), value: r.economics.grossYield ?? null }))),
        row('תשואה נטו', 'higher', map(results, (r) => ({ text: pct(r.economics.netYield ?? 0, 2), value: r.economics.netYield ?? null }))),
        row('תזרים חודשי', 'higher', map(results, (r) => ({ text: shekel(r.economics.monthlyCashflow ?? 0), value: r.economics.monthlyCashflow ?? null }))),
      ],
    });
  }

  groups.push({
    title: 'רישום ותכנון',
    rows: [
      row('סוג רישום', 'none', prop(results, (p) => text(`${REGISTRY_LABEL[p.registryKind]} · ${p.tenure === 'lease' ? 'חכירה' : 'בעלות'}`))),
      row('הערות אזהרה', 'lower', prop(results, (p) => ({ text: p.caveats === 0 ? 'לא נמצאו' : String(p.caveats), value: p.caveats }))),
      row('משכנתאות רשומות', 'lower', prop(results, (p) => ({ text: String(p.mortgages), value: p.mortgages }))),
      row('אומת מול נסח', 'higher', prop(results, (p) => ({ text: p.registryVerified ? 'אומת' : 'לא אומת', value: p.registryVerified ? 1 : 0 }))),
      row('היתר פיצול', 'none', prop(results, (p) => text(p.splitPermit === null ? 'לא רלוונטי' : p.splitPermit === 'granted' ? 'קיים' : p.splitPermit === 'none' ? 'אין' : 'לא אותר'))),
      row('התחדשות עירונית', 'none', prop(results, (p) => text(p.urbanRenewal ?? 'אין'))),
      row('חשיפה להיטל השבחה', 'none', prop(results, (p) => text(p.bettermentRisk ? BETTERMENT_LABEL[p.bettermentRisk] : '—'))),
    ],
  });

  groups.push({
    title: 'סביבה',
    rows: [
      row('תחבורה ציבורית', 'lower', prop(results, (p) => ({ text: `${p.walkTransitMin} דק׳`, value: p.walkTransitMin }))),
      row('בית ספר', 'lower', prop(results, (p) => ({ text: `${p.walkSchoolMin} דק׳`, value: p.walkSchoolMin }))),
      row('פארק', 'lower', prop(results, (p) => ({ text: `${p.walkParkMin} דק׳`, value: p.walkParkMin }))),
    ],
  });

  groups.push({
    title: 'מקור ומטא',
    rows: [
      row('דגלים אדומים', 'lower', map(results, (r) => {
        const n = r.flags.filter((f) => f.level === 'crit').length;
        return { text: n === 0 ? 'אין' : String(n), value: n };
      })),
      row('דגלי בדיקה', 'lower', map(results, (r) => {
        const n = r.flags.filter((f) => f.level === 'warn').length;
        return { text: n === 0 ? 'אין' : String(n), value: n };
      })),
      row('ימים בשוק', 'none', prop(results, (p) => ({ text: String(p.daysOnMarket), value: p.daysOnMarket })), 'יותר ימים בשוק זה מרחב למשא ומתן וגם סימן שאלה — אין כאן „טוב יותר”.'),
      row('מפרסם', 'none', prop(results, (p) => text(p.publisherKind === 'agency' ? `תיווך ${p.agentFeePct}%` : 'פרטי'))),
      row('תאריך כניסה', 'none', prop(results, (p) => text(p.availableFrom))),
      row('מקור נתוני שוק', 'none', prop(results, (p) => text(p.marketSourceId === 'manual' ? 'הוזן ידנית' : p.marketSourceId))),
      row('מדגם עסקאות', 'higher', prop(results, (p) => ({ text: p.marketSampleSize > 0 ? `${num(p.marketSampleSize)} עסקאות` : '—', value: p.marketSampleSize || null }))),
    ],
  });

  return groups;
}
