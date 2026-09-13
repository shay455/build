import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import { recordClaudeCall } from "../costs.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RankSchema = z.object({
  best_index: z.number().int().describe("0-based index of the strongest variant"),
  reason: z.string().describe("One short Hebrew sentence for the operator"),
});

/** Cheap Haiku call: which of the variants best serves the brief? The operator can override with `בחר N`. */
export async function rankVariants(jobId: number, brief: string, headline: string, variants: Buffer[]) {
  const c = config();
  const response = await client.messages.parse({
    model: c.CLAUDE_UTILITY_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          ...variants.flatMap((v, i) => [
            { type: "text" as const, text: `Variant ${i}:` },
            { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: v.toString("base64") } },
          ]),
          {
            type: "text",
            text: `These are candidate backgrounds for a social ad. Brief (Hebrew): "${brief}". Headline that will be overlaid: "${headline}". Pick the variant where the product looks most appealing and true to the original, with clean space for the headline. Answer in the JSON format.`,
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(RankSchema) },
  });
  await recordClaudeCall(jobId, c.CLAUDE_UTILITY_MODEL, "rank", {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
  const out = response.parsed_output;
  if (!out || out.best_index < 0 || out.best_index >= variants.length) return { best_index: 0, reason: "" };
  return out;
}
