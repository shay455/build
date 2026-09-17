import { NextResponse } from 'next/server';
import { insertProperty, listProperties } from '@/lib/db';
import { propertyInputSchema, toProperty } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ properties: listProperties() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
  }

  const parsed = propertyInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'הנתונים אינם תקינים', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 422 },
    );
  }

  const property = insertProperty(toProperty(parsed.data));
  return NextResponse.json({ property }, { status: 201 });
}
