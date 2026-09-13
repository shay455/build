import { config } from "../config.js";
import { log } from "../logger.js";

/**
 * Thin client over the WhatsApp Cloud API (Meta Graph API).
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
function base() {
  const c = config();
  return `https://graph.facebook.com/${c.WA_API_VERSION}`;
}

async function graph<T>(path: string, init: RequestInit): Promise<T> {
  const c = config();
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.WA_ACCESS_TOKEN}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    log.error({ status: res.status, body: text, path }, "WhatsApp API error");
    throw new Error(`WhatsApp API ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function messagesPath() {
  return `/${config().WA_PHONE_NUMBER_ID}/messages`;
}

export async function sendText(to: string, body: string): Promise<void> {
  await graph(messagesPath(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: false } }),
  });
}

/** Uploads a file and returns Meta's media id (valid ~30 days). */
export async function uploadMedia(buffer: Buffer, mime: string, filename: string): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  const res = await graph<{ id: string }>(`/${config().WA_PHONE_NUMBER_ID}/media`, { method: "POST", body: form });
  return res.id;
}

export async function sendImage(to: string, mediaId: string, caption?: string): Promise<void> {
  await graph(messagesPath(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "image", image: { id: mediaId, caption } }),
  });
}

/** Sends a full-quality file (WhatsApp recompresses `image` messages; `document` keeps the original bytes). */
export async function sendDocument(to: string, mediaId: string, filename: string, caption?: string): Promise<void> {
  await graph(messagesPath(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "document", document: { id: mediaId, filename, caption } }),
  });
}

export async function sendImageBuffer(to: string, buffer: Buffer, filename: string, caption?: string, asDocument = false) {
  const id = await uploadMedia(buffer, "image/jpeg", filename);
  if (asDocument) await sendDocument(to, id, filename, caption);
  else await sendImage(to, id, caption);
}

/** Sends an MP4 (H.264/AAC, under 16 MB) as a playable video message. */
export async function sendVideoBuffer(to: string, buffer: Buffer, filename: string, caption?: string) {
  const id = await uploadMedia(buffer, "video/mp4", filename);
  await graph(messagesPath(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "video", video: { id, caption } }),
  });
}

/** Downloads inbound media. Meta's download URL expires within minutes, so call this from the webhook, not the queue. */
export async function downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mime: string }> {
  const meta = await graph<{ url: string; mime_type: string }>(`/${mediaId}`, { method: "GET" });
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${config().WA_ACCESS_TOKEN}` } });
  if (!res.ok) throw new Error(`media download ${res.status}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: meta.mime_type };
}

export async function markRead(messageId: string): Promise<void> {
  try {
    await graph(messagesPath(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
    });
  } catch (e) {
    log.warn({ err: e }, "markRead failed (non-fatal)");
  }
}
