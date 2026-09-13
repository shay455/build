import { fal } from "@fal-ai/client";
import { config } from "../config.js";
import { recordVideoCall } from "../costs.js";
import { log } from "../logger.js";

/**
 * Image-to-video through fal.ai (Kling v3 Standard by default). Only runs when the operator asks with "סרטון".
 * Endpoint and input names follow fal's Kling v3 API page; verify on the first real run and adjust FAL_VIDEO_MODEL if needed.
 */
export interface VideoInput {
  jobId: number;
  image: Buffer;
  prompt: string;
  seconds: 5 | 10;
}

export async function generateVideo(input: VideoInput): Promise<Buffer> {
  const c = config();
  if (!c.FAL_KEY) throw new Error("FAL_KEY is not set; add it to .env to enable video");
  fal.config({ credentials: c.FAL_KEY });

  const file = new File([new Uint8Array(input.image)], `job-${input.jobId}.jpg`, { type: "image/jpeg" });
  const imageUrl = await fal.storage.upload(file);

  const result = await fal.subscribe(c.FAL_VIDEO_MODEL, {
    input: {
      prompt: input.prompt,
      image_url: imageUrl,
      duration: String(input.seconds),
      aspect_ratio: "9:16",
      generate_audio: true,
      negative_prompt: "text, letters, watermark, distortion, extra objects",
    },
    logs: false,
  });
  await recordVideoCall(input.jobId, c.FAL_VIDEO_MODEL, input.seconds);

  const data = result.data as { video?: { url?: string } };
  const url = data?.video?.url;
  if (!url) {
    log.error({ data }, "fal returned no video url");
    throw new Error("Video model returned no video");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`video download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
