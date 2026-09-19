import { describe, expect, it } from 'vitest';
import { extractListing, REQUIRED_FIELDS } from '@/lib/extract';
import { classifyUrl } from '@/lib/sources/url-policy';

const CITIES = ['תל אביב-יפו', 'חיפה', 'באר שבע', 'רמת גן', 'ירושלים', 'פתח תקווה'];
const x = (text: string) => extractListing(text, CITIES);

describe('deal type', () => {
  it('reads sale and rent', () => {
    expect(x('דירה למכירה בחיפה').deal?.value).toBe('sale');
    expect(x('דירה להשכרה בחיפה').deal?.value).toBe('rent');
    expect(x('מושכרת כרגע').deal?.value).toBe('rent');
  });

  it('leaves it unset when the text does not say', () => {
    expect(x('3 חדרים בחיפה').deal).toBeUndefined();
  });
});

describe('asset type', () => {
  it('recognises the Hebrew property words', () => {
    expect(x('יחידת דיור להשכרה').assetType?.value).toBe('housingUnit');
    expect(x('סטודיו במרכז').assetType?.value).toBe('studio');
    expect(x('פנטהאוז עם נוף').assetType?.value).toBe('penthouse');
    expect(x('דירת גן עם חצר').assetType?.value).toBe('garden');
    expect(x('בית פרטי בשכונה').assetType?.value).toBe('house');
    expect(x('דירה 3 חדרים').assetType?.value).toBe('apartment');
  });

  it('prefers the more specific word over "דירה"', () => {
    expect(x('דירת גן, דירה מהממת').assetType?.value).toBe('garden');
  });
});

describe('numbers', () => {
  it('reads rooms including halves', () => {
    expect(x('3 חדרים').rooms?.value).toBe(3);
    expect(x('3.5 חדרים').rooms?.value).toBe(3.5);
    expect(x("4 חד'").rooms?.value).toBe(4);
  });

  it('takes the built area as the largest area quoted', () => {
    const r = x('דירה 72 מ"ר עם מרפסת 6 מ"ר');
    expect(r.sqm?.value).toBe(72);
    expect(r.balconySqm?.value).toBe(6);
  });

  it('does not let a balcony be read as the built area', () => {
    expect(x('מרפסת שמש 14 מ"ר, הדירה 118 מ"ר').sqm?.value).toBe(118);
  });

  it('reads the floor, including ground', () => {
    expect(x('קומה 5 מתוך 8').floor?.value).toBe(5);
    expect(x('קומה 5 מתוך 8').floorsInBuilding?.value).toBe(8);
    expect(x('קומת קרקע').floor?.value).toBe(0);
  });

  it('reads the build year from its several phrasings', () => {
    expect(x('שנת בנייה 1998').builtYear?.value).toBe(1998);
    expect(x('נבנה ב־2012').builtYear?.value).toBe(2012);
    expect(x('הבניין משנת 1967').builtYear?.value).toBe(1967);
  });

  it('reads gush and helka when quoted', () => {
    const r = x('גוש 7025 חלקה 88');
    expect(r.gush?.value).toBe(7025);
    expect(r.helka?.value).toBe(88);
  });
});

describe('price', () => {
  it('reads a grouped amount', () => {
    expect(x('מחיר 3,150,000 ש"ח').price?.value).toBe(3_150_000);
  });

  it('reads millions written as words', () => {
    expect(x('מחיר מבוקש 3.15 מיליון').price?.value).toBe(3_150_000);
    expect(x('2 מיליון ש"ח').price?.value).toBe(2_000_000);
  });

  it('reads a shekel-prefixed amount', () => {
    expect(x('₪1,190,000').price?.value).toBe(1_190_000);
  });

  it('reads rent from its own label', () => {
    expect(x('שכ"ד 5,400 ש"ח לחודש').price?.value).toBe(5_400);
  });

  it('does not mistake the arnona or the vaad for the price', () => {
    const r = x('דירה למכירה 1,320,000 ש"ח. ארנונה 410 ש"ח, ועד בית 160 ש"ח');
    expect(r.price?.value).toBe(1_320_000);
    expect(r.arnona?.value).toBe(410);
    expect(r.vaad?.value).toBe(160);
  });

  it('marks an unlabelled amount as inferred rather than explicit', () => {
    expect(x('דירה נהדרת 2,400,000').price?.confidence).toBe('inferred');
    expect(x('מחיר 2,400,000').price?.confidence).toBe('explicit');
  });
});

describe('features', () => {
  it('reads the ones that are present', () => {
    const r = x('עם מעלית, ממ"ד, מחסן וכניסה נפרדת');
    expect(r.features.elevator?.value).toBe(true);
    expect(r.features.mamad?.value).toBe(true);
    expect(r.features.storage?.value).toBe(true);
    expect(r.features.separateEntrance?.value).toBe(true);
  });

  it('honours a negation, which is the whole difficulty', () => {
    // "ללא מעלית" must not be read as "has a lift".
    expect(x('דירה משופצת ללא מעלית').features.elevator?.value).toBe(false);
    expect(x('בלי חניה').features.parking?.value).toBe(0);
    expect(x('אין ממ"ד בבניין').features.mamad?.value).toBe(false);
  });

  it('counts parking spaces', () => {
    expect(x('2 חניות').features.parking?.value).toBe(2);
    expect(x('חניה בטאבו').features.parking?.value).toBe(1);
  });
});

