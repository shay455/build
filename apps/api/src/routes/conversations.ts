import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SendMessageRequest, StreamEvent } from "@bombot/shared";
import type { OrchestratorDeps } from "../orchestrator/chat.js";
import { runChatTurn } from "../orchestrator/chat.js";

const SendSchema = z.object({
  text: z.string().min(1).max(20000),
  mode: z.enum(["fast", "balanced", "deep"]).optional(),
  think: z.boolean().optional(),
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  locale: z.string().max(20).optional(),
});

export function registerConversationRoutes(app: FastifyInstance, deps: OrchestratorDeps) {
  const { repo } = deps;

  app.get("/api/conversations", async () => repo.listConversations());

  app.post("/api/conversations", async (_req, reply) => {
    const c = await repo.createConversation();
    return reply.code(201).send(c);
  });

  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const c = await repo.getConversation(req.params.id);
    if (!c) return reply.code(404).send({ error: "not_found" });
    return c;
  });

  app.delete<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    await repo.deleteConversation(req.params.id);
    return reply.code(204).send();
  });

  /** Streams one assistant turn as Server-Sent Events. */
  app.post<{ Params: { id: string } }>("/api/conversations/:id/messages", async (req, reply) => {
    const parsed = SendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", issues: parsed.error.issues });
    const conversation = await repo.getConversation(req.params.id);
    if (!conversation) return reply.code(404).send({ error: "not_found" });

    // Carry the headers @fastify/cors already computed (origin allow-list) onto the raw response.
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.flushHeaders?.();

    const ac = new AbortController();
    req.raw.on("close", () => ac.abort());
    const write = (ev: StreamEvent) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    const heartbeat = setInterval(() => { if (!reply.raw.writableEnded) reply.raw.write(": ping\n\n"); }, 15000);

    try {
      for await (const ev of runChatTurn(deps, conversation, parsed.data as SendMessageRequest, ac.signal)) write(ev);
    } catch (err) {
      deps.log.error({ err }, "unhandled error in chat turn");
      write({ type: "error", code: "internal", message: "internal error" });
    } finally {
      clearInterval(heartbeat);
      reply.raw.end();
    }
    return reply;
  });
}
