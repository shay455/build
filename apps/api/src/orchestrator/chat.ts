import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { AttachmentRef, Citation, ConversationView, MessageView, SendMessageRequest, StreamEvent } from "@bombot/shared";
import type { Repo } from "../db/repo.js";
import type { LlmProvider } from "../llm/types.js";
import { SafetyFilter } from "../safety/filter.js";
import type { UploadStore } from "../storage/uploads.js";
import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../config/env.js";
import { ImagePolicyError, ImageQuotaError, type ImageService } from "../images/service.js";

type BetaContent = Anthropic.Beta.BetaContentBlockParam;

export interface OrchestratorDeps {
  env: Env;
  repo: Repo;
  llm: LlmProvider;
  uploads: UploadStore;
  images: ImageService;
  log: FastifyBaseLogger;
}

/** DEEP-01..03: research mode. Sent as a mid-conversation system message so the cached system prompt is untouched. */
const RESEARCH_RULES = `Research mode for this turn.
Work in phases and narrate them briefly as you go so the user sees progress:
1. Plan: write 3 to 6 sub-questions that together answer the request (one line each).
2. Search: run web searches for each sub-question; fetch the two or three most authoritative pages; prefer primary sources and recent dates. Note disagreements between sources.
3. Self-check: before writing, list any claim you could not source and any place sources conflict.
4. Report, in this structure (headers allowed in this mode):
   - תקציר / Summary: 3 to 5 sentences.
   - ממצאים / Findings: numbered, each with citations.
   - מחלוקות / Disagreements: where sources differ and why.
   - מה לא נמצא / Not found: what remains unverified.
   - מקורות / Sources are shown by the app from your citations; do not paste a bibliography.
Stay within the search budget; stop searching when new results repeat what you already have.`;

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

  // IMG-01: "/imagine <prompt>" in chat generates an image instead of a text answer.
  const imagine = /^\/imagine\s+([\s\S]+)/i.exec(req.text.trim());
  if (imagine) {
    yield* imageTurn(deps, conversation, assistantId, imagine[1]!.trim(), req.text, signal);
    return;
  }

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

  const research = mode === "research";
  const turnSignal = research
    ? AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(deps.env.RESEARCH_TIMEOUT_MS)])
    : signal;
  try {
    for await (const ev of llm.streamChat({
      messages: history, mode, think, signal: turnSignal,
      ...(research ? { systemAddendum: RESEARCH_RULES, maxWebSearchUses: deps.env.RESEARCH_MAX_WEB_SEARCH_USES, maxTokens: 32000 } : {}),
    })) {
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

/** One image-generation turn inside a chat conversation. The result is stored as an assistant message with an image attachment. */
async function* imageTurn(deps: OrchestratorDeps, conversation: ConversationView, assistantId: string, prompt: string, userText: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const he = /[֐-׿]/.test(userText);
  yield { type: "tool_start", tool: "web_fetch", input: he ? "יוצר תמונה…" : "generating image…" };
  try {
    const img = await deps.images.generate({ prompt, ownerKey: `chat:${conversation.id}`, dailyLimit: 60, signal });
    const text = he ? `הנה התמונה עבור: "${prompt}"` : `Here is the image for: "${prompt}"`;
    yield { type: "tool_result", tool: "web_fetch", ok: true, resultCount: 1 };
    yield { type: "text_delta", text };
    const saved = await deps.repo.insertMessage({
      id: assistantId, conversationId: conversation.id, role: "assistant", text, thinking: null, citations: [],
      attachments: [{ id: img.id, name: `bombot-${img.id.slice(0, 8)}.jpg`, mimeType: "image/generated", sizeBytes: 0 }], usage: null, safety: null,
    });
    yield { type: "done", message: saved };
  } catch (err) {
    const text = err instanceof ImagePolicyError
      ? (he ? "אני לא יוצר תמונות של אנשים אמיתיים או תוכן פוגעני. נסו רעיון אחר." : "I don't generate images of real people or harmful content. Try another idea.")
      : err instanceof ImageQuotaError
        ? (he ? "הגעת למכסת התמונות היומית." : "You've reached today's image quota.")
        : (he ? "יצירת התמונה נכשלה כרגע. נסו שוב מאוחר יותר." : "Image generation failed right now. Try again later.");
    if (!(err instanceof ImagePolicyError) && !(err instanceof ImageQuotaError)) deps.log.error({ err }, "chat image generation failed");
    yield { type: "tool_result", tool: "web_fetch", ok: false, resultCount: 0 };
    yield { type: "text_delta", text };
    const saved = await deps.repo.insertMessage({
      id: assistantId, conversationId: conversation.id, role: "assistant", text, thinking: null, citations: [], attachments: [], usage: null,
      safety: err instanceof ImagePolicyError ? { stage: "input", action: "block", category: "private_person_identification", reason: err.reason } : null,
    });
    yield { type: "done", message: saved };
  }
}
