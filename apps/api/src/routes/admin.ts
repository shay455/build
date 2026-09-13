import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../config/env.js";
import type { Repo } from "../db/repo.js";
import type { TelegramApi } from "../telegram/api.js";
import { KILL_SWITCH_KEY } from "../telegram/handler.js";

const SettingsSchema = z.object({
  respondMode: z.enum(["mention_only", "commands_too"]).optional(),
  language: z.enum(["auto", "he", "en", "ar"]).optional(),
  blockedTopics: z.array(z.string().max(60)).max(50).optional(),
  enabled: z.boolean().optional(),
});

/** MENT-09: operator dashboard API. Bearer ADMIN_TOKEN. Disabled entirely when no token is configured. */
export function registerAdminRoutes(app: FastifyInstance, env: Env, deps: { repo: Repo; tg: TelegramApi | null }) {
  if (!env.ADMIN_TOKEN) { app.log.warn("ADMIN_TOKEN empty: admin routes disabled"); return; }
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${env.ADMIN_TOKEN}`) return reply.code(401).send({ error: "unauthorized" });
  };

  app.get("/api/admin/bot/state", { preHandler: guard }, async () => ({
    enabled: await deps.repo.getState<boolean>(KILL_SWITCH_KEY, true),
  }));

  /** Emergency kill switch: {"enabled": false} silences the bot everywhere within one request. */
  app.post("/api/admin/bot/state", { preHandler: guard }, async (req, reply) => {
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    await deps.repo.setState(KILL_SWITCH_KEY, body.data.enabled);
    app.log.warn({ enabled: body.data.enabled }, "bot kill switch changed");
    return { enabled: body.data.enabled };
  });

  app.get("/api/admin/bot/requests", { preHandler: guard }, async (req) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 50), 200);
    return deps.repo.listBotRequests(limit);
  });

  /** Deletes the bot's reply in the chat and marks the request. Target: under one minute from flag to gone. */
  app.delete<{ Params: { id: string } }>("/api/admin/bot/requests/:id", { preHandler: guard }, async (req, reply) => {
    const r = await deps.repo.getBotRequest(req.params.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    if (r.replyMessageId && deps.tg) {
      await deps.tg.deleteMessage(r.chatId, Number(r.replyMessageId)).catch((err) => app.log.warn({ err }, "deleteMessage failed"));
    }
    await deps.repo.markBotRequest(r.id, "deleted");
    return { ok: true };
  });

  app.get<{ Params: { chatId: string } }>("/api/admin/bot/chats/:chatId/settings", { preHandler: guard }, async (req) =>
    deps.repo.getChatSettings(req.params.chatId));

  app.put<{ Params: { chatId: string } }>("/api/admin/bot/chats/:chatId/settings", { preHandler: guard }, async (req, reply) => {
    const body = SettingsSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", issues: body.error.issues });
    const next = { ...(await deps.repo.getChatSettings(req.params.chatId)), ...body.data };
    await deps.repo.saveChatSettings(next);
    return next;
  });
}
