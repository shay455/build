import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'מפתח נכסים',
  description: 'סוכן חיפוש נכסים בישראל: כל מה שצריך להחלטה, בכרטיס אחד.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&family=Frank+Ruhl+Libre:wght@500;700;900&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-4">
            <Link href="/" className="font-display text-2xl font-black tracking-tight">
              מפתח נכסים
            </Link>
            <span className="text-sm text-muted">סוכן חיפוש נכסים בישראל</span>
            <nav className="ms-auto flex gap-4 text-sm font-semibold">
              <Link href="/" className="text-accent-ink hover:underline">
                חיפוש
              </Link>
              <Link href="/alerts" className="text-accent-ink hover:underline">
                חיפושים שמורים
              </Link>
              <Link href="/add" className="text-accent-ink hover:underline">
                הוספת נכס
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

        <footer className="mt-10 border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-muted">
            כל תוצרי הכלי נוצרים אוטומטית על ידי מודל בינה מלאכותית, ללא מעורבות או אישור של שמאי מקרקעין
            מוסמך, עורך דין או יועץ מס. הפלט אינו שומה, אינו חוות דעת מקצועית ואינו ייעוץ משפטי או מיסויי.
            הערכת שווי מחייבת דורשת שמאי מוסמך, עסקת מקרקעין דורשת עורך דין, וחישוב מס מחייב דורש יועץ מס.
            מדרגות מס הרכישה נכונות לחוזר מס רכישה 1/2026 של רשות המסים; שיעורי הדירה הנוספת הם הוראת שעה
            בתוקף עד 31.12.2026. הנכסים במאגר הם נתוני דוגמה ואינם מלאי אמיתי.
          </div>
        </footer>
      </body>
    </html>
  );
}
