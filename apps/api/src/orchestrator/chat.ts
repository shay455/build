import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { AttachmentRef, Citation, ConversationView, MessageView, SendMessageRequest, StreamEvent } from "@bombot/shared";
import type { Repo } from "../db/repo.js";
import type { LlmProvider } from "../llm/types.js";
import { SafetyFilter } from "../safety/filter.js";
import type { UploadStore } from "../storage/uploads.js";
import type { FastifyBaseLogger } from "fastify";

type BetaContent = Anthropic.Beta.BetaContentBlockParam;

export interface OrchestratorDeps {
  repo: Repo;
  llm: LlmProvider;
  uploads: UploadStore;
  log: FastifyBaseLogger;
}

/**
 * One assistant turn, end to end:
 * input safety -> build history with attachments -> stream from the model -> output safety -> persist.
 * Yields public StreamEvents; the route layer serializes them as SSE.
 */
export async function* runChatTurn(
  deps: OrchestratorDeps,
  conversation: ConversationView,
  req: SendMessageRequest,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const { repo, llm, uploads, log } = deps;
  const safety = new SafetyFilter(llm);
  const mode = req.mode ?? "balanced";
  const think = req.think ?? false;
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;

  const attachments = await repo.getAttachments(req.attachmentIds ?? []);
  const userMessage = await repo.insertMessage({
    id: randomUUID(), conversationId: conversation.id, role: "user", text: req.text, thinking: null,
    citations: [], attachments: attachments.map(stripKey), usage: null, safety: null,
  });
  await repo.setTitleIfEmpty(conversation.id, req.text.replace(/\s+/g, " ").trim());

  const assistantId = randomUUID();
  yield { type: "message_start", messageId: assistantId, conversationId: conversation.id };

  // 1. Input safety gate. A block ends the turn with a fixed reply; nothing reaches the main model.
  const inputCheck = await safety.check("input", req.text);
  if (inputCheck.action !== "allow") {
    await repo.logSafety({ ...inputCheck, conversationId: conversation.id, messageId: userMessage.id });
    yield { type: "safety", outcome: inputCheck };
    const text = safety.replacementText("input", req.text);
    yield { type: "text_delta", text };
    const saved = await repo.insertMessage({
      id: assistantId, conversationId: conversation.id, role: "assistant", text, thinking: null,
      citations: [], attachments: [], usage: null, safety: inputCheck,
    });
    yield { type: "done", message: saved };
    return;
  }

  // 2. Build the model-facing history. Prior turns are text only; the new turn carries attachments.
  const history: Anthropic.Beta.BetaMessageParam[] = conversation.messages
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.text }));
  const newTurn: BetaContent[] = [];
  for (const a of attachments) {
    const block = await attachmentToBlock(uploads, a);
    if (block) newTurn.push(block);
  }
  newTurn.push({ type: "text", text: req.text });
  history.push({ role: "user", content: newTurn });

  // 3. Stream from the provider, mapping citations to stable [n] indices.
  const citations: Citation[] = [];
  const byUrl = new Map<string, Citation>();
  let text = "";
  let thinking = "";
  let usage: MessageView["usage"] = null;
  let refused: { category: string | null } | null = null;

  try {
    for await (const ev of llm.streamChat({ messages: history, mode, think, signal })) {
      switch (ev.type) {
        case "text_delta":
          if (firstTokenAt === null) firstTokenAt = Date.now();
          text += ev.text;
          yield { type: "text_delta", text: ev.text };
          break;
        case "thinking_delta":
          if (firstTokenAt === null) firstTokenAt = Date.now();
          thinking += ev.text;
          yield { type: "thinking_delta", text: ev.text };
          break;
        case "citation": {
          let c = byUrl.get(ev.url);
          if (!c) {
            c = { index: citations.length + 1, url: ev.url, title: ev.title, citedText: ev.citedText };
            byUrl.set(ev.url, c);
            citations.push(c);
            yield { type: "citation", citation: c };
          }
          break;
        }
        case "tool_start":
          yield { type: "tool_start", tool: ev.tool, input: ev.input };
          break;
        case "tool_result":
          yield { type: "tool_result", tool: ev.tool, ok: ev.ok, resultCount: ev.resultCount };
          break;
        case "refusal":
          refused = { category: ev.category };
          break;
        case "final":
          usage = ev.usage;
          if (!text && ev.text) text = ev.text;
          if (!thinking && ev.thinking) thinking = ev.thinking;
          break;
      }
    }
  } catch (err) {
    log.error({ err, conversationId: conversation.id }, "provider stream failed");
    yield { type: "error", code: "provider_error", message: userFacingError(err, req.text) };
    if (!text) return;
  }

  // 4. Output safety gate. Replaces the text if the classifier objects; the original is kept in logs only.
  let safetyOutcome = await safety.check("output", text);
  if (refused) {
    safetyOutcome = { stage: "output", action: "replace", category: null, reason: `provider refusal (${refused.category ?? "unknown"})` };
  }
  if (safetyOutcome.action !== "allow") {
    log.warn({ conversationId: conversation.id, reason: safetyOutcome.reason, original: text.slice(0, 500) }, "output replaced by safety layer");
    text = safety.replacementText("output", req.text);
    citations.length = 0;
    await repo.logSafety({ ...safetyOutcome, conversationId: conversation.id, messageId: assistantId });
    yield { type: "safety", outcome: safetyOutcome };
  }

  if (usage) {
    yield { type: "usage", usage };
    await repo.logUsage({
      ...usage, conversationId: conversation.id, messageId: assistantId,
      latencyMs: Date.now() - startedAt, firstTokenMs: firstTokenAt ? firstTokenAt - startedAt : null,
    });
  }

  const saved = await repo.insertMessage({
    id: assistantId, conversationId: conversation.id, role: "assistant", text,
    thinking: think && thinking ? thinking : null, citations, attachments: [], usage,
    safety: safetyOutcome.action === "allow" ? null : safetyOutcome,
  });
  yield { type: "done", message: saved };
}

const stripKey = (a: AttachmentRef & { storageKey: string }): AttachmentRef =>
  ({ id: a.id, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes });

async function attachmentToBlock(uploads: UploadStore, a: AttachmentRef & { storageKey: string }): Promise<BetaContent | null> {
  const buf = await uploads.get(a.storageKey);
  if (a.mimeType.startsWith("image/")) {
    return {
      type: "image",
      source: { type: "base64", media_type: a.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: buf.toString("base64") },
    };
  }
  if (a.mimeType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") }, title: a.name };
  }
  if (a.mimeType.startsWith("text/")) {
    return { type: "document", source: { type: "text", media_type: "text/plain", data: buf.toString("utf8") }, title: a.name };
  }
  return null;
}

function userFacingError(err: unknown, userText: string): string {
  const he = /[֐-׿]/.test(userText);
  const status = (err as { status?: number }).status;
  if (status === 429) return he ? "העומס גבוה כרגע. נסו שוב בעוד רגע." : "We're under heavy load. Please try again in a moment.";
  if (status === 401) return he ? "שגיאת הגדרה בצד השרת (אימות מול ספק המודל)." : "Server configuration error (model provider authentication).";
  return he ? "משהו השתבש בזמן יצירת התשובה. נסו שוב." : "Something went wrong while generating the answer. Please try again.";
}
