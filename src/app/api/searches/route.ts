import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteSavedSearch, insertSavedSearch, listSavedSearches } from '@/lib/db';
import type { BuyerProfile } from '@/types/property';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  deal: z.enum(['sale', 'rent']).optional(),
  city: z.string().optional(),
  assetType: z.string().optional(),
  roomsMin: z.number().optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  sqmMin: z.number().optional(),
  yieldMin: z.number().optional(),
  features: z.array(z.string()).optional(),
  investor: z.boolean().optional(),
});

const bodySchema = z.object({
  name: z.string({ error: 'יש לתת שם לחיפוש' }).trim().min(1, 'יש לתת שם לחיפוש').max(80),
  query: querySchema,
  profile: z.enum(['single', 'upgrade', 'additional', 'oleh', 'reg11']).default('single'),
  /** The floor below which a match is not worth an interruption. */
  minScore: z.number().int().min(0).max(100).default(60),
});

export function GET() {
  return NextResponse.json({ searches: listSavedSearches() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'הנתונים אינם תקינים', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 422 },
    );
  }

  const saved = insertSavedSearch({
    name: parsed.data.name,
    query: parsed.data.query as never,
    profile: parsed.data.profile as BuyerProfile,
    minScore: parsed.data.minScore,
  });
  return NextResponse.json({ search: saved }, { status: 201 });
}

export function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 });
  return deleteSavedSearch(id)
    ? NextResponse.json({ deleted: id })
    : NextResponse.json({ error: 'לא נמצא חיפוש שמור' }, { status: 404 });
}
