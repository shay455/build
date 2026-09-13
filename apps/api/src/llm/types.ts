import type { BotIntent, Citation, Mode, SafetyCategory, UsageSummary, Verdict } from "@bombot/shared";
import type Anthropic from "@anthropic-ai/sdk";

/** What the orchestrator asks a provider to do for one assistant turn. */
export interface ChatRequest {
  messages: Anthropic.Beta.BetaMessageParam[];
  mode: Mode;
  think: boolean;
  signal?: AbortSignal;
  /**
   * Route-specific operator instructions (research mode, mention bot). Sent as a mid-conversation
   * system message so the cached top-level system prompt is untouched.
   */
  systemAddendum?: string;
  /** Overrides the default web_search max_uses (research mode raises it). */
  maxWebSearchUses?: number;
  maxTokens?: number;
}

export interface IntentResult { intent: BotIntent; claim: string | null; reason: string }
export interface VerdictResult { verdict: Verdict; confidence: number }
export interface ImagePromptResult { allowed: boolean; reason: string; englishPrompt: string }

/** Provider-neutral stream. The orchestrator maps these to public StreamEvents. */
export type ProviderEvent =
  | { type: "thinking_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "citation"; url: string; title: string | null; citedText: string | null }
  | { type: "tool_start"; tool: "web_search" | "web_fetch"; input: string }
  | { type: "tool_result"; tool: "web_search" | "web_fetch"; ok: boolean; resultCount: number }
  | { type: "refusal"; category: string | null; explanation: string | null }
  | { type: "final"; text: string; thinking: string; usage: UsageSummary; stopReason: string };

export interface SafetyVerdict {
  action: "allow" | "block";
  category: SafetyCategory | null;
  reason: string;
}

export interface LlmProvider {
  readonly name: string;
  streamChat(req: ChatRequest): AsyncIterable<ProviderEvent>;
  /** Fast classifier used before and after the main call. */
  classifySafety(input: { stage: "input" | "output"; text: string }): Promise<SafetyVerdict>;
  /** Mention bot: what does the user want from the tagged message? */
  classifyIntent(input: { request: string; target: string | null; hasImage: boolean }): Promise<IntentResult>;
  /** Mention bot: read a finished fact-check answer and extract a structured verdict. */
  extractVerdict(input: { claim: string; answer: string }): Promise<VerdictResult>;
  /** Images: policy check + rewrite to a strong English prompt for an open image model. */
  rewriteImagePrompt(input: { prompt: string }): Promise<ImagePromptResult>;
}

export const EFFORT_BY_MODE: Record<Mode, "low" | "medium" | "high" | "xhigh"> = {
  fast: "low",
  balanced: "medium",
  deep: "high",
  research: "xhigh",
};

export function emptyCitationList(): Citation[] {
  return [];
}
