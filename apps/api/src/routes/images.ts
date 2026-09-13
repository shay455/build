import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ImagePolicyError, ImageQuotaError, type ImageService } from "../images/service.js";

export function registerImageRoutes(app: FastifyInstance, images: ImageService) {
  app.post("/api/images", async (req, reply) => {
    const body = z.object({ prompt: z.string().min(2).max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    try {
      const img = await images.generate({ prompt: body.data.prompt, ownerKey: `web:${req.ip}`, dailyLimit: 60, signal: AbortSignal.timeout(60_000) });
      return reply.code(201).send(img);
    } catch (err) {
      if (err instanceof ImagePolicyError) return reply.code(422).send({ error: "policy", message: "לא יוצרים תמונות של אנשים אמיתיים או תוכן פוגעני." });
      if (err instanceof ImageQuotaError) return reply.code(429).send({ error: "quota", message: "הגעת למכסת התמונות היומית." });
      app.log.error({ err }, "image generation failed");
      return reply.code(502).send({ error: "provider", message: "יצירת התמונה נכשלה. נסו שוב." });
    }
  });

  app.get<{ Params: { id: string } }>("/api/images/:id", async (req, reply) => {
    const img = await images.read(req.params.id);
    if (!img) return reply.code(404).send({ error: "not_found" });
    return reply.header("Cache-Control", "public, max-age=31536000, immutable").type(img.mimeType).send(img.data);
  });
}
