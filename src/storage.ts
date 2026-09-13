import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

/**
 * Phase 1 keeps every file on local disk under DATA_DIR/jobs/<jobId>/.
 * Phase 3 swaps this module for Cloudflare R2 with signed URLs; callers only see paths.
 */
export function jobDir(jobId: number) {
  return path.resolve(config().DATA_DIR, "jobs", String(jobId));
}

export async function saveJobFile(jobId: number, name: string, data: Buffer): Promise<string> {
  const dir = jobDir(jobId);
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, name);
  await writeFile(p, data);
  return p;
}

export async function saveClientFile(clientId: number, name: string, data: Buffer): Promise<string> {
  const dir = path.resolve(config().DATA_DIR, "clients", String(clientId));
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, name);
  await writeFile(p, data);
  return p;
}

export const readJobFile = (p: string) => readFile(p);
