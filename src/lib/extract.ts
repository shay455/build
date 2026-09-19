import { normaliseText, parseAddress } from './address';
import { focusListingRegion } from './focus';
import type { AssetType, Condition, Deal } from '@/types/property';

/**
 * How sure the extractor is about a field.
 * - `explicit` the text labelled it ("שנת בנייה 1998", "ארנונה 640")
 * - `inferred` it was read from context ("3 חדרים", a bare amount taken as the price)
 * - `guessed`  a default that the user should look at
 */
export type Confidence = 'explicit' | 'inferred' | 'guessed';

export interface Extracted<T> {
  value: T;
  confidence: Confidence;
  /** The span of source text this came from, so the UI can show its working. */
  evidence: string;
}

export interface ExtractedListing {
  /** Set when a whole-page paste was narrowed to the listing region. */
  focus?: { narrowed: boolean; dropped: number };
  deal?: Extracted<Deal>;
  price?: Extracted<number>;
  assetType?: Extracted<AssetType>;
  rooms?: Extracted<number>;
  sqm?: Extracted<number>;
  balconySqm?: Extracted<number>;
  floor?: Extracted<number>;
  floorsInBuilding?: Extracted<number>;
  builtYear?: Extracted<number>;
  condition?: Extracted<Condition>;
  city?: Extracted<string>;
  street?: Extracted<string>;
  gush?: Extracted<number>;
  helka?: Extracted<number>;
  arnona?: Extracted<number>;
  vaad?: Extracted<number>;
  availableFrom?: Extracted<string>;
  features: Partial<Record<FeatureName, Extracted<boolean | number>>>;
  /** Field names the text did not supply, so the form can highlight them. */
  missing: string[];
}

export type FeatureName =
  | 'elevator'
  | 'parking'
  | 'mamad'
  | 'storage'
  | 'furnished'
  | 'accessible'
  | 'separateEntrance'
  | 'bars';

/** Fields a property cannot be saved without. */
export const REQUIRED_FIELDS = ['price', 'city', 'rooms', 'sqm', 'builtYear', 'gush', 'helka'] as const;

const num = (s: string): number => Number(s.replace(/[,\s]/g, ''));

/** Hebrew listings write amounts in several ways: 3,150,000 / 3.15 מיליון / 3150 אלף / ₪3150000. */
function parseAmount(raw: string, unit?: string): number {
  let v = Number(raw.replace(/[,\s]/g, ''));
  if (!Number.isFinite(v)) return NaN;
  if (unit && /מיליון|מליון|מ׳/.test(unit)) v *= 1_000_000;
  else if (unit && /אלף|k|K/.test(unit)) v *= 1_000;
  return v;
}

