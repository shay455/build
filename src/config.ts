import { existsSync } from "node:fs";
import { z } from "zod";

// Load .env from the working directory. Existing process env always wins, so a real deployment
// can inject variables without a file. Node 22 ships this natively; no dotenv package needed.
if (existsSync(".env")) {
  try { process.loadEnvFile(".env"); } catch { /* unreadable .env: the validation below reports what is missing */ }
}

const Env = z.object({
  WA_PHONE_NUMBER_ID: z.string().min(1),
  WA_ACCESS_TOKEN: z.string().min(1),
  WA_APP_SECRET: z.string().min(1),
  WA_VERIFY_TOKEN: z.string().min(1),
  WA_API_VERSION: z.string().default("v25.0"),
  OPERATOR_PHONE: z.string().regex(/^\d{8,15}$/, "digits only, no +"),

  ANTHROPIC_API_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-3-pro-image"),
  CLAUDE_BRIEF_MODEL: z.string().default("claude-opus-5"),
  CLAUDE_UTILITY_MODEL: z.string().default("claude-haiku-4-5"),
  FAL_KEY: z.string().optional(),
  FAL_VIDEO_MODEL: z.string().default("fal-ai/kling-video/v3/standard/image-to-video"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  PORT: z.coerce.number().default(3000),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  DATA_DIR: z.string().default("./data"),
  USD_ILS: z.coerce.number().default(3.35),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof Env>;

let cached: Config | undefined;

/** Parses process.env once. Throws a readable error listing every missing variable. */
export function config(): Config {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Missing or invalid environment variables:\n${lines.join("\n")}\nCopy .env.example to .env and fill it in.`);
  }
  cached = parsed.data;
  return cached;
}
