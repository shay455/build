/**
 * בדיקת מצב: עובר על כל החוליות בשרשרת ומדפיס בעברית מה תקין ומה תקוע.
 * הרצה: npm run doctor
 * לא שולח הודעות ולא עולה כסף. מדפיס רק אורכי מפתחות, לעולם לא את הערכים.
 */
import { existsSync } from "node:fs";
import { Redis } from "ioredis";
import postgres from "postgres";

if (existsSync(".env")) { try { process.loadEnvFile(".env"); } catch { /* ignore */ } }

const env = process.env;
let problems = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string, fix: string) => { problems++; console.log(`  \x1b[31m✗\x1b[0m ${m}\n      → ${fix}`); };
const info = (m: string) => console.log(`    ${m}`);

console.log("\n=== בדיקת מצב הבוט ===\n");

// 1. .env
console.log("1. קובץ .env");
if (!existsSync(".env")) {
  bad("הקובץ .env לא קיים בתיקייה הזו", "הרץ מתיקיית הפרויקט: cd ~/build/build");
} else {
  const required = ["WA_PHONE_NUMBER_ID", "WA_ACCESS_TOKEN", "WA_APP_SECRET", "WA_VERIFY_TOKEN", "OPERATOR_PHONE", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"];
  const missing = required.filter((k) => !env[k]?.trim());
  if (missing.length) bad(`שדות ריקים: ${missing.join(", ")}`, "פתח: open -e .env ומלא אותם");
  else ok("כל השדות מלאים");
  const phone = env.OPERATOR_PHONE ?? "";
  if (!/^\d{8,15}$/.test(phone)) bad(`OPERATOR_PHONE לא תקין (${phone})`, "רק ספרות, עם קידומת מדינה ובלי 0, למשל 972545999560");
  else ok(`מספר מפעיל: ${phone}`);
  for (const k of ["WA_ACCESS_TOKEN", "WA_APP_SECRET"]) {
    const v = env[k] ?? "";
    if (/[\s"'#]/.test(v)) bad(`${k} מכיל רווח, גרש או הערה`, "השאר רק את הערך אחרי סימן השווה");
  }
}

// 2. Docker services
console.log("\n2. מסד נתונים ותור");
try {
  const sql = postgres(env.DATABASE_URL ?? "", { max: 1, connect_timeout: 5 });
  const rows = await sql`select table_name from information_schema.tables where table_schema='public'`;
  const names = rows.map((r) => r.table_name as string);
  const need = ["clients", "jobs", "api_calls", "inbound_messages"];
  const lost = need.filter((t) => !names.includes(t));
  if (lost.length) bad(`חסרות טבלאות: ${lost.join(", ")}`, "הרץ: npm run db:push");
  else ok("Postgres מחובר, כל הטבלאות קיימות");
  await sql.end();
} catch (e) {
  bad(`Postgres לא מגיב: ${(e as Error).message.slice(0, 60)}`, "פתח את Docker Desktop והרץ: docker compose up -d");
}
try {
  const redis = new Redis(env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true, retryStrategy: () => null });
  redis.on("error", () => { /* reported below, keep the output clean */ });
  await redis.connect();
  await redis.ping();
  ok("Redis מחובר");
  redis.disconnect();
} catch (e) {
  void e;
  bad("Redis לא מגיב", "פתח את Docker Desktop והרץ: docker compose up -d");
}

// 3. the bot itself
console.log("\n3. השרת המקומי");
const port = env.PORT ?? "3000";
try {
  const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  if (res.ok) ok(`השרת עונה על פורט ${port}`);
  else bad(`פורט ${port} עונה אבל לא כמו הבוט (${res.status})`, "תוכנה אחרת תופסת את הפורט. שנה PORT ב‑.env");
} catch {
  bad(`אין תשובה על פורט ${port}`, "בטרמינל נפרד: cd ~/build/build && npm run dev");
}

// 4. ngrok
console.log("\n4. הטאנל (ngrok)");
let publicUrl = "";
try {
  const res = await fetch("http://127.0.0.1:4040/api/tunnels", { signal: AbortSignal.timeout(3000) });
  const data = (await res.json()) as { tunnels: Array<{ public_url: string; config: { addr: string } }> };
  const https = data.tunnels.find((t) => t.public_url.startsWith("https://"));
  if (!https) bad("ngrok רץ אבל בלי כתובת https", "הרץ: ngrok http " + port);
  else {
    publicUrl = https.public_url;
    ok(`כתובת ציבורית: ${publicUrl}`);
    if (!https.config.addr.endsWith(`:${port}`)) bad(`ngrok מצביע על ${https.config.addr} ולא על פורט ${port}`, `עצור אותו והרץ: ngrok http ${port}`);
  }
} catch {
  bad("ngrok לא רץ", `בטרמינל נפרד: ngrok http ${port}`);
}

// 5. end-to-end through the tunnel
if (publicUrl) {
  console.log("\n5. אימות דרך הטאנל");
  try {
    const url = `${publicUrl}/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(env.WA_VERIFY_TOKEN ?? "")}&hub.challenge=ping123`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = (await res.text()).trim();
    if (body === "ping123") ok("מטא תוכל לאמת את הכתובת הזו");
    else if (body.includes("verify token")) bad("ה‑verify token לא תואם", "ודא שבמטא הקלדת בדיוק את הערך של WA_VERIFY_TOKEN");
    else bad(`חזרה תשובה לא צפויה (${res.status})`, "כנראה תוכנה אחרת עונה על הפורט. בדוק את סעיף 3");
  } catch (e) {
    bad(`הטאנל לא מגיע לשרת: ${(e as Error).message.slice(0, 60)}`, "ודא ששני הטרמינלים רצים");
  }
}

// 6. Meta
console.log("\n6. חיבור מול מטא");
const token = env.WA_ACCESS_TOKEN ?? "";
const phoneId = env.WA_PHONE_NUMBER_ID ?? "";
const ver = env.WA_API_VERSION ?? "v25.0";
if (token && phoneId) {
  try {
    const res = await fetch(`https://graph.facebook.com/${ver}/${phoneId}?fields=display_phone_number,webhook_configuration`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json()) as Record<string, any>;
    if (data.error) {
      bad(`הטוקן נדחה: ${data.error.message}`, "צור טוקן חדש ב‑System User והחלף ב‑.env");
    } else {
      ok(`הטוקן תקף. מספר: ${data.display_phone_number}`);
      const registered = data.webhook_configuration?.application ?? "";
      if (!registered) bad("לא רשום Webhook במטא", "WhatsApp → Configuration → Edit, והזן את הכתובת עם /webhook בסוף");
      else if (publicUrl && !registered.startsWith(publicUrl)) {
        bad(`במטא רשומה כתובת אחרת:\n      ${registered}`, `עדכן אותה ל: ${publicUrl}/webhook`);
      } else ok(`Webhook רשום: ${registered}`);
    }
  } catch (e) {
    bad(`אין תקשורת עם מטא: ${(e as Error).message.slice(0, 60)}`, "בדוק חיבור אינטרנט");
  }
} else info("דילוג, חסרים פרטי וואטסאפ");

// 7. AI keys
console.log("\n7. מפתחות AI");
if (env.ANTHROPIC_API_KEY) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(10000),
    });
    if (res.ok) ok("Anthropic תקין");
    else bad(`Anthropic דחה את המפתח (${res.status})`, "צור מפתח חדש ב‑console.anthropic.com וודא שיש יתרה");
  } catch { bad("אין תקשורת עם Anthropic", "בדוק חיבור אינטרנט"); }
}
if (env.GEMINI_API_KEY) {
  const model = env.GEMINI_IMAGE_MODEL ?? "gemini-3-pro-image";
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY }, signal: AbortSignal.timeout(10000),
    });
    if (res.ok) ok(`Gemini תקין, המודל ${model} זמין`);
    else {
      const t = await res.text();
      bad(`Gemini: ${res.status} על המודל ${model}`, t.includes("not found") || res.status === 404
        ? "שם המודל לא קיים. בדוק ב‑aistudio.google.com ועדכן GEMINI_IMAGE_MODEL ב‑.env"
        : "בדוק שהמפתח תקין ושחיוב מופעל בפרויקט");
    }
  } catch { bad("אין תקשורת עם Google", "בדוק חיבור אינטרנט"); }
}
if (env.FAL_KEY) ok("FAL_KEY מוגדר (נבדק רק בייצור סרטון)");
else info("FAL_KEY ריק, פקודת \"סרטון\" תהיה מושבתת");

console.log(problems === 0
  ? "\n\x1b[32mהכל תקין. שלח תמונה עם כיתוב \"לקוח: …\" למספר הטסט.\x1b[0m\n"
  : `\n\x1b[31mנמצאו ${problems} בעיות. תקן לפי החצים למעלה והרץ שוב: npm run doctor\x1b[0m\n`);
process.exit(problems === 0 ? 0 : 1);
