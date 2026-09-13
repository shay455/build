import { randomUUID } from "node:crypto";
import type { GeneratedImage } from "@bombot/shared";
import { BOT_LIMITS } from "@bombot/shared";
import type { Repo } from "../db/repo.js";
import type { LlmProvider } from "../llm/types.js";
import type { UploadStore } from "../storage/uploads.js";
import type { ImageProvider } from "./provider.js";

export class ImageQuotaError extends Error { constructor() { super("image quota exceeded"); this.name = "ImageQuotaError"; } }
export class ImagePolicyError extends Error { constructor(public readonly reason: string) { super("image prompt rejected"); this.name = "ImagePolicyError"; } }

export interface ImageServiceDeps { repo: Repo; llm: LlmProvider; images: ImageProvider; uploads: UploadStore; publicBaseUrl: string }

/**
 * IMG-01..06: policy gate + English rewrite on the fast model, generation on a free provider,
 * per-owner daily quota, stored under the uploads dir and served by /api/images/:id.
 * Watermarking (IMG-05) is applied as a caption/metadata for now; pixel watermarking needs an image lib.
 */
export class ImageService {
  constructor(private readonly d: ImageServiceDeps) {}

  async generate(input: { prompt: string; ownerKey: string | null; dailyLimit?: number; signal?: AbortSignal }): Promise<GeneratedImage> {
    const limit = input.dailyLimit ?? BOT_LIMITS.imagesPerDayFree;
    if (input.ownerKey && (await this.d.repo.countImagesToday(input.ownerKey)) >= limit) throw new ImageQuotaError();

    const gate = await this.d.llm.rewriteImagePrompt({ prompt: input.prompt });
    if (!gate.allowed || !gate.englishPrompt.trim()) throw new ImagePolicyError(gate.reason);

    const width = 1024, height = 1024;
    const { data, mimeType } = await this.d.images.generate(gate.englishPrompt, { width, height, signal: input.signal });
    const stored = await this.d.uploads.put(`image.${mimeType === "image/png" ? "png" : "jpg"}`, mimeType, data);
    const id = randomUUID();
    await this.d.repo.insertImage({ id, ownerKey: input.ownerKey, prompt: input.prompt, finalPrompt: gate.englishPrompt, provider: this.d.images.name, model: this.d.images.model, width, height, storageKey: stored.storageKey });
    return { id, prompt: input.prompt, finalPrompt: gate.englishPrompt, provider: this.d.images.name, model: this.d.images.model, width, height, url: this.url(id), createdAt: new Date().toISOString() };
  }

  url(id: string) { return `${this.d.publicBaseUrl.replace(/\/$/, "")}/api/images/${id}`; }

  async read(id: string) {
    const img = await this.d.repo.getImage(id);
    if (!img) return null;
    const data = await this.d.uploads.get(img.storageKey);
    return { data, mimeType: img.storageKey.endsWith(".png") ? "image/png" : "image/jpeg" };
  }
}