const ASSET_WORDS: Array<[RegExp, AssetType]> = [
  [/יחידת\s*דיור|יח[״"׳']?ד\b/, 'housingUnit'],
  [/סטודיו/, 'studio'],
  [/פנטהאוז|פנטהאוס/, 'penthouse'],
  [/דירת\s*גן/, 'garden'],
  [/בית\s*פרטי|וילה/, 'house'],
  [/דו[\s־-]*משפחתי|קוטג[׳']?/, 'duplex'],
  [/מגרש|מגרשים/, 'lot'],
  [/דירה|דירת/, 'apartment'],
];

const CONDITION_WORDS: Array<[RegExp, Condition]> = [
  [/חדשה?\s*מקבלן|חדשה?\s*לגמרי|מעולם\s*לא\s*גרו/, 'new'],
  [/משופצ(?:ת|ה|)|שופצה|אחרי\s*שיפוץ/, 'renovated'],
  [/דורש(?:ת)?\s*שיפוץ|זקוקה?\s*לשיפוץ|לשיפוץ/, 'needsWork'],
  [/שמור(?:ה|ת)?|מתוחזקת/, 'kept'],
];

/** Words that flip the meaning of a feature mentioned right after them. */
const NEGATORS = /(?:ללא|בלי|אין|לא)\s*$/;

interface FeatureSpec {
  name: FeatureName;
  pattern: RegExp;
  /** Reads a count rather than a yes/no, e.g. "2 חניות". */
  counted?: boolean;
}

const FEATURES: FeatureSpec[] = [
  { name: 'elevator', pattern: /מעלית/ },
  { name: 'parking', pattern: /חני(?:ה|יה|ות|ות\s*תת[\s־-]*קרקעיות)/, counted: true },
  { name: 'mamad', pattern: /ממ[״"׳']?ד|ממד\b|מרחב\s*מוגן/ },
  { name: 'storage', pattern: /מחסן/ },
  { name: 'furnished', pattern: /מרוהט(?:ת|)/ },
  { name: 'accessible', pattern: /גישה\s*לנכים|נגיש(?:ה|)\s*לנכים|מונגש(?:ת|)/ },
  { name: 'separateEntrance', pattern: /כניסה\s*נפרדת/ },
  { name: 'bars', pattern: /סורגים/ },
];

/** Did a negation word appear immediately before this match? */
function isNegated(text: string, index: number): boolean {
  return NEGATORS.test(text.slice(Math.max(0, index - 12), index));
}

/**
 * Pull a property out of free Hebrew listing text.
 *
 * Built for what people actually paste: a Yad2 description, a Facebook group post,
 * a WhatsApp forward, a video caption. Every field carries its confidence and the
 * span it came from, because the user is going to check this — an extractor that
 * silently guesses is worse than one that admits what it could not find.
 *
 * @param text        The pasted listing.
 * @param knownCities Cities the index already knows, which improves city matching.
 */
export function extractListing(text: string, knownCities: readonly string[] = []): ExtractedListing {
  const out: ExtractedListing = { features: {}, missing: [] };
  // A pasted page is mostly not the listing. Narrow before reading anything.
  const focus = focusListingRegion(text);
  out.focus = { narrowed: focus.narrowed, dropped: focus.dropped };
  const t = focus.text;
  if (!t) {
    out.missing = [...REQUIRED_FIELDS];
    return out;
  }

  // --- deal type
  if (/להשכרה|להשכיר|שכירות|מושכרת/.test(t)) {
    out.deal = { value: 'rent', confidence: 'explicit', evidence: t.match(/להשכרה|להשכיר|שכירות|מושכרת/)![0] };
  } else if (/למכירה|למכור|נמכרת/.test(t)) {
    out.deal = { value: 'sale', confidence: 'explicit', evidence: t.match(/למכירה|למכור|נמכרת/)![0] };
  }

  // --- asset type
  for (const [pattern, type] of ASSET_WORDS) {
    const m = t.match(pattern);
    if (m) {
      out.assetType = { value: type, confidence: 'explicit', evidence: m[0] };
      break;
    }
  }

  // --- rooms
  const rooms = t.match(/(\d+(?:[.,]5)?)\s*(?:חדרים|חדר|חד[״"׳']?)/);
  if (rooms) {
    out.rooms = { value: parseFloat(rooms[1].replace(',', '.')), confidence: 'explicit', evidence: rooms[0] };
  }

  // --- built area, and the balcony separately so one does not swallow the other
  const balcony = t.match(/מרפסת(?:\s*שמש)?\s*(?:של\s*)?(\d+)\s*מ[״"׳']?ר/);
  if (balcony) {
    out.balconySqm = { value: num(balcony[1]), confidence: 'explicit', evidence: balcony[0] };
  }
  // Exclude by position, not by text: the balcony match is "מרפסת שמש 14 מ״ר" while
  // the area match inside it is just "14 מ״ר", so comparing the strings never excludes it.
  const balconySpan =
    balcony?.index === undefined ? null : { from: balcony.index, to: balcony.index + balcony[0].length };
  const sqmMatches = [...t.matchAll(/(\d+)\s*מ[״"׳']?ר/g)].filter(
    (m) => balconySpan === null || m.index === undefined || m.index < balconySpan.from || m.index >= balconySpan.to,
  );
  if (sqmMatches.length > 0) {
    // The FIRST area quoted, not the largest. A listing states its own size early;
    // taking the maximum picks up a bigger property from a "similar listings" rail
    // that survived narrowing.
    out.sqm = { value: num(sqmMatches[0][1]), confidence: 'explicit', evidence: sqmMatches[0][0] };
  }

  // --- floor
  const ground = t.match(/קומת\s*קרקע|קומה\s*0\b/);
  const floor = t.match(/קומה\s*(\d+)/);
  if (ground) out.floor = { value: 0, confidence: 'explicit', evidence: ground[0] };
  else if (floor) out.floor = { value: num(floor[1]), confidence: 'explicit', evidence: floor[0] };

  const outOf = t.match(/(?:מתוך|מ־|מתוך\s*סה[״"׳']?כ)\s*(\d+)\s*(?:קומות)?/);
  if (outOf) out.floorsInBuilding = { value: num(outOf[1]), confidence: 'explicit', evidence: outOf[0] };

  // --- year
  const year = t.match(/(?:שנת\s*בני(?:י|)ה|נבנ(?:ה|תה)\s*(?:ב־|ב|בשנת)?|משנת)\s*(\d{4})/);
  if (year) out.builtYear = { value: num(year[1]), confidence: 'explicit', evidence: year[0] };

  // --- condition
  for (const [pattern, condition] of CONDITION_WORDS) {
    const m = t.match(pattern);
    if (m) {
      out.condition = { value: condition, confidence: 'explicit', evidence: m[0] };
      break;
    }
  }

  // --- labelled recurring costs, taken before the price so they cannot be mistaken for it
  const arnona = t.match(/ארנונה\s*(?:של\s*|בסך\s*)?[₪]?\s*([\d,]+)/);
  if (arnona) out.arnona = { value: num(arnona[1]), confidence: 'explicit', evidence: arnona[0] };

  const vaad = t.match(/ועד\s*(?:ה)?בית\s*(?:של\s*|בסך\s*)?[₪]?\s*([\d,]+)/);
  if (vaad) out.vaad = { value: num(vaad[1]), confidence: 'explicit', evidence: vaad[0] };

  // --- price
  const labelled = t.match(
    /(?:מחיר|מבקשים|מחיר\s*מבוקש|עלות|שכ[״"׳']?ד|שכר\s*דירה)\s*[:]?\s*[₪]?\s*([\d,.]+)\s*(מיליון|מליון|אלף|₪|ש[״"׳']?ח|שקל(?:ים)?)?/,
  );
  // A currency marker, or thousands grouping, which on its own marks an amount:
  // "2,400,000" in a listing is a price, not a year or a phone number.
  const anyAmount = [
    ...t.matchAll(
      /[₪]\s*([\d,.]+)|([\d,.]+)\s*(מיליון|מליון|אלף|₪|ש[״"׳']?ח|שקל(?:ים)?)|(\d{1,3}(?:,\d{3})+)/g,
    ),
  ];

  if (labelled) {
    const v = parseAmount(labelled[1], labelled[2]);
    if (Number.isFinite(v) && v > 0) out.price = { value: v, confidence: 'explicit', evidence: labelled[0] };
  }
  if (!out.price && anyAmount.length > 0) {
    // Unlabelled: take the largest amount that is not one of the costs already read.
    const excluded = new Set([out.arnona?.value, out.vaad?.value]);
    const candidates = anyAmount
      .map((m) => ({ value: parseAmount(m[1] ?? m[2] ?? m[4], m[3]), evidence: m[0] }))
      .filter((c) => Number.isFinite(c.value) && c.value > 0 && !excluded.has(c.value));
    if (candidates.length > 0) {
      const best = candidates.reduce((a, b) => (b.value > a.value ? b : a));
      out.price = { value: best.value, confidence: 'inferred', evidence: best.evidence.trim() };
    }
  }

  // --- location
  const parsed = parseAddress(t, knownCities);
  if (parsed.city) out.city = { value: parsed.city, confidence: 'explicit', evidence: parsed.city };

  // The street needs a bounded search. parseAddress treats whatever is left after
  // the city as the street name, which on a paragraph-long post is the whole post.
  // A street name is one or two Hebrew words and usually carries a number; capping
  // it that way is what stops a match running through a post hunting for a digit.
  const STREET_WORD = "[\\u0590-\\u05FF׳'\"-]+";
  const ANCHOR = "(?:רחוב|רח[׳'\"]|שדרות|שדרת|שד[׳'\"]|דרך|סמטת)";
  const NAME = `(${STREET_WORD}(?:\\s${STREET_WORD})?)`;

  const withNumber = t.match(
    new RegExp(`${ANCHOR}\\s+${NAME}\\s+(\\d{1,4}[\\u05D0-\\u05EA]?)(?![\\u0590-\\u05FF\\d])`, 'u'),
  );
  const withoutNumber = withNumber ? null : t.match(new RegExp(`${ANCHOR}\\s+${NAME}`, 'u'));

  if (withNumber) {
    out.street = {
      value: `${withNumber[1].trim()} ${withNumber[2]}`,
      confidence: 'explicit',
      evidence: withNumber[0].trim(),
    };
  } else if (withoutNumber) {
    out.street = {
      value: withoutNumber[1].trim(),
      confidence: 'explicit',
      evidence: withoutNumber[0].trim(),
    };
  } else if (parsed.street && parsed.street.split(/\s+/).length <= 3 && parsed.street.length <= 30) {
    // No street-type word, but the input was short enough to be a bare address.
    const street = parsed.houseNumber ? `${parsed.street} ${parsed.houseNumber}` : parsed.street;
    out.street = { value: street, confidence: 'inferred', evidence: street };
  }

  const gush = t.match(/גוש\s*(\d{3,6})/);
  if (gush) out.gush = { value: num(gush[1]), confidence: 'explicit', evidence: gush[0] };
  const helka = t.match(/חלקה\s*(\d{1,4})/);
  if (helka) out.helka = { value: num(helka[1]), confidence: 'explicit', evidence: helka[0] };

  // --- entry date
  const immediate = t.match(/כניסה\s*מיידית|מיידי|פנויה?\s*מיד/);
  const dated = t.match(/(?:כניסה|פינוי|כניסה\s*ב)\s*(?:ב־|ב|מ־|מ)?\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/);
  if (immediate) out.availableFrom = { value: 'מיידי', confidence: 'explicit', evidence: immediate[0] };
  else if (dated) out.availableFrom = { value: dated[1], confidence: 'explicit', evidence: dated[0] };

  // --- features, with negation
  for (const spec of FEATURES) {
    const m = spec.pattern.exec(t);
    if (!m || m.index === undefined) continue;
    const negated = isNegated(t, m.index);

    if (spec.counted) {
      const counted = t.match(new RegExp(`(\\d+)\\s*${spec.pattern.source}`));
      const value = negated ? 0 : counted ? num(counted[1]) : 1;
      out.features[spec.name] = { value, confidence: 'explicit', evidence: counted?.[0] ?? m[0] };
    } else {
      out.features[spec.name] = { value: !negated, confidence: 'explicit', evidence: m[0] };
    }
  }
  // A stated balcony area implies a balcony even where the word stands alone.
  if (out.balconySqm && !out.balconySqm.value) delete out.balconySqm;

  out.missing = REQUIRED_FIELDS.filter((f) => out[f] === undefined);
  return out;
}
