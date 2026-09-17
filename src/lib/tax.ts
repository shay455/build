import type { BuyerProfile } from '@/types/property';

/**
 * Israeli purchase tax (mas rechisha).
 *
 * Amounts are the 16.1.2025 vintage, frozen by the 2025 Arrangements Law and
 * republished unchanged by ITA purchase-tax circular 1/2026 (18.1.2026) for
 * 16.1.2025–15.1.2028. Re-verify after 15.1.2028.
 *
 * The 8%/10% additional-home rates are a temporary order under s.9(c1f) in force
 * through 31.12.2026. See ADDITIONAL_HOME_ORDER_EXPIRES.
 */
export const TAX_AMOUNTS = {
  /** s.9(c1c)(3)(a) — the 0% ceiling for a single home. */
  A: 1_978_745,
  B: 2_347_040,
  C: 6_055_070,
  D: 20_183_565,
  /** Regulation 11 is a cliff at this value, not a bracket edge. */
  REG11_CLIFF: 2_500_000,
} as const;

export const ADDITIONAL_HOME_ORDER_EXPIRES = '2026-12-31';
export const AMOUNTS_FROZEN_UNTIL = '2028-01-15';

export interface TaxBracket {
  from: number;
  to: number;
  rate: number;
  base: number;
  amount: number;
}

export interface TaxResult {
  track: BuyerProfile;
  amount: number;
  effectiveRate: number;
  brackets: TaxBracket[];
  /** Set when an oleh's price exceeds the Regulation 12a value ceiling and the relief is lost entirely. */
  reliefCeilingLost?: boolean;
  /** Set when a Regulation 11 purchase is over the cliff and 0.5% applies to the whole value. */
  cliffApplied?: boolean;
  notes: string[];
}

type Ladder = ReadonlyArray<readonly [from: number, to: number, rate: number]>;

const SINGLE: Ladder = [
  [0, TAX_AMOUNTS.A, 0],
  [TAX_AMOUNTS.A, TAX_AMOUNTS.B, 0.035],
  [TAX_AMOUNTS.B, TAX_AMOUNTS.C, 0.05],
  [TAX_AMOUNTS.C, TAX_AMOUNTS.D, 0.08],
  [TAX_AMOUNTS.D, Infinity, 0.1],
];

const ADDITIONAL: Ladder = [
  [0, TAX_AMOUNTS.C, 0.08],
  [TAX_AMOUNTS.C, Infinity, 0.1],
];

/** Regulation 12a, in force from 15.8.2024. Capped at TAX_AMOUNTS.D — above it the relief does not apply at all. */
const OLEH: Ladder = [
  [0, TAX_AMOUNTS.A, 0],
  [TAX_AMOUNTS.A, TAX_AMOUNTS.C, 0.005],
  [TAX_AMOUNTS.C, TAX_AMOUNTS.D, 0.08],
];

const REG11_SINGLE: Ladder = [
  [0, TAX_AMOUNTS.A, 0],
  [TAX_AMOUNTS.A, Infinity, 0.005],
];

const REG11_FLAT: Ladder = [[0, Infinity, 0.005]];

function applyLadder(price: number, ladder: Ladder): { amount: number; brackets: TaxBracket[] } {
  const brackets: TaxBracket[] = [];
  let amount = 0;
  for (const [from, to, rate] of ladder) {
    if (price <= from) break;
    const base = Math.min(price, to) - from;
    const bracketAmount = base * rate;
    amount += bracketAmount;
    brackets.push({ from, to, rate, base, amount: bracketAmount });
  }
  return { amount, brackets };
}

/**
 * Estimated purchase tax. Not a binding computation — a real transaction needs a
 * tax adviser, and the ITA simulator is the authority.
 *
 * @param price   Contract price in NIS.
 * @param profile Buyer profile. `upgrade` returns the single-home ladder; the caller
 *                is responsible for surfacing the sell-within-the-window condition.
 */
export function purchaseTax(price: number, profile: BuyerProfile): TaxResult {
  if (!Number.isFinite(price) || price < 0) throw new RangeError('price must be a non-negative number');

  const notes: string[] = [];
  let result: { amount: number; brackets: TaxBracket[] };
  let reliefCeilingLost: boolean | undefined;
  let cliffApplied: boolean | undefined;

  switch (profile) {
    case 'single':
      result = applyLadder(price, SINGLE);
      break;

    case 'upgrade':
      result = applyLadder(price, SINGLE);
      notes.push(
        'מסלול דירה יחידה מותנה במכירת הדירה הקיימת בחלון הסטטוטורי (ככלל 24 חודשים; 12 חודשים מקבלן ממועד המסירה החוזי) והצהרה על כך בדיווח.',
      );
      break;

    case 'additional':
      result = applyLadder(price, ADDITIONAL);
      notes.push(
        `שיעורי 8%/10% הם הוראת שעה בתוקף עד ${ADDITIONAL_HOME_ORDER_EXPIRES}. יש לאמת הארכה לפני הסתמכות על שיעור זה לאחר מכן.`,
      );
      break;

    case 'oleh':
      if (price > TAX_AMOUNTS.D) {
        // Regulation 12a does not apply at all above the ceiling — the ordinary
        // ladder applies to the full price, not the oleh ladder with a 10% top band.
        result = applyLadder(price, SINGLE);
        reliefCeilingLost = true;
        notes.push(
          `שווי הנכס עולה על ${TAX_AMOUNTS.D.toLocaleString('he-IL')} ₪, ולכן הקלת תקנה 12א אינה חלה כלל והחישוב הוא לפי המדרגות הרגילות על מלוא השווי.`,
        );
      } else {
        result = applyLadder(price, OLEH);
        notes.push(
          'ההטבה ניתנת פעם אחת בלבד, לדירת מגורים יחידה ולא להשקעה, משנה לפני העלייה ועד שבע שנים אחריה.',
        );
      }
      break;

    case 'reg11':
      if (price <= TAX_AMOUNTS.REG11_CLIFF) {
        result = applyLadder(price, REG11_SINGLE);
      } else {
        result = applyLadder(price, REG11_FLAT);
        cliffApplied = true;
        notes.push(
          `מעל ${TAX_AMOUNTS.REG11_CLIFF.toLocaleString('he-IL')} ₪ שיעור 0.5% חל על מלוא השווי ולא רק על היתרה — זהו מצוק ולא מדרגה.`,
        );
      }
      notes.push(
        'המסלול ניתן לרכישה לשם מגורים בלבד, פעמיים בחיים לכל היותר, ודורש בקשה לפטור חלקי מול רשות המסים (ולעיתים ועדה רפואית של ביטוח לאומי).',
      );
      break;

    default: {
      const exhaustive: never = profile;
      throw new Error(`unknown buyer profile: ${String(exhaustive)}`);
    }
  }

  return {
    track: profile,
    amount: result.amount,
    effectiveRate: price > 0 ? result.amount / price : 0,
    brackets: result.brackets,
    reliefCeilingLost,
    cliffApplied,
    notes,
  };
}
