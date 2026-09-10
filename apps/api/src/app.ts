import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Env } from "./config/env.js";
import { createDb, migrate, type Queryable } from "./db/client.js";
import { Repo } from "./db/repo.js";
import { createProvider } from "./llm/index.js";
import type { LlmProvider } from "./llm/types.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { UploadStore } from "./storage/uploads.js";

export interface BuiltApp {
  app: ReturnType<typeof Fastify>;
  db: Queryable;
  close(): Promise<void>;
}

/** Builds the Fastify app. `llm` can be injected for tests. */
export async function buildApp(env: Env, overrides: { llm?: LlmProvider } = {}): Promise<BuiltApp> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL }, bodyLimit: 1024 * 1024 });
  await app.register(cors, { origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()), methods: ["GET", "POST", "DELETE"] });

  const db = await createDb(env);
  await migrate(db);
  const repo = new Repo(db);
  const uploads = new UploadStore(env.UPLOAD_DIR);
  await uploads.init();
  const llm = overrides.llm ?? (await createProvider(env));
  app.log.info({ provider: llm.name, model: env.MAIN_MODEL }, "llm provider ready");

  app.get("/api/health", async () => ({ ok: true, provider: llm.name, model: env.MAIN_MODEL }));
  app.get("/api/metrics", async () => repo.metrics());
  registerConversationRoutes(app, { repo, llm, uploads, log: app.log });
  await registerUploadRoutes(app, { repo, uploads });

  return { app, db, close: async () => { await app.close(); await db.close(); } };
}
