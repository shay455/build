import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../config.js";
import { recordClaudeCall } from "../costs.js";
import { log } from "../logger.js";

export const AdCopySchema = z.object({
  headline: z.string().describe("Hebrew headline, max 6 words, no trailing period"),
  subline: z.string().describe("Hebrew supporting line, max 12 words"),
  cta: z.string().describe("Hebrew call to action, max 4 words, e.g. להזמנה בוואטסאפ"),
  post_captions: z.array(z.string()).length(2).describe("Two Hebrew Instagram/Facebook captions with 3-5 hashtags each"),
  palette: z.object({
    primary: z.string().describe("hex color for backgrounds/text panels, e.g. #3B2A1E"),
    accent: z.string().describe("hex color for the CTA button, must contrast with primary"),
  }),
  text_zone: z.enum(["top", "bottom"]).describe("where the generated image leaves empty space for typography"),
  image_prompt: z.string().describe("English prompt for an image model editing the provided product photo. Must end with: 'no text, no letters, no watermark'"),
  video_prompt: z.string().describe("English prompt for a 5s image-to-video model (camera move, light, motion). Stored for phase 2."),
  style_rationale: z.string().describe("One Hebrew sentence explaining the creative direction to the operator"),
  flags: z.array(z.string()).describe("Hebrew warnings: medical claims, financial promises, alcohol, minors, named competitors. Empty if none."),
});
export type AdCopy = z.infer<typeof AdCopySchema>;

const SYSTEM = `You are the creative director of a small Israeli studio that produces social-media ad creatives for local businesses (bakeries, salons, gyms, shops, services). You receive one or more product photos and a short brief written by the business owner in Hebrew.

Your job: return a complete creative package as JSON.

Rules for the Hebrew copy:
- Write in natural, warm, modern Israeli Hebrew. No literal translations from English, no exclamation marks in the headline.
- Any price, date, phone number, discount or product name that appears in the brief must appear verbatim in the copy.
- Headline max 6 words. Subline max 12 words. CTA max 4 words.
- Do not invent facts (ingredients, awards, years in business) that the brief does not state.

Rules for image_prompt (English):
- The image model EDITS the supplied product photo. Describe scene, surface, lighting, mood and composition around the real product. Never ask it to change, redraw or replace the product itself.
- Leave clear negative space in the ${"text_zone"} third of the frame for typography. Say so explicitly.
- Never request rendered text. End the prompt with: no text, no letters, no watermark.
- Keep people who appear in the photo exactly as they are; do not add new people.

Palette: pick colors that suit the product and the brand colors if given. primary is a deep or muted color that white text reads on; accent is a vivid contrasting color for the button.

flags: list any content that needs a human decision before publishing (medical/health claims, guaranteed financial returns, alcohol, content aimed at minors, direct comparison naming a competitor). Otherwise return an empty array.`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface BriefInput {
  jobId: number;
  clientName: string;
  brief: string;
  style?: string | null;
  brandColors?: { primary?: string | null; accent?: string | null };
  images: Array<{ data: Buffer; mime: "image/jpeg" | "image/png" | "image/webp" }>;
}

/** One Claude call per brief: product photo + owner's text → structured creative package. */
export async function buildBrief(input: BriefInput): Promise<AdCopy> {
  const c = config();
  const brandLine = input.brandColors?.primary
    ? `Brand colors: primary ${input.brandColors.primary}${input.brandColors.accent ? `, accent ${input.brandColors.accent}` : ""}.`
    : "No brand colors given; choose them.";
  const userText = [
    `Client: ${input.clientName}`,
    `Brief from the business owner (Hebrew): """${input.brief}"""`,
    input.style ? `Requested style keyword: ${input.style}` : "No style keyword; choose one and explain in style_rationale.",
    brandLine,
    `Formats: 1080x1080 feed and 1080x1920 story. Typography is added by our software afterwards.`,
  ].join("\n");

  const response = await client.beta.messages.parse({
    model: c.CLAUDE_BRIEF_MODEL,
    max_tokens: 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          ...input.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mime, data: img.data.toString("base64") },
          })),
          { type: "text", text: userText },
        ],
      },
    ],
    output_config: { format: betaZodOutputFormat(AdCopySchema), effort: "medium" },
  });

  await recordClaudeCall(input.jobId, c.CLAUDE_BRIEF_MODEL, "brief", {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  });

  if (response.stop_reason === "refusal") {
    const why = response.stop_details && "explanation" in response.stop_details ? response.stop_details.explanation : "";
    throw new Error(`Claude declined this brief${why ? `: ${why}` : ""}`);
  }
  if (!response.parsed_output) {
    log.error({ content: response.content }, "brief: no parsed output");
    throw new Error("Claude returned no structured output");
  }
  return response.parsed_output;
}
