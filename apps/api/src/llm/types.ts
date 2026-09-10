import type { Citation, Mode, SafetyCategory, UsageSummary } from "@bombot/shared";
import type Anthropic from "@anthropic-ai/sdk";

/** What the orchestrator asks a provider to do for one assistant turn. */
export interface ChatRequest {
  messages: Anthropic.Beta.BetaMessageParam[];
  mode: Mode;
  think: boolean;
  signal?: AbortSignal;
}

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
}

export const EFFORT_BY_MODE: Record<Mode, "low" | "medium" | "high" | "xhigh"> = {
  fast: "low",
  balanced: "medium",
  deep: "high",
};

export function emptyCitationList(): Citation[] {
  return [];
}
