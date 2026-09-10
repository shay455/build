import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { MAX_UPLOAD_BYTES } from "@bombot/shared";
import type { Repo } from "../db/repo.js";
import type { UploadStore } from "../storage/uploads.js";

export async function registerUploadRoutes(app: FastifyInstance, deps: { repo: Repo; uploads: UploadStore }) {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.post("/api/uploads", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "no_file" });
    const data = await file.toBuffer();
    const problem = deps.uploads.validate(file.mimetype, data.byteLength);
    if (problem) return reply.code(415).send({ error: "invalid_file", message: problem });
    const stored = await deps.uploads.put(file.filename, file.mimetype, data);
    await deps.repo.insertAttachment(stored);
    const { storageKey: _omit, ...ref } = stored;
    return reply.code(201).send(ref);
  });
}
