# Bombot

עוזר AI עם חיפוש חי ומקורות. מותג עצמאי. מסמך האיפיון המלא: [`docs/bombot-spec.html`](docs/bombot-spec.html) (עברית, RTL).

## מצב הפרויקט

**שלב א׳ (צ'אט עם חיפוש חי) — אלפא בקוד.** מה עובד:

- צ'אט רב-תורי עם הזרמת טוקנים (SSE), עברית/RTL מלא, Markdown, קוד.
- חיפוש רשת וקריאת עמודים ככלי שרת של Claude, ציטוטים ממוספרים `[n]` עם פאנל מקורות.
- מצב Think (סיכום מהלך החשיבה בזמן אמת) ובורר מאמץ מהיר / מאוזן / מעמיק.
- העלאת תמונות, PDF וטקסט לשיחה.
- שכבת בטיחות כפולה (לפני ואחרי המודל) על מודל מהיר, עם רישום אירועים.
- טלמטריה: עלות משוערת לכל תשובה, זמן לטוקן ראשון, יחס פגיעה במטמון, `/api/metrics`.
- `fallbacks: "default"` על כל קריאה, טיפול ב-`pause_turn`, מטמון פרומפט.
- ספק `mock` לפיתוח ובדיקות ללא מפתח API. 14 בדיקות אינטגרציה ויחידה.

**שלב ב׳ — בתהליך.** מה כבר עובד:

- **בוט טלגרם** (‎@bombot): מגיב לתיוג ולפקודות ‎/check, ‎/explain, ‎/summarize, ‎/translate, ‎/imagine, ‎/settings. בונה הקשר מההודעה שעליה הגיבו ומ-20 ההודעות האחרונות בקבוצה או בטופיק, כולל תמונות.
- **אימות עובדות מובנה**: כותרת פסק דין (נכון / חלקית / מטעה / שגוי / לא ניתן לאמת) עם רמת ביטחון, גוף עד 1,200 תווים, ומקורות ממוספרים שמגיעים רק מתוצאות חיפוש אמיתיות.
- סיווג כוונה, שתיקה על ספאם והזרקות, הגבלת קצב 5 בקשות לשעה למשתמש, הגדרות מנהלי קבוצה, אידמפוטנטיות של webhook.
- **לוח בקרה למפעילים** (`/api/admin/bot/*`): בקשות אחרונות, מחיקת תגובה מהקבוצה, מתג כיבוי חירום גלובלי, הגדרות לכל קבוצה.
- **מצב מחקר** (DeepSearch): תכנון תת-שאלות, עד 25 חיפושים, דוח מובנה, תקרת 5 דקות.
- **יצירת תמונות** על Cloudflare Workers AI (FLUX.1 schnell) עם גיבוי Pollinations: שכתוב פרומפט לאנגלית, מדיניות אפס לאנשים אמיתיים, מכסה יומית. בצ'אט: `/imagine <תיאור>`.

עדיין לא: זיכרון, סביבות עבודה ומשימות מתוזמנות (דורשים חשבונות משתמשים), תשלומים ומכסות שבועיות, מתאמי X ודיסקורד, סימן מים בפיקסלים, דחיסת הקשר, שיתוף שיחה.

## מבנה

```
apps/api        Fastify + TypeScript. Anthropic SDK, Postgres (pg בייצור, PGlite מוטמע בפיתוח)
apps/web        Next.js 15, React 19. ממשק צ'אט בעברית
packages/shared חוזי טיפוסים משותפים (אירועי SSE, הודעות, ציטוטים)
evals/          סט הערכה ראשוני לשלב א׳ + מריץ
docs/           מסמך האיפיון
```

## הרצה מקומית

דרישות: Node 22+.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # ערכו ANTHROPIC_API_KEY, או השאירו LLM_PROVIDER=mock
npm run dev            # API על :4000, ווב על :3000
```

ללא מפתח API: `LLM_PROVIDER=mock npm run dev:api` בטרמינל אחד ו-`npm run dev:web` בשני. הממשק יעבוד עם תשובות דמה.

Postgres אמיתי במקום PGlite: `docker compose up -d` ואז `DATABASE_URL=postgres://bombot:bombot@localhost:5432/bombot`.

## בדיקות והערכה

```bash
npm test               # vitest, רץ עם ספק mock, בלי רשת
npm run typecheck
API_URL=http://localhost:4000 npm run eval --workspace apps/api   # דורש API עם ספק אמיתי
```

## בוט הטלגרם

1. צרו בוט אצל ‎@BotFather, כבו Privacy Mode (כדי שהבוט יראה הודעות בקבוצה להקשר), והוסיפו אותו לקבוצה.
2. מלאו ב-`apps/api/.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (למשל `openssl rand -hex 24`), `PUBLIC_API_URL` (כתובת HTTPS ציבורית של ה-API; לפיתוח אפשר `ngrok http 4000`).
3. הריצו את ה-API ואז `npm run telegram:webhook --workspace apps/api`.
4. בקבוצה: הגיבו להודעה עם `@bombot זה נכון?` או `/check@bombot`.

## API

| נתיב | תיאור |
|---|---|
| `POST /api/conversations` | שיחה חדשה |
| `GET /api/conversations/:id` | שיחה עם כל ההודעות |
| `POST /api/conversations/:id/messages` | שולח הודעה, מחזיר SSE: `message_start`, `thinking_delta`, `text_delta`, `citation`, `tool_start`, `tool_result`, `safety`, `usage`, `done`, `error` |
| `POST /api/uploads` | multipart, מחזיר מזהה קובץ לצירוף להודעה |
| `GET /api/metrics` | מדדי תפעול: עלות ממוצעת, p95 לטוקן ראשון, יחס מטמון, התערבויות בטיחות, כיסוי ציטוטים |
| `POST /api/images` | `{prompt}` → תמונה שנוצרה; `GET /api/images/:id` מגיש אותה |
| `POST /api/telegram/webhook` | קליטת עדכונים מטלגרם (מאומת בסוד) |
| `GET/POST /api/admin/bot/state` | מתג כיבוי חירום (Bearer `ADMIN_TOKEN`) |
| `GET /api/admin/bot/requests`, `DELETE /api/admin/bot/requests/:id` | בקשות אחרונות ומחיקת תגובה מהקבוצה |
| `GET/PUT /api/admin/bot/chats/:chatId/settings` | הגדרות לכל קבוצה |
