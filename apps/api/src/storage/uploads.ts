import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES, type AttachmentRef } from "@bombot/shared";

/** Local-disk blob store. Swap for S3 in production; the interface is the only thing the app depends on. */
export class UploadStore {
  constructor(private readonly dir: string) {}

  async init() { await mkdir(this.dir, { recursive: true }); }

  validate(mimeType: string, sizeBytes: number): string | null {
    if (!(ALLOWED_UPLOAD_MIME as readonly string[]).includes(mimeType)) return `unsupported file type: ${mimeType}`;
    if (sizeBytes > MAX_UPLOAD_BYTES) return `file too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`;
    return null;
  }

  async put(name: string, mimeType: string, data: Buffer): Promise<AttachmentRef & { storageKey: string }> {
    const id = randomUUID();
    const ext = path.extname(name).slice(0, 10);
    const storageKey = `${id}${ext}`;
    await writeFile(path.join(this.dir, storageKey), data);
    return { id, name: path.basename(name).slice(0, 200), mimeType, sizeBytes: data.byteLength, storageKey };
  }

  async get(storageKey: string): Promise<Buffer> {
    // storageKey is server-generated; still refuse anything that escapes the dir.
    if (storageKey.includes("/") || storageKey.includes("..")) throw new Error("invalid storage key");
    return readFile(path.join(this.dir, storageKey));
  }
}
