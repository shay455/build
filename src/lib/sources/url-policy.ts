/**
 * What can honestly be done with a pasted link.
 *
 * Fetching a page server-side is automated access whoever triggered it. For the
 * listing boards that is the same terms-of-service problem as scraping, and for
 * the social platforms it does not even work: the request meets a login wall.
 * Classifying up front means the user is told to paste the text before they wait
 * for a fetch that was never going to succeed.
 */
export type UrlDisposition =
  /** Safe to fetch, subject to the site's robots.txt. */
  | 'fetchable'
  /** Reachable only through an official API that needs a key or an agreement. */
  | 'needs-api'
  /** Automated access is refused or forbidden. Only the text will work. */
  | 'paste-text';

export interface UrlPolicy {
  disposition: UrlDisposition;
  source: string;
  /** Shown to the user, in their terms. */
  reason: string;
}

interface Rule {
  match: RegExp;
  source: string;
  disposition: UrlDisposition;
  reason: string;
}

const RULES: Rule[] = [
  {
    match: /(^|\.)yad2\.co\.il$/,
    source: 'יד2',
    disposition: 'needs-api',
    reason:
      'שליפה אוטומטית של דפי יד2 מפרה את תנאי השימוש שלהם, גם כשהמשתמש הדביק את הקישור. נדרש הסכם API מסחרי. בינתיים — העתיקו את טקסט המודעה.',
  },
  {
    match: /(^|\.)madlan\.co\.il$/,
    source: 'מדלן',
    disposition: 'needs-api',
    reason: 'כמו ביד2: נדרש הסכם מסחרי לשליפה אוטומטית. העתיקו את טקסט המודעה.',
  },
  {
    match: /(^|\.)komo\.co\.il$|(^|\.)homeless\.co\.il$|(^|\.)winwin\.co\.il$/,
    source: 'לוח מודעות',
    disposition: 'needs-api',
    reason: 'לוח מודעות מסחרי. שליפה אוטומטית דורשת הסכם. העתיקו את טקסט המודעה.',
  },
  {
    match: /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)instagram\.com$/,
    source: 'Meta',
    disposition: 'paste-text',
    reason:
      'פייסבוק ואינסטגרם חוסמים גישה אוטומטית ודורשים התחברות — בקשת שרת תקבל דף login ולא את הפוסט. העתיקו את טקסט הפוסט.',
  },
  {
    match: /(^|\.)tiktok\.com$/,
    source: 'TikTok',
    disposition: 'paste-text',
    reason: 'טיקטוק חוסם גישה אוטומטית. העתיקו את תיאור הסרטון או את הטקסט שבתגובות.',
  },
  {
    match: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/,
    source: 'YouTube',
    disposition: 'needs-api',
    reason:
      'כותרת ותיאור של סרטון זמינים דרך YouTube Data API עם מפתח. ללא מפתח — העתיקו את תיאור הסרטון.',
  },
  {
    match: /(^|\.)whatsapp\.com$|(^|\.)t\.me$|(^|\.)telegram\.org$/,
    source: 'הודעות',
    disposition: 'paste-text',
    reason: 'תוכן הודעות אינו נגיש לשרת. הדביקו את ההודעה עצמה.',
  },
];

export function classifyUrl(raw: string): UrlPolicy | { error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: 'הקישור אינו תקין' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'נתמכים רק קישורי http ו-https' };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const rule of RULES) {
    if (rule.match.test(host)) {
      return { disposition: rule.disposition, source: rule.source, reason: rule.reason };
    }
  }

  return {
    disposition: 'fetchable',
    source: host,
    reason: 'אתר כללי — ננסה לשלוף את תוכן הדף, בכפוף ל-robots.txt של האתר.',
  };
}

/** Sources listed for the user up front, so expectations are set before they paste. */
export const SOURCE_GUIDE = [
  { name: 'יד2, מדלן, לוחות מסחריים', works: 'טקסט בלבד', why: 'שליפה אוטומטית דורשת הסכם' },
  { name: 'פייסבוק, אינסטגרם, טיקטוק', works: 'טקסט בלבד', why: 'חוסמים גישה אוטומטית' },
  { name: 'ווטסאפ, טלגרם', works: 'טקסט בלבד', why: 'לא נגיש לשרת' },
  { name: 'יוטיוב', works: 'טקסט, או קישור עם מפתח API', why: 'דרך ה-API הרשמי' },
  { name: 'אתרי אינטרנט כלליים', works: 'קישור או טקסט', why: 'בכפוף ל-robots.txt' },
  { name: 'כל מקור שרואים על המסך', works: 'צילום מסך', why: 'נקרא ב-OCR עברי על השרת' },
] as const;
