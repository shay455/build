import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { recordImageCall } from "../costs.js";
import { log } from "../logger.js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export type AspectRatio = "1:1" | "9:16" | "4:5" | "16:9";
export type ImageSize = "1K" | "2K" | "4K";

export interface GenerateInput {
  jobId: number;
  prompt: string;
  references: Array<{ data: Buffer; mime: string }>;
  aspectRatio?: AspectRatio;
  size?: ImageSize;
  /** Small prompt suffix that makes each variant differ (angle, surface, light). */
  variation?: string;
}

/** One image from Nano Banana Pro, editing the supplied product photo(s). Returns PNG/JPEG bytes as sent by Google. */
export async function generateImage(input: GenerateInput): Promise<{ data: Buffer; mime: string }> {
  const c = config();
  const size = input.size ?? "2K";
  const prompt = input.variation ? `${input.prompt}\nVariation: ${input.variation}` : input.prompt;

  const response = await ai.models.generateContent({
    model: c.GEMINI_IMAGE_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          ...input.references.map((r) => ({ inlineData: { mimeType: r.mime, data: r.data.toString("base64") } })),
          { text: prompt },
        ],
      },
    ],
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: input.aspectRatio ?? "1:1", imageSize: size },
    },
  });

  await recordImageCall(input.jobId, c.GEMINI_IMAGE_MODEL, "generate", size);

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img?.inlineData?.data) {
    const finish = response.candidates?.[0]?.finishReason;
    log.error({ finish, text: parts.map((p) => p.text).filter(Boolean) }, "gemini returned no image");
    throw new Error(`Image model returned no image (${finish ?? "unknown reason"})`);
  }
  return { data: Buffer.from(img.inlineData.data, "base64"), mime: img.inlineData.mimeType ?? "image/png" };
}

const VARIATIONS = [
  "hero composition, product centered, straight-on camera",
  "three-quarter angle, product slightly off-center, more environment visible",
  "close-up with dramatic side light and shallow depth of field",
  "top-down flat lay on a complementary surface",
  "product on a plain seamless backdrop in the palette's primary color, studio light",
];

/** N variants in parallel. Failures of individual variants are logged and dropped; at least one must succeed. */
export async function generateVariants(base: Omit<GenerateInput, "variation">, count = 3, offset = 0) {
  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => generateImage({ ...base, variation: VARIATIONS[(i + offset) % VARIATIONS.length] })),
  );
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const failed = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
  for (const f of failed) log.warn({ err: f.reason }, "variant failed");
  if (ok.length === 0) throw new Error(`All ${count} image variants failed: ${String(failed[0]?.reason)}`);
  return ok;
}
