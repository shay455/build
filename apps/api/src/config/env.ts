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
