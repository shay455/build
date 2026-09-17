import type { AssetType, Deal } from '@/types/property';

/** A parsed search intent. Every field is optional — the UI shows what was understood. */
export interface SearchQuery {
  deal?: Deal;
  city?: string;
  assetType?: AssetType;
  roomsMin?: number;
  priceMin?: number;
  priceMax?: number;
  sqmMin?: number;
  yieldMin?: number;
  features?: FeatureKey[];
  investor?: boolean;
}

export type FeatureKey =
  | 'elevator'
  | 'parking'
  | 'mamad'
  | 'balcony'
  | 'storage'
  | 'accessible'
  | 'furnished'
  | 'separateEntrance';

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  elevator: 'מעלית',
  parking: 'חניה',
  mamad: 'ממ״ד',
  balcony: 'מרפסת',
  storage: 'מחסן',
  accessible: 'גישה לנכים',
  furnished: 'מרוהט',
  separateEntrance: 'כניסה נפרדת',
};

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  apartment: 'דירה',
  garden: 'דירת גן',
  penthouse: 'פנטהאוז',
  studio: 'סטודיו',
  housingUnit: 'יחידת דיור',
  house: 'בית פרטי',
  duplex: 'דו־משפחתי',
  lot: 'מגרש',
};

/** Israeli city names are written many ways; normalise the common short forms. */
const CITY_ALIASES: Array<[alias: string, canonical: string]> = [
  ['תל אביב', 'תל אביב-יפו'],
  ['ת״א', 'תל אביב-יפו'],
  ['ת"א', 'תל אביב-יפו'],
  ['ב״ש', 'באר שבע'],
  ['ב"ש', 'באר שבע'],
  ['פ״ת', 'פתח תקווה'],
  ['ראשל״צ', 'ראשון לציון'],
  ['ק. ביאליק', 'קריית ביאליק'],
];

const TYPE_WORDS: Array<[word: string, type: AssetType]> = [
  ['יחידת דיור', 'housingUnit'],
  ['סטודיו', 'studio'],
  ['פנטהאוז', 'penthouse'],
  ['דירת גן', 'garden'],
  ['בית פרטי', 'house'],
  ['דו משפחתי', 'duplex'],
  ['דו־משפחתי', 'duplex'],
  ['מגרש', 'lot'],
];

const FEATURE_WORDS: Array<[word: string, key: FeatureKey]> = [
  ['מעלית', 'elevator'],
  ['חניה', 'parking'],
  ['חנייה', 'parking'],
  ['ממ״ד', 'mamad'],
  ['ממ"ד', 'mamad'],
  ['ממד', 'mamad'],
  ['מרפסת', 'balcony'],
  ['מחסן', 'storage'],
  ['מרוהט', 'furnished'],
  ['כניסה נפרדת', 'separateEntrance'],
  ['נגיש', 'accessible'],
  ['גישה לנכים', 'accessible'],
];

/**
 * Map a free-text Hebrew request onto search parameters.
 *
 * The result is shown back to the user as editable chips rather than applied
 * silently: an agent that hides its interpretation trains people to distrust it.
 *
 * @param text       What the user typed.
 * @param knownCities City names present in the index, matched verbatim after aliases.
 */
export function parseQuery(text: string, knownCities: readonly string[] = []): SearchQuery {
  const q: SearchQuery = {};
  const t = text.replace(/[,]/g, ' ').trim();
  if (!t) return q;

  if (/שכירות|להשכרה|לשכור|שוכר/.test(t)) q.deal = 'rent';
  if (/למכירה|לקנות|לרכוש/.test(t)) q.deal = 'sale';
  if (/להשקעה|משקיע|תשואה/.test(t)) {
    q.investor = true;
    q.deal ??= 'sale';
  }

  for (const [alias, canonical] of CITY_ALIASES) {
    if (t.includes(alias)) {
      q.city = canonical;
      break;
    }
  }
  if (!q.city) {
    // Longest match first, so "קריית ביאליק" wins over a city that is a prefix of it.
    const byLength = [...knownCities].sort((a, b) => b.length - a.length);
    for (const c of byLength) {
      if (t.includes(c)) {
        q.city = c;
        break;
      }
    }
  }

  const rooms = t.match(/(\d+(?:[.,]\d)?)\s*חדר/);
  if (rooms) q.roomsMin = parseFloat(rooms[1].replace(',', '.'));

  for (const [word, type] of TYPE_WORDS) {
    if (t.includes(word)) {
      q.assetType = type;
      break;
    }
  }

  const max = t.match(/(?:עד|מתחת ל|לא יותר מ)\s*([\d.]+)\s*(מיליון|מליון|אלף|מ׳|k|K)?/);
  if (max) {
    let v = parseFloat(max[1]);
    const unit = max[2] ?? '';
    if (/מיליון|מליון|מ׳/.test(unit)) v *= 1_000_000;
    else if (/אלף|k|K/.test(unit)) v *= 1_000;
    else if (v > 0 && v < 100) v *= 1_000_000; // "עד 3.5" in a property context means millions
    q.priceMax = v;
    // A budget in the thousands is a rent; one in the millions is a purchase.
    if (v <= 30_000) q.deal ??= 'rent';
    else q.deal ??= 'sale';
  }

  const sqm = t.match(/(\d+)\s*מ[״"׳']?ר/);
  if (sqm) q.sqmMin = parseInt(sqm[1], 10);

  const yieldMatch = t.match(/תשואה\s*(?:מעל|מ־|מ-|לפחות|של)?\s*([\d.]+)\s*%?/);
  if (yieldMatch) q.yieldMin = parseFloat(yieldMatch[1]) / 100;

  const features: FeatureKey[] = [];
  for (const [word, key] of FEATURE_WORDS) {
    if (t.includes(word) && !features.includes(key)) features.push(key);
  }
  if (features.length) q.features = features;

  return q;
}
