/**
 * Minimal RFC-4180 reader: quoted fields, escaped quotes, CRLF.
 * Enough for a broker's exported sheet; not a general CSV library.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** First row is the header. Values stay strings — the schema coerces them. */
export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((key, i) => {
      if (key) rec[key] = (r[i] ?? '').trim();
    });
    return rec;
  });
}

/** Column order for the downloadable template, and the order the importer documents. */
export const CSV_COLUMNS = [
  'deal', 'price', 'city', 'neighborhood', 'street', 'gush', 'helka', 'tatHelka',
  'assetType', 'rooms', 'sqm', 'balconySqm', 'floor', 'floorsInBuilding', 'builtYear', 'condition',
  'elevator', 'parking', 'storage', 'mamad', 'accessible', 'furnished', 'separateEntrance',
  'registryKind', 'tenure', 'leaseEndsAt', 'caveats', 'mortgages', 'registryVerified', 'splitPermit',
  'areaMedianPpsm', 'areaMedianRent', 'expectedMonthlyRent', 'arnona', 'vaad', 'utilities',
  'source', 'publisherKind', 'agentFeePct', 'availableFrom',
] as const;
