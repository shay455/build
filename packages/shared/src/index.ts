/**
 * Shared contracts between the Bombot API and the web client.
 * Keep this file dependency-free: it is imported by both sides.
 */

/** User-facing effort selector. Maps to Claude `output_config.effort`. */
export type Mode = "fast" | "balanced" | "deep" | "research";

export type Role = "user" | "assistant";

export interface Citation {
  /** 1-based index shown to the user as [n]. Stable within one assistant message. */
  index: number;
  url: string;
  title: string | null;
  /** The exact passage the model relied on, when the provider returns it. */
  citedText: string | null;
}

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  /** Estimated cost in USD, computed server-side from the price table. */
  estimatedCostUsd: number;
  model: string;
}

export interface MessageView {
  id: string;
  conversationId: string;
  role: Role;
  text: string;
  /** Summarized reasoning, only present when the user asked for Think mode. */
  thinking: string | null;
  citations: Citation[];
  attachments: AttachmentRef[];
  usage: UsageSummary | null;
  /** Set when the safety layer replaced or blocked the model's output. */
  safety: SafetyOutcome | null;
  createdAt: string;
}

export interface ConversationView {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: MessageView[];
}

export type SafetyCategory =
  | "hate"
  | "incitement"
  | "private_person_identification"
  | "dangerous_medical_or_legal"
  | "sexual_minors"
  | "self_harm"
  | "prompt_injection"
  | "spam";

export interface SafetyOutcome {
  stage: "input" | "output";
  action: "allow" | "block" | "replace";
  category: SafetyCategory | null;
  /** Short operator-facing reason. Never shown verbatim to end users. */
  reason: string;
}

/** Request body for POST /api/conversations/:id/messages */
export interface SendMessageRequest {
  text: string;
  mode?: Mode;
  think?: boolean;
  attachmentIds?: string[];
  /** BCP-47 hint from the client; the model still answers in the user's language. */
  locale?: string;
}

/**
 * Server-Sent Events emitted while an assistant message is being produced.
 * The `event:` field carries `type`; `data:` carries the JSON payload.
 */
export type StreamEvent =
  | { type: "message_start"; messageId: string; conversationId: string }
  | { type: "thinking_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "citation"; citation: Citation }
  | { type: "tool_start"; tool: "web_search" | "web_fetch"; input: string }
  | { type: "tool_result"; tool: "web_search" | "web_fetch"; ok: boolean; resultCount: number }
  | { type: "safety"; outcome: SafetyOutcome }
  | { type: "usage"; usage: UsageSummary }
  | { type: "done"; message: MessageView }
  | { type: "error"; code: string; message: string };

export const MODE_LABELS: Record<Mode, { he: string; en: string }> = {
  fast: { he: "מהיר", en: "Fast" },
  balanced: { he: "מאוזן", en: "Balanced" },
  deep: { he: "מעמיק", en: "Deep" },
  research: { he: "מחקר", en: "Research" },
};

/* ---------- Phase B: mention bot, images ---------- */

export type BotPlatform = "telegram";

export type BotIntent = "fact_check" | "explain" | "translate" | "summarize" | "chat" | "image" | "spam" | "injection";

export type Verdict = "true" | "partly_true" | "misleading" | "false" | "unverifiable" | "not_a_claim";

export const VERDICT_LABELS: Record<Verdict, { he: string; en: string; emoji: string }> = {
  true: { he: "נכון", en: "True", emoji: "✅" },
  partly_true: { he: "נכון חלקית", en: "Partly true", emoji: "🟡" },
  misleading: { he: "מטעה", en: "Misleading", emoji: "⚠️" },
  false: { he: "שגוי", en: "False", emoji: "❌" },
  unverifiable: { he: "לא ניתן לאמת", en: "Unverifiable", emoji: "❔" },
  not_a_claim: { he: "אין כאן טענה עובדתית", en: "No factual claim", emoji: "💬" },
};

export interface FactCheckResult {
  verdict: Verdict;
  /** 0..1 */
  confidence: number;
  text: string;
  citations: Citation[];
  usage: UsageSummary | null;
}

/** One handled bot request, as shown in the operator dashboard. */
export interface BotRequestView {
  id: string;
  platform: BotPlatform;
  chatId: string;
  chatTitle: string | null;
  userId: string;
  userName: string | null;
  intent: BotIntent;
  requestText: string;
  replyText: string | null;
  replyMessageId: string | null;
  verdict: Verdict | null;
  confidence: number | null;
  citations: Citation[];
  safety: SafetyOutcome | null;
  usage: UsageSummary | null;
  latencyMs: number | null;
  status: "answered" | "silent" | "rate_limited" | "blocked" | "error" | "deleted";
  createdAt: string;
}

export interface ChatSettings {
  chatId: string;
  /** mention_only: answer only when @mentioned or replied to. commands_too: also plain /check etc. */
  respondMode: "mention_only" | "commands_too";
  language: "auto" | "he" | "en" | "ar";
  blockedTopics: string[];
  enabled: boolean;
}

export interface GeneratedImage {
  id: string;
  prompt: string;
  /** The rewritten English prompt actually sent to the image model. */
  finalPrompt: string;
  provider: "cloudflare" | "pollinations" | "mock";
  model: string;
  width: number;
  height: number;
  url: string;
  createdAt: string;
}

export const BOT_LIMITS = {
  telegramReplyChars: 1200,
  xReplyChars: 550,
  freePerHour: 5,
  subscriberPerHour: 30,
  imagesPerDayFree: 10,
} as const;

export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
export const ALLOWED_UPLOAD_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;
