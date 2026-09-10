/**
 * Shared contracts between the Bombot API and the web client.
 * Keep this file dependency-free: it is imported by both sides.
 */

/** User-facing effort selector. Maps to Claude `output_config.effort`. */
export type Mode = "fast" | "balanced" | "deep";

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
};

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
