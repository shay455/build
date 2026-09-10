import type { AttachmentRef, ConversationView, SendMessageRequest, StreamEvent } from "@bombot/shared";

export async function listConversations(): Promise<Omit<ConversationView, "messages">[]> {
  const r = await fetch("/api/conversations", { cache: "no-store" });
  return r.json();
}
export async function createConversation(): Promise<ConversationView> {
  const r = await fetch("/api/conversations", { method: "POST" });
  return r.json();
}
export async function getConversation(id: string): Promise<ConversationView | null> {
  const r = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
  return r.ok ? r.json() : null;
}
export async function deleteConversation(id: string): Promise<void> {
  await fetch(`/api/conversations/${id}`, { method: "DELETE" });
}
export async function uploadFile(file: File): Promise<AttachmentRef> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/uploads", { method: "POST", body: fd });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `upload failed (${r.status})`);
  }
  return r.json();
}

/** Posts a message and yields typed SSE events until the stream closes. */
export async function* sendMessage(
  conversationId: string,
  body: SendMessageRequest,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const r = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) {
    const detail = (await r.json().catch(() => ({}))) as { error?: string };
    yield { type: "error", code: detail.error ?? String(r.status), message: `request failed (${r.status})` };
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (data) yield JSON.parse(data.slice(5)) as StreamEvent;
    }
  }
}
