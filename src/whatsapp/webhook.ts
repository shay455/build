import { createHmac, timingSafeEqual } from "node:crypto";

export interface InboundText { kind: "text"; id: string; from: string; text: string; timestamp: number }
export interface InboundImage { kind: "image"; id: string; from: string; mediaId: string; mime: string; caption?: string; timestamp: number }
export type Inbound = InboundText | InboundImage;

/** Verifies Meta's X-Hub-Signature-256 header over the raw request body. */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
}

/** Flattens Meta's nested webhook payload into a list of messages we care about. Status updates are ignored. */
export function parseInbound(payload: unknown): Inbound[] {
  const out: Inbound[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as Array<{ changes?: Array<{ value?: { messages?: unknown[] } }> }>) {
    for (const change of entry.changes ?? []) {
      for (const m of (change.value?.messages ?? []) as Array<Record<string, unknown>>) {
        const id = String(m.id);
        const from = String(m.from);
        const timestamp = Number(m.timestamp ?? Date.now() / 1000);
        if (m.type === "text") {
          out.push({ kind: "text", id, from, timestamp, text: String((m.text as { body: string }).body ?? "") });
        } else if (m.type === "image") {
          const img = m.image as { id: string; mime_type: string; caption?: string };
          out.push({ kind: "image", id, from, timestamp, mediaId: img.id, mime: img.mime_type, caption: img.caption });
        }
      }
    }
  }
  return out;
}
