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

עדיין לא (בתכנון לשלב א׳/ב׳): דחיסת הקשר לשיחות ארוכות מאוד, שיתוף שיחה, ציטוטים מתוך קבצים שהועלו, אימות משתמשים ומכסות.

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

## API

| נתיב | תיאור |
|---|---|
| `POST /api/conversations` | שיחה חדשה |
| `GET /api/conversations/:id` | שיחה עם כל ההודעות |
| `POST /api/conversations/:id/messages` | שולח הודעה, מחזיר SSE: `message_start`, `thinking_delta`, `text_delta`, `citation`, `tool_start`, `tool_result`, `safety`, `usage`, `done`, `error` |
| `POST /api/uploads` | multipart, מחזיר מזהה קובץ לצירוף להודעה |
| `GET /api/metrics` | מדדי תפעול: עלות ממוצעת, p95 לטוקן ראשון, יחס מטמון, התערבויות בטיחות, כיסוי ציטוטים |