describe('condition and entry', () => {
  it('reads the condition', () => {
    expect(x('דירה משופצת').condition?.value).toBe('renovated');
    expect(x('דורשת שיפוץ').condition?.value).toBe('needsWork');
    expect(x('חדשה מקבלן').condition?.value).toBe('new');
    expect(x('דירה שמורה').condition?.value).toBe('kept');
  });

  it('reads the entry date', () => {
    expect(x('כניסה מיידית').availableFrom?.value).toBe('מיידי');
    expect(x('כניסה ב־1.11').availableFrom?.value).toBe('1.11');
  });
});

describe('location', () => {
  it('reads city and street', () => {
    const r = x('דירה למכירה ברחוב ויטל 14, תל אביב');
    expect(r.city?.value).toBe('תל אביב-יפו');
    expect(r.street?.value).toBe('ויטל 14');
  });

  it('resolves a city short form', () => {
    expect(x('3 חדרים בת״א').city?.value).toBe('תל אביב-יפו');
  });
});

describe('what it could not find', () => {
  it('lists the required fields that are missing', () => {
    const r = x('דירה יפה מאוד');
    expect(r.missing).toEqual(expect.arrayContaining(['price', 'city', 'rooms', 'sqm']));
  });

  it('reports everything missing for empty text rather than throwing', () => {
    expect(extractListing('').missing).toEqual([...REQUIRED_FIELDS]);
  });

  it('shrinks the missing list as the text supplies fields', () => {
    const sparse = x('דירה בחיפה');
    const full = x('דירה בחיפה, 4 חדרים, 100 מ"ר, שנת בנייה 2005, מחיר 2,000,000, גוש 10812 חלקה 57');
    expect(full.missing.length).toBeLessThan(sparse.missing.length);
    expect(full.missing).toEqual([]);
  });
});

describe('a real listing, end to end', () => {
  const listing = `דירה למכירה בפלורנטין, תל אביב
רחוב ויטל 14, 3 חדרים, 72 מ"ר, קומה 2 מתוך 4
מרפסת שמש 6 מ"ר, משופצת כולה, ללא מעלית, בלי חניה
הבניין משנת 1958. גוש 7025 חלקה 88
מחיר 3,150,000 ש"ח. ארנונה 640, ועד בית 190
כניסה מיידית`;

  it('pulls the whole thing apart correctly', () => {
    const r = x(listing);
    expect(r.deal?.value).toBe('sale');
    expect(r.assetType?.value).toBe('apartment');
    expect(r.city?.value).toBe('תל אביב-יפו');
    expect(r.rooms?.value).toBe(3);
    expect(r.sqm?.value).toBe(72);
    expect(r.balconySqm?.value).toBe(6);
    expect(r.floor?.value).toBe(2);
    expect(r.floorsInBuilding?.value).toBe(4);
    expect(r.builtYear?.value).toBe(1958);
    expect(r.gush?.value).toBe(7025);
    expect(r.helka?.value).toBe(88);
    expect(r.price?.value).toBe(3_150_000);
    expect(r.arnona?.value).toBe(640);
    expect(r.vaad?.value).toBe(190);
    expect(r.condition?.value).toBe('renovated');
    expect(r.availableFrom?.value).toBe('מיידי');
    expect(r.features.elevator?.value).toBe(false);
    expect(r.features.parking?.value).toBe(0);
    expect(r.missing).toEqual([]);
  });

  it('carries evidence for every field it found', () => {
    const r = x(listing);
    for (const [key, field] of Object.entries(r)) {
      if (key === 'features' || key === 'missing' || key === 'focus' || field === undefined) continue;
      expect((field as { evidence: string }).evidence, key).toBeTruthy();
    }
  });
});

describe('url policy', () => {
  it('sends the listing boards to the text path, with the reason', () => {
    for (const u of ['https://www.yad2.co.il/item/abc', 'https://madlan.co.il/listings/1']) {
      const p = classifyUrl(u);
      expect('disposition' in p && p.disposition, u).toBe('needs-api');
      expect('reason' in p && p.reason, u).toContain('העתיקו');
    }
  });

  it('marks the social platforms as text-only', () => {
    for (const u of [
      'https://www.facebook.com/groups/1/posts/2',
      'https://instagram.com/p/xyz',
      'https://www.tiktok.com/@u/video/1',
    ]) {
      const p = classifyUrl(u);
      expect('disposition' in p && p.disposition, u).toBe('paste-text');
    }
  });

  it('routes YouTube through its official API', () => {
    const p = classifyUrl('https://youtu.be/abc123');
    expect('disposition' in p && p.disposition).toBe('needs-api');
  });

  it('treats an ordinary site as fetchable', () => {
    const p = classifyUrl('https://some-agency.co.il/property/5');
    expect('disposition' in p && p.disposition).toBe('fetchable');
  });

  it('ignores a www prefix when matching', () => {
    expect(classifyUrl('https://www.tiktok.com/x')).toEqual(classifyUrl('https://tiktok.com/x'));
  });

  it('rejects a malformed link and a non-web scheme', () => {
    expect(classifyUrl('not a url')).toHaveProperty('error');
    expect(classifyUrl('ftp://example.com')).toHaveProperty('error');
  });
});

