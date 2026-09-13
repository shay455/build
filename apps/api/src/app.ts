import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Env } from "./config/env.js";
import { createDb, migrate, type Queryable } from "./db/client.js";
import { Repo } from "./db/repo.js";
import { createProvider } from "./llm/index.js";
import type { LlmProvider } from "./llm/types.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerTelegramRoutes } from "./routes/telegram.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { UploadStore } from "./storage/uploads.js";
import { createImageProvider, type ImageProvider } from "./images/provider.js";
import { ImageService } from "./images/service.js";
import { TelegramHttpApi, type TelegramApi } from "./telegram/api.js";
import { TelegramHandler } from "./telegram/handler.js";

export interface BuiltApp {
  app: ReturnType<typeof Fastify>;
  db: Queryable;
  repo: Repo;
  telegram: TelegramHandler | null;
  images: ImageService;
  close(): Promise<void>;
}

/** Builds the Fastify app. Providers can be injected for tests. */
export async function buildApp(env: Env, overrides: { llm?: LlmProvider; tg?: TelegramApi; imageProvider?: ImageProvider } = {}): Promise<BuiltApp> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL }, bodyLimit: 1024 * 1024 });
  await app.register(cors, { origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()), methods: ["GET", "POST", "DELETE"] });

  const db = await createDb(env);
  await migrate(db);
  const repo = new Repo(db);
  const uploads = new UploadStore(env.UPLOAD_DIR);
  await uploads.init();
  const llm = overrides.llm ?? (await createProvider(env));
  app.log.info({ provider: llm.name, model: env.MAIN_MODEL }, "llm provider ready");

  const imageProvider = overrides.imageProvider ?? createImageProvider(env);
  const images = new ImageService({ repo, llm, images: imageProvider, uploads, publicBaseUrl: env.PUBLIC_API_URL });
  const tg: TelegramApi | null = overrides.tg ?? (env.TELEGRAM_BOT_TOKEN ? new TelegramHttpApi(env.TELEGRAM_BOT_TOKEN) : null);
  const telegram = tg ? new TelegramHandler({ env, repo, llm, tg, images, log: app.log }) : null;

  app.get("/api/health", async () => ({ ok: true, provider: llm.name, model: env.MAIN_MODEL, telegram: Boolean(telegram), images: imageProvider.name }));
  app.get("/api/metrics", async () => repo.metrics());
  registerConversationRoutes(app, { env, repo, llm, uploads, images, log: app.log });
  await registerUploadRoutes(app, { repo, uploads });
  registerImageRoutes(app, images);
  if (telegram) registerTelegramRoutes(app, env, telegram);
  registerAdminRoutes(app, env, { repo, tg });

  return { app, db, repo, telegram, images, close: async () => { await app.close(); await db.close(); } };
}
