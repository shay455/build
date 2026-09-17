/**
 * Hebrew text for pdf-lib.
 *
 * pdf-lib lays glyphs out through fontkit, and fontkit already handles most of the
 * right-to-left case: Hebrew words come out in the correct order, reading
 * correctly. What it does NOT do is run the full Unicode bidirectional algorithm,
 * and it gets two things wrong as a result:
 *
 *   1. It reverses an embedded number along with the Hebrew around it, so
 *      "גוש 6128" renders as "גוש 8216" — a plausible-looking parcel that is not
 *      the one in the record.
 *   2. It does not swap mirrored characters, so a parenthesis in Hebrew text comes
 *      out pointing the wrong way: ")9.0%(".
 *
 * Running the bidi algorithm ourselves and handing fontkit pre-reordered text
 * makes things worse, because fontkit then reorders it a second time.
 *
 * So the correction is narrow and local: pre-reverse each left-to-right run so
 * fontkit's own reversal puts it back, and pre-swap mirrored characters outside
 * those runs so fontkit's reversal leaves them pointing the right way.
 *
 * This was found and fixed by rendering to an image and reading the page. It is
 * the only check that catches it: every text extractor applies its own bidi pass,
 * and will report a number that is not the one drawn.
 */

/**
 * A left-to-right run: digits or Latin letters, optionally joined by interior
 * separators (1,190,000 · 4.64 · 341/3 · 2026-09-17 · nadlan.gov.il), where any
 * part may carry a trailing percent sign. The percent has to be allowed mid-run,
 * or "8%/10%" splits into two runs that fontkit then swaps into "10%/8%".
 */
const LTR_RUN = /[0-9A-Za-z]+%?(?:[.,:/\-][0-9A-Za-z]+%?)*/g;

/** fontkit only reorders a run it detects as right-to-left, which means one with Hebrew in it. */
const HAS_HEBREW = /[\u0590-\u05FF]/;

const MIRRORED: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
};

function mirrorBrackets(segment: string): string {
  return Array.from(segment)
    .map((ch) => MIRRORED[ch] ?? ch)
    .join('');
}

/**
 * Prepare logical Hebrew text for pdf-lib's fontkit layout.
 *
 * Text with no Hebrew in it is returned untouched: fontkit will not reorder it, so
 * there is nothing to compensate for. Correcting it anyway is what turns a tax
 * bracket label like "0–1,978,745" into "0–547,879,1".
 *
 * Brackets are only mirrored outside left-to-right runs, so a bracket belonging to
 * Latin text (a URL, a code) is left alone.
 */
export function forPdf(text: string): string {
  if (!text || !HAS_HEBREW.test(text)) return text;

  let out = '';
  let cursor = 0;
  LTR_RUN.lastIndex = 0;

  for (let match = LTR_RUN.exec(text); match !== null; match = LTR_RUN.exec(text)) {
    out += mirrorBrackets(text.slice(cursor, match.index));
    out += Array.from(match[0]).reverse().join('');
    cursor = match.index + match[0].length;
  }
  out += mirrorBrackets(text.slice(cursor));

  return out;
}
