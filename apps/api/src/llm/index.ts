import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Env } from "../config/env.js";
import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import type { LlmProvider } from "./types.js";

export async function loadSystemPrompt(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/llm -> prompts/system.md (same relative location after tsc to dist/llm)
  const p = path.resolve(here, "../../prompts/system.md");
  return (await readFile(p, "utf8")).trim();
}

export async function createProvider(env: Env): Promise<LlmProvider> {
  if (env.LLM_PROVIDER === "mock") return new MockProvider();
  return new AnthropicProvider(env, await loadSystemPrompt());
}
