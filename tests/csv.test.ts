import { describe, expect, it } from 'vitest';
import { csvToRecords, parseCsv } from '@/lib/csv';

describe('parseCsv', () => {
  it('reads quoted fields containing commas', () => {
    expect(parseCsv('a,b\n"ויטל 14, דירה 3",2')).toEqual([
      ['a', 'b'],
      ['ויטל 14, דירה 3', '2'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"ממ""ד"')).toEqual([['a'], ['ממ"ד']]);
  });

  it('handles CRLF and a trailing newline without emitting a blank row', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    expect(parseCsv('﻿city,price\nחיפה,100')[0][0]).toBe('city');
  });
});

describe('csvToRecords', () => {
  it('maps rows onto the header', () => {
    expect(csvToRecords('city,price\nחיפה,1980000')).toEqual([{ city: 'חיפה', price: '1980000' }]);
  });

  it('returns nothing when there are no data rows', () => {
    expect(csvToRecords('city,price')).toEqual([]);
  });
});
