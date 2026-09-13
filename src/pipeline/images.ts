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
}

/** One image from Nano Banana Pro, editing the supplied product photo(s). */
export async function generateImage(input: GenerateInput): Promise<{ data: Buffer; mime: string }> {
  const c = config();
  const size = input.size ?? "2K";

  const response = await ai.models.generateContent({
    model: c.GEMINI_IMAGE_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          ...input.references.map((r) => ({ inlineData: { mimeType: r.mime, data: r.data.toString("base64") } })),
          { text: input.prompt },
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

/** Suffixes for "עוד גרסה": push an existing concept somewhere new without rewriting the brief. */
export const EXTRA_VARIATIONS = [
  "Change the camera to a low three-quarter angle and use warm late-afternoon light.",
  "Top-down flat lay, cooler daylight, more empty surface around the product.",
  "Tight close-up with shallow depth of field and a single dramatic side light.",
  "Wider shot with more environment visible, soft overcast light.",
];