describe('street extraction is bounded', () => {
  const post = `🏠 למכירה! דירה מהממת בפלורנטין תל אביב
רחוב ויטל 14 ✨
3 חדרים, 72 מר, קומה 2 מתוך 4
משופצת מהיסוד, ללא מעלית
מחיר: 3,150,000 ש״ח. פרטים בפרטי 📩`;

  it('finds the street in a long post without swallowing the post', () => {
    const r = x(post);
    expect(r.street?.value).toBe('ויטל 14');
    expect(r.street!.value.length).toBeLessThan(30);
  });

  it('still reads the rest of the post correctly', () => {
    const r = x(post);
    expect(r.city?.value).toBe('תל אביב-יפו');
    expect(r.rooms?.value).toBe(3);
    expect(r.price?.value).toBe(3_150_000);
    expect(r.features.elevator?.value).toBe(false);
  });

  it('anchors on the several street-type words', () => {
    expect(x("רח' הרצל 55, ראשון לציון").street?.value).toBe('הרצל 55');
    expect(x('שדרות רוטשילד 10, תל אביב').street?.value).toBe('רוטשילד 10');
    expect(x('דרך חברון 4, ירושלים').street?.value).toBe('חברון 4');
  });

  it('claims no street when the text has none', () => {
    expect(x('דירה למכירה בחיפה, 4 חדרים, 118 מ"ר, קומה 3, מחיר 1,980,000 ש"ח, עם מעלית וחניה').street).toBeUndefined();
  });

  it('accepts a bare short address with no street-type word', () => {
    expect(x('ויטל 14, תל אביב').street?.value).toBe('ויטל 14');
  });
});

describe('a whole-page paste', () => {
  // Padded to the length of a real page selection; a Cmd+A on a listing site
  // yields thousands of characters of navigation and footer.
  const page = `דף הבית | נדלן | רכב | יד שנייה | דרושים | עסקים | חיות מחמד
התחברות הרשמה שמור חיפוש קבלת התראות במייל הוספת מודעה חינם
מיון לפי: רלוונטיות | מחיר מהנמוך | מחיר מהגבוה | תאריך פרסום | שטח
סינון: מספר חדרים, קומה, מחיר, שטח, מאפיינים, כניסה
פרסומת: משכנתא בריבית אטרקטיבית עד 4,500,000 ש"ח. לחצו כאן לפרטים
בנק ממן - מסלול משתלם למשפרי דיור ולרוכשי דירה ראשונה

דירה למכירה בפלורנטין, תל אביב
רחוב ויטל 14
3 חדרים, 72 מ"ר, קומה 2 מתוך 4
מרפסת שמש 6 מ"ר, משופצת
ללא מעלית, בלי חניה
הבניין משנת 1958
גוש 7025 חלקה 88
מחיר: 3,150,000 ש"ח
ארנונה 640, ועד בית 190

מודעות נוספות שיעניינו אותך:
דירה 5 חדרים ברמת אביב, 140 מ"ר, 8,900,000 ש"ח
פנטהאוז בנווה צדק, 200 מ"ר, 12,500,000 ש"ח

תנאי שימוש | מדיניות פרטיות | הצהרת נגישות | צור קשר | פרסמו אצלנו
כל הזכויות שמורות 2026. אין להעתיק תכנים מהאתר ללא אישור בכתב
עקבו אחרינו בפייסבוק, באינסטגרם ובטוויטר | טלפון: 03-1234567`;

  it('narrows to the listing and says how much it dropped', () => {
    const r = x(page);
    expect(r.focus?.narrowed).toBe(true);
    expect(r.focus!.dropped).toBeGreaterThan(200);
  });

  it('takes this property price, not the most expensive one on the page', () => {
    // The penthouse at 12,500,000 is the largest number present.
    expect(x(page).price?.value).toBe(3_150_000);
  });

  it('takes this property area, not a neighbouring listing that is bigger', () => {
    expect(x(page).sqm?.value).toBe(72);
  });

  it('gets every required field from a page paste', () => {
    const r = x(page);
    expect(r.missing).toEqual([]);
    expect(r.rooms?.value).toBe(3);
    expect(r.gush?.value).toBe(7025);
    expect(r.street?.value).toBe('ויטל 14');
    expect(r.features.elevator?.value).toBe(false);
  });

  it('does not narrow text that is already just a listing', () => {
    expect(x('דירה 3 חדרים בחיפה, 72 מ"ר, 1,500,000 ש"ח').focus?.narrowed).toBe(false);
  });

  it('hands back the whole text when nothing in it looks like a listing', () => {
    const prose = 'שלום וברוכים הבאים לאתר. '.repeat(40);
    expect(x(prose).focus?.narrowed).toBe(false);
  });
});
