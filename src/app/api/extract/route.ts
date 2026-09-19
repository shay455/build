import { NextResponse } from 'next/server';
import { listCities } from '@/lib/db';
import { extractListing } from '@/lib/extract';
import { readImage } from '@/lib/ocr';
import { classifyUrl, SOURCE_GUIDE } from '@/lib/sources/url-policy';

export const dynamic = 'force-dynamic';

/**
 * Turn a pasted listing into a draft property.
 *
 * `text` is the reliable path and works for every source. `url` is classified and,
 * where automated access is not available, answered with what to do instead rather
 * than with a failed fetch.
 */
/** A screenshot is read on the server; 12MB is well past any real screen capture. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  // A screenshot arrives as multipart, everything else as JSON.
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('image');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'לא צורפה תמונה' }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'התמונה גדולה מדי (מעל 12MB)' }, { status: 413 });
    }

    try {
      const ocr = await readImage(Buffer.from(await file.arrayBuffer()));
      if (!ocr.usable) {
        return NextResponse.json({
          fetched: false,
          source: 'ocr',
          ocr: { confidence: ocr.confidence, usable: false },
          action: 'paste-text',
          message: ocr.note,
        });
      }
      const extracted = extractListing(ocr.text, await listCities());
      return NextResponse.json({
        fetched: false,
        source: 'ocr',
        ocr: { confidence: ocr.confidence, usable: true, text: ocr.text },
        extracted,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error && err.message.includes('OCR data')
              ? err.message
              : 'קריאת התמונה נכשלה. הדביקו את הטקסט במקום.',
        },
        { status: 500 },
      );
    }
  }

  let body: { text?: string; url?: string };
  try {
    body = (await request.json()) as { text?: string; url?: string };
  } catch {
    return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
  }

  const text = body.text?.trim();
  const url = body.url?.trim();

  if (!text && !url) {
    return NextResponse.json(
      { error: 'יש להדביק טקסט מודעה או קישור', sources: SOURCE_GUIDE },
      { status: 400 },
    );
  }

  if (url && !text) {
    const policy = classifyUrl(url);
    if ('error' in policy) return NextResponse.json({ error: policy.error }, { status: 400 });

    if (policy.disposition !== 'fetchable') {
      return NextResponse.json(
        {
          fetched: false,
          policy,
          action: 'paste-text',
          message: `${policy.source}: ${policy.reason}`,
        },
        { status: 200 },
      );
    }

    // A general site. The fetch is attempted; a failure is reported as one, and the
    // user is pointed at the text path rather than left with nothing.
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'MafteachNechasim/0.1 (+property research; contact via repository)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return NextResponse.json({
          fetched: false,
          policy,
          action: 'paste-text',
          message: `האתר החזיר סטטוס ${res.status}. העתיקו את טקסט המודעה במקום.`,
        });
      }
      const html = await res.text();
      // Strip tags crudely; a listing page's prose survives this well enough to extract from.
      const plain = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const extracted = extractListing(plain, await listCities());
      return NextResponse.json({ fetched: true, policy, extracted, characters: plain.length });
    } catch {
      return NextResponse.json({
        fetched: false,
        policy,
        action: 'paste-text',
        message: 'לא הצלחנו להגיע לכתובת. העתיקו את טקסט המודעה במקום.',
      });
    }
  }

  const extracted = extractListing(text!, await listCities());
  return NextResponse.json({ fetched: false, extracted });
}
