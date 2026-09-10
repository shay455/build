import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { blockedDomains } from "../config/env.js";
import { estimateCostUsd } from "./pricing.js";
import { EFFORT_BY_MODE, type ChatRequest, type LlmProvider, type ProviderEvent, type SafetyVerdict } from "./types.js";
import { SAFETY_POLICY } from "../safety/policy.js";

const SafetySchema = z.object({
  action: z.enum(["allow", "block"]),
  category: z.enum([
    "hate", "incitement", "private_person_identification", "dangerous_medical_or_legal",
    "sexual_minors", "self_harm", "prompt_injection", "spam",
  ]).nullable(),
  reason: z.string(),
});

/** Resumes at most this many `pause_turn` stops per assistant turn (server-tool loops). */
const MAX_PAUSE_RESUMES = 3;

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(private readonly env: Env, private readonly systemPrompt: string) {
    // Credentials resolve from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile.
    this.client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : new Anthropic();
  }

  private tools() {
    const blocked = blockedDomains(this.env);
    return [
      {
        type: "web_search_20260209" as const,
        name: "web_search" as const,
        max_uses: this.env.MAX_WEB_SEARCH_USES,
        ...(blocked.length ? { blocked_domains: blocked } : {}),
      },
      {
        type: "web_fetch_20260209" as const,
        name: "web_fetch" as const,
        max_uses: this.env.MAX_WEB_FETCH_USES,
        citations: { enabled: true },
        ...(blocked.length ? { blocked_domains: blocked } : {}),
      },
    ];
  }

  async *streamChat(req: ChatRequest): AsyncIterable<ProviderEvent> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [...req.messages];
    let text = "";
    let thinking = "";
    const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearch: 0 };
    let stopReason = "end_turn";
    let servedModel = this.env.MAIN_MODEL;

    for (let attempt = 0; attempt <= MAX_PAUSE_RESUMES; attempt++) {
      // Prompt-cache friendly ordering: tools -> system (cached) -> history. Nothing volatile before the breakpoint.
      const stream = this.client.beta.messages.stream(
        {
          model: this.env.MAIN_MODEL,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: req.think ? { type: "adaptive", display: "summarized" } : { type: "adaptive" },
          output_config: { effort: EFFORT_BY_MODE[req.mode] },
          system: [{ type: "text", text: this.systemPrompt, cache_control: { type: "ephemeral" } }],
          tools: this.tools(),
          messages,
        },
        { signal: req.signal },
      );

      // Per-index scratch for server_tool_use input JSON so we can report the query when the block closes.
      const toolInputs = new Map<number, { tool: "web_search" | "web_fetch"; json: string }>();

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const b = event.content_block;
          if (b.type === "server_tool_use" && (b.name === "web_search" || b.name === "web_fetch")) {
            toolInputs.set(event.index, { tool: b.name, json: "" });
          } else if (b.type === "web_search_tool_result") {
            const ok = Array.isArray(b.content);
            yield { type: "tool_result", tool: "web_search", ok, resultCount: ok ? (b.content as unknown[]).length : 0 };
          } else if (b.type === "web_fetch_tool_result") {
            const ok = b.content.type === "web_fetch_result";
            yield { type: "tool_result", tool: "web_fetch", ok, resultCount: ok ? 1 : 0 };
          }
        } else if (event.type === "content_block_delta") {
          const d = event.delta;
          if (d.type === "text_delta") {
            text += d.text;
            yield { type: "text_delta", text: d.text };
          } else if (d.type === "thinking_delta") {
            thinking += d.thinking;
            if (req.think) yield { type: "thinking_delta", text: d.thinking };
          } else if (d.type === "citations_delta") {
            const c = d.citation;
            if (c.type === "web_search_result_location") {
              yield { type: "citation", url: c.url, title: c.title, citedText: c.cited_text };
            }
          } else if (d.type === "input_json_delta") {
            const t = toolInputs.get(event.index);
            if (t) t.json += d.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          const t = toolInputs.get(event.index);
          if (t) {
            toolInputs.delete(event.index);
            yield { type: "tool_start", tool: t.tool, input: summarizeToolInput(t.json) };
          }
        }
      }

      const final = await stream.finalMessage();
      servedModel = final.model;
      totals.input += final.usage.input_tokens;
      totals.output += final.usage.output_tokens;
      totals.cacheRead += final.usage.cache_read_input_tokens ?? 0;
      totals.cacheWrite += final.usage.cache_creation_input_tokens ?? 0;
      totals.webSearch += final.usage.server_tool_use?.web_search_requests ?? 0;
      stopReason = final.stop_reason ?? "end_turn";

      if (final.stop_reason === "refusal") {
        yield {
          type: "refusal",
          category: final.stop_details?.category ?? null,
          explanation: final.stop_details?.explanation ?? null,
        };
        break;
      }
      if (final.stop_reason === "pause_turn" && attempt < MAX_PAUSE_RESUMES) {
        // Server-side tool loop paused; echo the assistant turn back unchanged and continue.
        messages.push({ role: "assistant", content: final.content });
        continue;
      }
      break;
    }

    yield {
      type: "final",
      text,
      thinking,
      stopReason,
      usage: {
        model: servedModel,
        inputTokens: totals.input,
        outputTokens: totals.output,
        cacheReadInputTokens: totals.cacheRead,
        cacheCreationInputTokens: totals.cacheWrite,
        webSearchRequests: totals.webSearch,
        estimatedCostUsd: estimateCostUsd({
          model: servedModel, inputTokens: totals.input, outputTokens: totals.output,
          cacheReadInputTokens: totals.cacheRead, cacheCreationInputTokens: totals.cacheWrite, webSearchRequests: totals.webSearch,
        }),
      },
    };
  }

  async classifySafety(input: { stage: "input" | "output"; text: string }): Promise<SafetyVerdict> {
    const response = await this.client.messages.parse({
      model: this.env.SAFETY_MODEL,
      max_tokens: 512,
      system: [{ type: "text", text: SAFETY_POLICY, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `Stage: ${input.stage}\n<content>\n${input.text.slice(0, 12000)}\n</content>`,
      }],
      output_config: { format: zodOutputFormat(SafetySchema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) return { action: "allow", category: null, reason: "classifier returned no parseable output; failing open on input, checked again on output" };
    return parsed;
  }
}

function summarizeToolInput(json: string): string {
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    return String(v.query ?? v.url ?? "");
  } catch {
    return "";
  }
}
