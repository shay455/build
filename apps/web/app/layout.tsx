import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bombot",
  description: "עוזר AI עם חיפוש חי ומקורות",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
