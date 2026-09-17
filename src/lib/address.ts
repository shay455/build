/**
 * Hebrew address normalisation.
 *
 * Israeli addresses are written many ways for the same place: "רח' ויטל 14",
 * "רחוב ויטל 14 ת״א", "ויטל 14, תל אביב-יפו, דירה 3". Matching on the raw string
 * fails constantly, so everything is reduced to a canonical form before comparison.
 */

/** Street-type prefixes that carry no identity and only get in the way of matching. */
const STREET_PREFIXES = [
  'רחוב',
  'רח׳',
  "רח'",
  'רח',
  'שדרות',
  'שדרת',
  'שד׳',
  "שד'",
  'סמטת',
  'סמטה',
  'דרך',
  'כיכר',
  'ככר',
  'מעלה',
  'נתיב',
];

/** Sub-unit detail: real, but not part of the parcel address. */
const UNIT_MARKERS = ['דירה', 'דירת', 'כניסה', 'קומה', 'בניין', 'בנין', 'מספר', "מס'", 'מס׳'];

export const CITY_ALIASES: Record<string, string> = {
  'תל אביב': 'תל אביב-יפו',
  'תל אביב יפו': 'תל אביב-יפו',
  'ת״א': 'תל אביב-יפו',
  'ת"א': 'תל אביב-יפו',
  'ב״ש': 'באר שבע',
  'ב"ש': 'באר שבע',
  'פ״ת': 'פתח תקווה',
  'פ"ת': 'פתח תקווה',
  'פתח תקוה': 'פתח תקווה',
  'ראשל״צ': 'ראשון לציון',
  'ראשל"צ': 'ראשון לציון',
  'ק״ג': 'קריית גת',
  'קרית גת': 'קריית גת',
  'קרית ביאליק': 'קריית ביאליק',
  'קרית אתא': 'קריית אתא',
  'קרית מוצקין': 'קריית מוצקין',
  'קרית ים': 'קריית ים',
  'ירושלים עיר': 'ירושלים',
};

/** Unify the several apostrophe and quote characters Hebrew text uses interchangeably. */
export function normaliseQuotes(s: string): string {
  return s.replace(/[״”“"]/g, '"').replace(/[׳’‘']/g, "'");
}

/** Lowercase-equivalent for Hebrew: strip niqqud, unify quotes, collapse whitespace and punctuation. */
export function canonical(s: string): string {
  return normaliseQuotes(s)
    .replace(/[֑-ׇ]/g, '')
    .replace(/[.,;:()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParsedAddress {
  /** Street name with prefixes and unit detail removed. Empty when none could be found. */
  street: string;
  /** House number, including a letter suffix such as "12א". Null when absent. */
  houseNumber: string | null;
  /** Canonical city name when one was recognised. */
  city: string | null;
  /** Everything that was dropped, so a caller can show what it ignored. */
  dropped: string[];
}

function stripStreetPrefix(s: string): string {
  const c = canonical(s);
  for (const prefix of STREET_PREFIXES) {
    const p = canonical(prefix);
    if (c === p) continue;
    if (c.startsWith(`${p} `)) return c.slice(p.length + 1).trim();
  }
  return c;
}

/**
 * Split a free-form Hebrew address into street, number and city.
 *
 * @param raw          What the user typed.
 * @param knownCities  Cities the index knows, matched longest-first so
 *                     "קריית ביאליק" beats a city that is a prefix of it.
 */
export function parseAddress(raw: string, knownCities: readonly string[] = []): ParsedAddress {
  const dropped: string[] = [];
  let text = canonical(raw);
  if (!text) return { street: '', houseNumber: null, city: null, dropped };

  // City first: removing it leaves a cleaner street fragment behind.
  let city: string | null = null;
  const candidates: Array<[needle: string, canonicalName: string]> = [
    ...Object.entries(CITY_ALIASES).map(([k, v]) => [canonical(k), v] as [string, string]),
    ...knownCities.map((c) => [canonical(c), c] as [string, string]),
  ].sort((a, b) => b[0].length - a[0].length);

  for (const [needle, name] of candidates) {
    if (!needle) continue;
    const at = text.indexOf(needle);
    if (at === -1) continue;
    // Must not be a fragment of a longer word.
    const before = at === 0 ? ' ' : text[at - 1];
    const after = text[at + needle.length] ?? ' ';
    if (/[֐-׿]/.test(before) || /[֐-׿]/.test(after)) continue;
    city = name;
    text = `${text.slice(0, at)} ${text.slice(at + needle.length)}`.replace(/\s+/g, ' ').trim();
    break;
  }

  // Unit detail: "דירה 3", "כניסה א", "קומה 2" — drop the marker and its argument.
  for (const marker of UNIT_MARKERS) {
    const m = canonical(marker);
    const re = new RegExp(`(^|\\s)${m}\\s*\\S*`, 'g');
    text = text.replace(re, (match) => {
      const t = match.trim();
      if (t) dropped.push(t);
      return ' ';
    });
  }
  text = text.replace(/\s+/g, ' ').trim();

  // House number: a standalone number, optionally with a Hebrew letter suffix.
  let houseNumber: string | null = null;
  const numMatch = text.match(/(?:^|\s)(\d+\s*[א-ת]?)(?=\s|$)/);
  if (numMatch) {
    houseNumber = numMatch[1].replace(/\s+/g, '');
    text = `${text.slice(0, numMatch.index)} ${text.slice((numMatch.index ?? 0) + numMatch[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  const street = stripStreetPrefix(text);
  return { street, houseNumber, city, dropped };
}

/**
 * The key two addresses must share to be the same building.
 * House number is included: neighbouring buildings on one street sit on different parcels.
 */
export function addressKey(city: string, street: string, houseNumber: string | null): string {
  const s = stripStreetPrefix(street);
  return `${canonical(city)}|${s}|${houseNumber ?? ''}`;
}

/** Build the key from a stored property's `city` and `street` fields. */
export function addressKeyFromStored(city: string, storedStreet: string): string {
  const parsed = parseAddress(storedStreet);
  return addressKey(city, parsed.street, parsed.houseNumber);
}
