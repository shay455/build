/** Registers the webhook with Telegram. Usage: PUBLIC_API_URL=https://api.example.com npm run telegram:webhook --workspace apps/api */
import { loadEnv } from "../src/config/env.js";
import { TelegramHttpApi } from "../src/telegram/api.js";

const env = loadEnv();
if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is empty");
if (!env.TELEGRAM_WEBHOOK_SECRET) throw new Error("TELEGRAM_WEBHOOK_SECRET is empty (generate one: openssl rand -hex 24)");
const url = `${env.PUBLIC_API_URL.replace(/\/$/, "")}/api/telegram/webhook`;
const ok = await new TelegramHttpApi(env.TELEGRAM_BOT_TOKEN).setWebhook(url, env.TELEGRAM_WEBHOOK_SECRET);
console.log(ok ? `webhook set: ${url}` : "setWebhook returned false");
