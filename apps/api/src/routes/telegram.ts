import type { FastifyInstance } from "fastify";
import type { Env } from "../config/env.js";
import type { TelegramHandler } from "../telegram/handler.js";
import type { TgUpdate } from "../telegram/api.js";

/** Telegram delivers updates here. We ack immediately and process in the background; Telegram retries slow webhooks. */
export function registerTelegramRoutes(app: FastifyInstance, env: Env, handler: TelegramHandler) {
  app.post("/api/telegram/webhook", async (req, reply) => {
    if (!env.TELEGRAM_BOT_TOKEN) return reply.code(404).send({ error: "telegram_disabled" });
    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) return reply.code(401).send({ error: "bad_secret" });
    const update = req.body as TgUpdate;
    if (typeof update?.update_id !== "number") return reply.code(400).send({ error: "bad_update" });
    handler.handle(update).catch((err) => app.log.error({ err, updateId: update.update_id }, "telegram update failed"));
    return { ok: true };
  });
}
