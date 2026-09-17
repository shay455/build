import { getProperty } from '@/lib/db';
import { renderReportPdf } from '@/lib/pdf';
import { buildReport } from '@/lib/report';
import { evaluate } from '@/lib/search';
import type { BuyerProfile } from '@/types/property';

export const dynamic = 'force-dynamic';

const PROFILES = new Set<BuyerProfile>(['single', 'upgrade', 'additional', 'oleh', 'reg11']);

/**
 * The property report as a PDF.
 *
 * The buyer profile is a query parameter because the tax and financing figures are
 * per-buyer: the same property produces a different report for a first-home buyer
 * and for an investor.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const property = getProperty(id);
  if (!property) {
    return Response.json({ error: 'לא נמצא נכס' }, { status: 404 });
  }

  const raw = new URL(request.url).searchParams.get('profile') as BuyerProfile | null;
  const profile: BuyerProfile = raw && PROFILES.has(raw) ? raw : 'single';

  const report = buildReport(evaluate(property, {}, profile), profile);
  const pdf = await renderReportPdf(report);

  const filename = `report-${property.gush}-${property.helka}.pdf`;
  return new Response(pdf as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
