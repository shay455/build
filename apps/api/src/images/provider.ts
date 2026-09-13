import type { Env } from "../config/env.js";

export interface ImageProvider {
  readonly name: "cloudflare" | "pollinations" | "mock";
  readonly model: string;
  generate(prompt: string, opts: { width: number; height: number; signal?: AbortSignal }): Promise<{ data: Buffer; mimeType: string }>;
}

/** Cloudflare Workers AI. Free daily allowance; FLUX.1 schnell returns base64 JSON. */
export class CloudflareImages implements ImageProvider {
  readonly name = "cloudflare" as const;
  readonly model: string;
  constructor(private readonly env: Env, private readonly fetchImpl: typeof fetch = fetch) { this.model = env.CF_IMAGE_MODEL; }
  async generate(prompt: string, opts: { width: number; height: number; signal?: AbortSignal }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/ai/run/${this.model}`;
    const r = await this.fetchImpl(url, {
      method: "POST", signal: opts.signal,
      headers: { authorization: `Bearer ${this.env.CF_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt, steps: 4, width: opts.width, height: opts.height }),
    });
    if (!r.ok) throw new ImageProviderError(this.name, r.status, await r.text().catch(() => ""));
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const j = (await r.json()) as { success: boolean; result?: { image?: string }; errors?: unknown[] };
      if (!j.success || !j.result?.image) throw new ImageProviderError(this.name, 502, JSON.stringify(j.errors ?? "no image"));
      return { data: Buffer.from(j.result.image, "base64"), mimeType: "image/jpeg" };
    }
    return { data: Buffer.from(await r.arrayBuffer()), mimeType: ct.split(";")[0] || "image/png" };
  }
}

/** Pollinations: keyless fallback. Lower quality, shared public queue. */
export class PollinationsImages implements ImageProvider {
  readonly name = "pollinations" as const;
  readonly model = "flux";
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async generate(prompt: string, opts: { width: number; height: number; signal?: AbortSignal }) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${opts.width}&height=${opts.height}&nologo=true&model=flux`;
    const r = await this.fetchImpl(url, { signal: opts.signal });
    if (!r.ok) throw new ImageProviderError(this.name, r.status, await r.text().catch(() => ""));
    return { data: Buffer.from(await r.arrayBuffer()), mimeType: r.headers.get("content-type")?.split(";")[0] || "image/jpeg" };
  }
}

/** 1x1 PNG for tests and offline dev. */
export class MockImages implements ImageProvider {
  readonly name = "mock" as const;
  readonly model = "mock";
  async generate() {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
    return { data: png, mimeType: "image/png" };
  }
}

export class ImageProviderError extends Error {
  constructor(public readonly provider: string, public readonly status: number, detail: string) {
    super(`${provider} image generation failed (${status}): ${detail.slice(0, 200)}`);
    this.name = "ImageProviderError";
  }
}

/** Primary + fallback chain per IMG-02: Cloudflare first, Pollinations when quota/errors hit. */
export class FallbackImages implements ImageProvider {
  readonly name: ImageProvider["name"];
  readonly model: string;
  constructor(private readonly primary: ImageProvider, private readonly fallback: ImageProvider | null) {
    this.name = primary.name; this.model = primary.model;
  }
  async generate(prompt: string, opts: { width: number; height: number; signal?: AbortSignal }) {
    try {
      return await this.primary.generate(prompt, opts);
    } catch (err) {
      if (!this.fallback) throw err;
      return this.fallback.generate(prompt, opts);
    }
  }
}

export function createImageProvider(env: Env): ImageProvider {
  if (env.IMAGE_PROVIDER === "mock") return new MockImages();
  if (env.IMAGE_PROVIDER === "cloudflare" && env.CF_ACCOUNT_ID && env.CF_API_TOKEN) {
    return new FallbackImages(new CloudflareImages(env), new PollinationsImages());
  }
  return new PollinationsImages();
}
