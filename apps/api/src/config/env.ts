import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  LLM_PROVIDER: z.enum(["anthropic", "mock"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default("./data/pglite"),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  BLOCKED_DOMAINS: z.string().default(""),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  MAIN_MODEL: z.string().default("claude-opus-5"),
  SAFETY_MODEL: z.string().default("claude-haiku-4-5"),
  MAX_WEB_SEARCH_USES: z.coerce.number().default(5),
  MAX_WEB_FETCH_USES: z.coerce.number().default(4),
  RESEARCH_MAX_WEB_SEARCH_USES: z.coerce.number().default(25),
  RESEARCH_TIMEOUT_MS: z.coerce.number().default(5 * 60 * 1000),
  /** Public base URL of this API, used for image links sent to Telegram. */
  PUBLIC_API_URL: z.string().default("http://localhost:4000"),
  /** Bearer token for /api/admin/* (operator dashboard, kill switch). Empty disables the admin routes. */
  ADMIN_TOKEN: z.string().default(""),
  // Telegram mention bot
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_BOT_USERNAME: z.string().default("bombot"),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  // Image generation (free tier): cloudflare | pollinations | mock
  IMAGE_PROVIDER: z.enum(["cloudflare", "pollinations", "mock"]).default("pollinations"),
  CF_ACCOUNT_ID: z.string().default(""),
  CF_API_TOKEN: z.string().default(""),
  CF_IMAGE_MODEL: z.string().default("@cf/black-forest-labs/flux-1-schnell"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = EnvSchema.parse(source);
  if (env.LLM_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY && !source.ANTHROPIC_AUTH_TOKEN) {
    // The SDK can also pick up an `ant auth login` profile; we only warn here.
    console.warn(
      "[bombot] LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty. Set it, run `ant auth login`, or use LLM_PROVIDER=mock.",
    );
  }
  return env;
}

export function blockedDomains(env: Env): string[] {
  return env.BLOCKED_DOMAINS.split(",").map((d) => d.trim()).filter(Boolean);
}
