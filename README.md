# מודעה ב‑98 · בוט וואטסאפ לייצור קריאייטיב

בעל עסק שולח תמונת מוצר ומשפט. הבוט מחזיר תמונת מודעה בשני פורמטים (פיד 1080×1080, סטורי 1080×1920) עם טקסט עברי נכון, מוכנה להעלאה. האיפיון המלא, כולל מחירון וכלכלת יחידה: [`docs/whatsapp-ad-bot-spec.html`](docs/whatsapp-ad-bot-spec.html).

**מצב הפרויקט: שלב 1 (צינור ידני).** המפעיל שולח לבוט, הבוט מייצר, המפעיל בודק ומוסר ללקוח. ברירת המחדל היא 2 תמונות שונות מאוד כדי שהלקוח יבחר; סרטון נוצר רק בפקודה מפורשת.

## מה קורה בפועל

```
תמונה + "לקוח: X / בריף"  →  Claude Opus 5 כותב קופי ופרומפטים (JSON מובנה)
   →  "אישור"  →  2 קונספטים שונים מאוד (סטודיו נקי / סצנה אמיתית) ב‑Nano Banana Pro
   →  Haiku ממליץ  →  טקסט עברי + לוגו מצוירים בקוד (Sharp + Heebo)
   →  4 קבצים חוזרים אליך (כל קונספט בפיד ובסטורי)  →  הלקוח בוחר  →  "בחר 2"
   →  "סרטון" רק כשמבקשים (fal.ai, Kling v3)  →  "סיום"
```

הטקסט העברי **לא** מיוצר על ידי מודל התמונה. הוא מצויר בשרת, ולכן תמיד נכון, ושינוי טקסט לא עולה כסף.

## שלב 0 · הכנות שרק אתה יכול לעשות

1. **Meta for Developers**: צור אפליקציה מסוג Business, הוסף את המוצר WhatsApp. תחת *API Setup* תמצא `Phone number ID`. הוסף מספר טלפון ייעודי לבוט (SIM חדש או מספר וירטואלי שמקבל SMS). אל תשתמש במספר הפרטי שלך.
2. **טוקן קבוע**: ב‑Business Settings → System Users צור משתמש מערכת, תן לו הרשאה לאפליקציה ולחשבון הוואטסאפ, וצור טוקן עם ההרשאות `whatsapp_business_messaging` ו‑`whatsapp_business_management`. הטוקן הזמני מהדשבורד פג אחרי 24 שעות.
3. **App Secret**: אפליקציה → Settings → Basic.
4. **מפתחות AI**: [Anthropic Console](https://console.anthropic.com) ו‑[Google AI Studio](https://aistudio.google.com) (Gemini API). לסרטונים גם [fal.ai](https://fal.ai) (אופציונלי).
5. **כתובת ציבורית ל‑Webhook** בפיתוח: `ngrok http 3000` או `cloudflared tunnel --url http://localhost:3000`.

## הרצה מקומית

```bash
cp .env.example .env         # מלא את כל הערכים
docker compose up -d         # Postgres + Redis
npm install
npm run db:push              # יוצר טבלאות
npm run dev                  # שרת + worker באותו תהליך
```

בדשבורד של מטא: WhatsApp → Configuration → Webhook. כתובת: `https://<הטאנל שלך>/webhook`, Verify token: הערך של `WA_VERIFY_TOKEN`. סמן את השדה `messages`.

**כשמשהו לא עובד**, הרץ קודם את בדיקת המצב. היא עוברת על כל החוליות (קובץ ההגדרות, Postgres, Redis, השרת, הטאנל, מטא, מפתחות AI) ואומרת בעברית מה תקוע ואיך לתקן:

```bash
npm run doctor
```

בדיקה בלי מפתחות ובלי DB (מציירת את שני הפורמטים מרקע סינתטי):

```bash
npm run smoke:overlay        # → data/smoke-feed.jpg, data/smoke-story.jpg
npm test                     # פקודות + סניטציה של טקסט
```

## פקודות בוואטסאפ (רק מהמספר ב‑`OPERATOR_PHONE`)

| שולחים | קורה |
|---|---|
| תמונה עם כיתוב `לקוח: שם` ומתחת הבריף (אפשר `סגנון: חם`) | נפתחת עבודה, Claude כותב קופי |
| תמונה בלי כיתוב | מצטרפת לעבודה הנוכחית |
| תמונה עם הכיתוב `לוגו` | נשמרת בכרטיס הלקוח |
| `אישור` | 2 קונספטים שונים, כל אחד בפיד ובסטורי (4 קבצים) |
| `כותרת: …` / `משפט: …` / `כפתור: …` | מחליף טקסט, מצייר מחדש, בלי עלות |
| `בחר 2` | מסמן את הקונספט שהלקוח בחר |
| `עוד גרסה` | תמונה נוספת (וריאציה של הקונספט שנבחר) |
| `סרטון` / `סרטון 10` | סרטון 5 או 10 שניות מהקונספט שנבחר. דורש `FAL_KEY` |
| `סטטוס` / `עלויות` / `עזרה` | מידע |
| `סיום` | סוגר ומציג עלות בפועל |

## מבנה

```
src/server.ts            Fastify: /webhook (אימות חתימה), /health, מפעיל את ה‑worker
src/whatsapp/            client (שליחה/הורדת מדיה), webhook (פירוק payload)
src/commands/            router (פענוח פקודות בעברית), handle (מכונת מצבים של עבודה)
src/queue/               BullMQ: brief → generate → render, variant
src/pipeline/brief.ts    Claude Opus 5, structured output, fallbacks
src/pipeline/images.ts   Gemini gemini-3-pro-image, קונספט לכל פרומפט
src/pipeline/video.ts    fal.ai Kling v3 image-to-video, רק בפקודה "סרטון"
src/pipeline/overlay.ts  טקסט עברי, CTA, לוגו; פורמטים feed/story
src/pipeline/rank.ts     Haiku בוחר גרסה
src/costs.ts             מחירון + רישום כל קריאה (טבלת api_calls)
src/db/schema.ts         clients, jobs, api_calls, inbound_messages
assets/fonts/Heebo.ttf   הפונט לטקסט
```

## מחירים בקוד

`src/costs.ts` מכיל את המחירון (ספטמבר 2026). כל קריאת API נרשמת עם עלות, ופקודת `עלויות` מציגה סיכום חודשי אמיתי. מודעה בסיסית (2 קונספטים) ≈ 0.35 $; עם סרטון 5 שניות ≈ 1 $.

## השלב הבא (שלב 2)

כתוביות עבריות על הסרטון ב‑ffmpeg, outpaint ל‑9:16 במקום רקע מוצק, כרטיסי לקוח עם ברנד‑קיט.
