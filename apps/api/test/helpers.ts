import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "../src/config/env.js";
import { buildApp } from "../src/app.js";
import type { StreamEvent } from "@bombot/shared";

export async function testApp() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bombot-test-"));
  const env = loadEnv({
    LLM_PROVIDER: "mock", PGLITE_DIR: ":memory:", UPLOAD_DIR: path.join(dir, "uploads"), LOG_LEVEL: "silent",
  } as NodeJS.ProcessEnv);
  return buildApp(env);
}

/** Parses an SSE body into typed events. */
export function parseSse(body: string): StreamEvent[] {
  return body.split("\n\n").filter((chunk) => chunk.startsWith("event:")).map((chunk) => {
    const data = chunk.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim();
    return JSON.parse(data) as StreamEvent;
  });
}
