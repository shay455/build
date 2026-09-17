import { describe, expect, it } from 'vitest';
import { addressKey, addressKeyFromStored, canonical, parseAddress } from '@/lib/address';

const CITIES = ['תל אביב-יפו', 'חיפה', 'באר שבע', 'רמת גן', 'ראשון לציון', 'קריית ביאליק', 'ירושלים'];

describe('canonical', () => {
  it('unifies the several quote characters', () => {
    expect(canonical('מזא״ה')).toBe(canonical('מזא"ה'));
    expect(canonical('רח׳')).toBe(canonical("רח'"));
  });

  it('collapses punctuation and whitespace', () => {
    expect(canonical('  ויטל  14 ,  ')).toBe('ויטל 14');
  });
});

describe('parseAddress', () => {
  it('splits street, number and city', () => {
    expect(parseAddress('ויטל 14, תל אביב-יפו', CITIES)).toMatchObject({
      street: 'ויטל',
      houseNumber: '14',
      city: 'תל אביב-יפו',
    });
  });

  it('drops the street-type prefix', () => {
    expect(parseAddress("רח' ויטל 14", CITIES).street).toBe('ויטל');
    expect(parseAddress('רחוב הרצל 55, ראשון לציון', CITIES).street).toBe('הרצל');
    expect(parseAddress('שדרות רוטשילד 10 תל אביב', CITIES)).toMatchObject({
      street: 'רוטשילד',
      houseNumber: '10',
      city: 'תל אביב-יפו',
    });
  });

  it('resolves city short forms', () => {
    expect(parseAddress('מזא״ה 8, ת״א', CITIES).city).toBe('תל אביב-יפו');
    expect(parseAddress('רגר 88 ב״ש', CITIES).city).toBe('באר שבע');
  });

  it('prefers the longest city match', () => {
    expect(parseAddress('ביאליק 3, קריית ביאליק', CITIES).city).toBe('קריית ביאליק');
  });

  it('does not match a city name inside a longer word', () => {
    // "חיפה" must not be found inside "חיפהאווי", a nonsense token standing in for a street.
    expect(parseAddress('חיפהאווי 4', CITIES).city).toBeNull();
  });

  it('keeps a multi-word street name intact', () => {
    expect(parseAddress('יצחק רגר 88, באר שבע', CITIES)).toMatchObject({
      street: 'יצחק רגר',
      houseNumber: '88',
      city: 'באר שבע',
    });
  });

  it('keeps a letter suffix on the house number', () => {
    expect(parseAddress('ויטל 14א תל אביב', CITIES).houseNumber).toBe('14א');
  });

  it('drops apartment and floor detail and reports it', () => {
    const p = parseAddress('ויטל 14, דירה 3, קומה 2, תל אביב', CITIES);
    expect(p).toMatchObject({ street: 'ויטל', houseNumber: '14', city: 'תל אביב-יפו' });
    expect(p.dropped.length).toBeGreaterThanOrEqual(2);
  });

  it('survives an address with no city', () => {
    expect(parseAddress('ויטל 14')).toMatchObject({ street: 'ויטל', houseNumber: '14', city: null });
  });

  it('survives an address with no number', () => {
    expect(parseAddress('דרך חברון, ירושלים', CITIES)).toMatchObject({
      street: 'חברון',
      houseNumber: null,
      city: 'ירושלים',
    });
  });

  it('returns an empty result for empty input rather than throwing', () => {
    expect(parseAddress('   ')).toEqual({ street: '', houseNumber: null, city: null, dropped: [] });
  });
});

describe('addressKey', () => {
  it('matches the same building written differently', () => {
    const a = addressKey('תל אביב-יפו', "רח' ויטל", '14');
    const b = addressKeyFromStored('תל אביב-יפו', 'ויטל 14');
    expect(a).toBe(b);
  });

  it('separates neighbouring buildings on one street', () => {
    expect(addressKey('חיפה', 'חורב', '22')).not.toBe(addressKey('חיפה', 'חורב', '24'));
  });

  it('separates the same street name in two cities', () => {
    expect(addressKey('חיפה', 'הרצל', '1')).not.toBe(addressKey('ירושלים', 'הרצל', '1'));
  });
});
