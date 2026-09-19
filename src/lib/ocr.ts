import 'server-only';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createWorker } from 'tesseract.js';

/**
 * Hebrew OCR for a pasted screenshot.
 *
 * The language data ships inside the @tesseract.js-data/heb dependency and is
 * decompressed once into a cache directory, so nothing is fetched at runtime —
 * the same reason the report font is vendored rather than loaded from a CDN.
 */
const CACHE_DIR = process.env.OCR_CACHE_DIR ?? resolve(process.cwd(), '.ocr-cache');
const GZ_PATH = resolve(process.cwd(), 'node_modules/@tesseract.js-data/heb/4.0.0/heb.traineddata.gz');

/** Below this, the OCR read the image badly enough that its output is not worth extracting from. */
export const MIN_CONFIDENCE = 55;

export interface OcrResult {
  text: string;
  confidence: number;
  /** False when the image could not be read well enough to use. */
  usable: boolean;
  note?: string;
}

function ensureLanguageData(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const target = resolve(CACHE_DIR, 'heb.traineddata');
  if (existsSync(target)) return;
  if (!existsSync(GZ_PATH)) {
    throw new Error('Hebrew OCR data is missing. Reinstall dependencies: npm install');
  }
  writeFileSync(target, gunzipSync(readFileSync(GZ_PATH)));
}

/**
 * Read Hebrew text out of an image.
 *
 * Never throws for an unreadable image: a low-confidence read is reported as
 * unusable, because extracting a price from noise is worse than admitting the
 * screenshot could not be read.
 */
export async function readImage(image: Buffer): Promise<OcrResult> {
  ensureLanguageData();

  const worker = await createWorker('heb', 1, { langPath: CACHE_DIR, gzip: false, cachePath: CACHE_DIR });
  try {
    const { data } = await worker.recognize(image);
    const text = data.text.trim();
    const confidence = data.confidence ?? 0;

    if (!text) {
      return { text: '', confidence, usable: false, note: 'לא זוהה טקסט בתמונה' };
    }
    if (confidence < MIN_CONFIDENCE) {
      return {
        text,
        confidence,
        usable: false,
        note: `הקריאה מהתמונה לא הייתה ברורה מספיק (${confidence.toFixed(0)}%). נסו צילום חד יותר, או הדביקו את הטקסט.`,
      };
    }
    return { text, confidence, usable: true };
  } finally {
    await worker.terminate();
  }
}
