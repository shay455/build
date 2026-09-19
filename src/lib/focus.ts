import { normaliseText } from './address';

/**
 * Signals that a line is part of a property listing rather than page furniture.
 * Weighted: a gush/helka or a room count is far more telling than a bare amount,
 * which appears in adverts and in other listings on the same page.
 */
const SIGNALS: Array<[weight: number, pattern: RegExp]> = [
  [4, /גוש\s*\d{3,6}/],
  [3, /\d+(?:[.,]5)?\s*(?:חדרים|חדר|חד[״"׳'])/],
  [3, /\d+\s*מ[״"׳']?ר\b/],
  [3, /קומה\s*(?:\d+|קרקע)/],
  [2, /למכירה|להשכרה|להשכיר/],
  [2, /שנת\s*בני|נבנ[הת]|משנת\s*\d{4}/],
  [2, /ארנונה|ועד\s*בית/],
  [2, /מרפסת|מעלית|חני[הי]ה?|ממ[״"׳']?ד|מחסן|מרוהט/],
  [1, /[₪]|ש[״"׳']?ח|מיליון/],
  [1, /\d{1,3}(?:,\d{3})+/],
  [1, /רחוב|רח[״"׳']|שדרות|דרך/],
];

/** Below this, the text is already a listing and needs no narrowing. */
export const FOCUS_THRESHOLD = 700;

/** How many lines the window spans. A listing's details sit close together. */
const WINDOW = 14;

/**
 * Headings that begin the "you might also like" rail. Those lines carry every
 * listing signal there is — rooms, area, price — so expansion has to stop at them
 * or the window swallows a neighbouring property's figures.
 */
const SECTION_BREAK =
  /מודעות\s*(?:נוספות|דומות|אחרות)|עוד\s*מודעות|נכסים\s*(?:דומים|נוספים)|שיעניינו\s*אותך|אולי\s*יעניין|המלצות\s*עבורך/;

export interface FocusResult {
  /** The region to extract from. */
  text: string;
  /** True when the input was narrowed rather than used whole. */
  narrowed: boolean;
  /** Characters dropped, so the UI can say how much page furniture was ignored. */
  dropped: number;
}

function scoreLine(line: string): number {
  let score = 0;
  for (const [weight, pattern] of SIGNALS) {
    if (pattern.test(line)) score += weight;
  }
  return score;
}

/**
 * Narrow a whole-page paste down to the listing.
 *
 * Selecting a listing page with Cmd+A takes the navigation, the adverts, the
 * footer and — the damaging part — the other listings shown alongside. Extracting
 * from all of it picks the largest number on the page, which is somebody else's
 * asking price. Scoring lines by listing signal and keeping the densest window
 * gets back to the one property the page is actually about.
 */
export function focusListingRegion(raw: string): FocusResult {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (text.length <= FOCUS_THRESHOLD) {
    return { text: normaliseText(text), narrowed: false, dropped: 0 };
  }

  const lines = text.split('\n').map((l) => l.trim());
  const scores = lines.map(scoreLine);

  // Rolling sum over a window of lines; keep the highest-scoring placement.
  let best = { start: 0, score: -1 };
  let running = scores.slice(0, WINDOW).reduce((a, b) => a + b, 0);
  best = { start: 0, score: running };

  for (let i = WINDOW; i < lines.length; i++) {
    running += scores[i] - scores[i - WINDOW];
    if (running > best.score) best = { start: i - WINDOW + 1, score: running };
  }

  // Nothing in the page looks like a listing — hand back the original rather than
  // an arbitrary slice, so the caller reports "nothing found" honestly.
  if (best.score <= 0) return { text: normaliseText(text), narrowed: false, dropped: 0 };

  // Grow the window outward while the neighbouring lines still carry signal, so a
  // detail that sits just past the edge is not cut off.
  let start = best.start;
  let end = Math.min(lines.length, best.start + WINDOW);
  while (start > 0 && scores[start - 1] > 0 && !SECTION_BREAK.test(lines[start - 1])) start--;
  while (end < lines.length && scores[end] > 0 && !SECTION_BREAK.test(lines[end])) end++;

  // A break inside the chosen window itself truncates it there.
  const breakAt = lines.slice(start, end).findIndex((l) => SECTION_BREAK.test(l));
  if (breakAt > 0) end = start + breakAt;

  const focused = lines.slice(start, end).join('\n').trim();
  return {
    text: normaliseText(focused),
    narrowed: true,
    dropped: text.length - focused.length,
  };
}
