import { NextResponse } from 'next/server';
import { insertMany } from '@/lib/db';
import { csvToRecords } from '@/lib/csv';
import { propertyInputSchema, toProperty } from '@/lib/validation';
import type { Property } from '@/types/property';

export const dynamic = 'force-dynamic';

interface RowError {
  row: number;
  field: string;
  message: string;
}

/**
 * Bulk import. Valid rows are imported and invalid ones are reported by row number —
 * a broker with 200 rows should not lose 199 of them to one typo.
 */
export async function POST(request: Request) {
  const text = await request.text();
  if (!text.trim()) return NextResponse.json({ error: 'הקובץ ריק' }, { status: 400 });

  const records = csvToRecords(text);
  if (records.length === 0) {
    return NextResponse.json({ error: 'לא נמצאו שורות נתונים מתחת לשורת הכותרות' }, { status: 400 });
  }

  const valid: Property[] = [];
  const errors: RowError[] = [];

  records.forEach((rec, index) => {
    // Blank cells mean "not supplied", which is what the schema defaults handle.
    const cleaned = Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== ''));
    const parsed = propertyInputSchema.safeParse(cleaned);
    if (parsed.success) {
      valid.push(toProperty(parsed.data));
    } else {
      for (const issue of parsed.error.issues) {
        errors.push({ row: index + 2, field: String(issue.path[0] ?? ''), message: issue.message });
      }
    }
  });

  const imported = valid.length > 0 ? await insertMany(valid) : 0;
  return NextResponse.json({ imported, rejected: records.length - valid.length, errors });
}
