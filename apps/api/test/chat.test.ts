import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSse, testApp } from "./helpers.js";

let built: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { built = await testApp(); });
afterAll(async () => { await built.close(); });

async function newConversation() {
  const res = await built.app.inject({ method: "POST", url: "/api/conversations" });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

describe("chat turn over SSE", () => {
  it("streams thinking, tool, text, citation, usage and done events in order", async () => {
    const c = await newConversation();
    const res = await built.app.inject({
      method: "POST", url: `/api/conversations/${c.id}/messages`,
      payload: { text: "מה קרה היום בבורסה?", mode: "deep", think: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = parseSse(res.body);
    const types = events.map((e) => e.type);

    expect(types[0]).toBe("message_start");
    expect(types).toContain("thinking_delta");
    expect(types).toContain("tool_start");
    expect(types).toContain("tool_result");
    expect(types).toContain("citation");
    expect(types).toContain("usage");
    expect(types[types.length - 1]).toBe("done");
    expect(types.indexOf("tool_start")).toBeLessThan(types.indexOf("text_delta"));

    const done = events.find((e) => e.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.message.role).toBe("assistant");
    expect(done.message.text).toContain("Bombot");
    expect(done.message.thinking).toBeTruthy();
    expect(done.message.citations).toHaveLength(1);
    expect(done.message.citations[0]).toMatchObject({ index: 1, url: "https://example.com/source" });
    expect(done.message.usage?.webSearchRequests).toBe(1);
    expect(done.message.usage?.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("does not include thinking when think=false", async () => {
    const c = await newConversation();
    const res = await built.app.inject({ method: "POST", url: `/api/conversations/${c.id}/messages`, payload: { text: "hello" } });
    const events = parseSse(res.body);
    expect(events.some((e) => e.type === "thinking_delta")).toBe(false);
    const done = events.find((e) => e.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.message.thinking).toBeNull();
  });

  it("persists both turns and sets the conversation title from the first message", async () => {
    const c = await newConversation();
    await built.app.inject({ method: "POST", url: `/api/conversations/${c.id}/messages`, payload: { text: "שאלה ראשונה" } });
    await built.app.inject({ method: "POST", url: `/api/conversations/${c.id}/messages`, payload: { text: "שאלה שנייה" } });
    const res = await built.app.inject({ method: "GET", url: `/api/conversations/${c.id}` });
    const conv = res.json() as { title: string; messages: { role: string }[] };
    expect(conv.title).toBe("שאלה ראשונה");
    expect(conv.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("blocks unsafe input before it reaches the model and replies in the user's language", async () => {
    const c = await newConversation();
    const res = await built.app.inject({ method: "POST", url: `/api/conversations/${c.id}/messages`, payload: { text: "בקשה [[BLOCK]] אסורה" } });
    const events = parseSse(res.body);
    const safety = events.find((e) => e.type === "safety");
    if (safety?.type !== "safety") throw new Error("no safety event");
    expect(safety.outcome).toMatchObject({ stage: "input", action: "block", category: "hate" });
    expect(events.some((e) => e.type === "tool_start")).toBe(false);
    const done = events.find((e) => e.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.message.text).toContain("לא יכול לעזור");
    expect(done.message.safety?.action).toBe("block");
  });

  it("rejects malformed requests and unknown conversations", async () => {
    const c = await newConversation();
    const bad = await built.app.inject({ method: "POST", url: `/api/conversations/${c.id}/messages`, payload: { text: "" } });
    expect(bad.statusCode).toBe(400);
    const missing = await built.app.inject({ method: "POST", url: `/api/conversations/00000000-0000-0000-0000-000000000000/messages`, payload: { text: "x" } });
    expect(missing.statusCode).toBe(404);
  });

  it("exposes operator metrics after traffic", async () => {
    const res = await built.app.inject({ method: "GET", url: "/api/metrics" });
    const m = res.json() as { responses: number; safetyInterventions: number; cache_hit_ratio: number };
    expect(m.responses).toBeGreaterThan(0);
    expect(m.safetyInterventions).toBeGreaterThanOrEqual(1);
    expect(m.cache_hit_ratio).toBeGreaterThan(0);
  });
});

describe("uploads", () => {
  it("accepts a text file and attaches it to the next turn", async () => {
    const boundary = "----bombot";
    const body = [
      `--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="notes.txt"', "Content-Type: text/plain", "",
      "Bombot notes", `--${boundary}--`, "",
    ].join("\r\n");
    const up = await built.app.inject({
      method: "POST", url: "/api/uploads", payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(up.statusCode).toBe(201);
    const ref = up.json() as { id: string; mimeType: string };
    expect(ref.mimeType).toBe("text/plain");

    const c = await newConversation();
    const res = await built.app.inject({
      method: "POST", url: `/api/conversations/${c.id}/messages`, payload: { text: "סכם את הקובץ", attachmentIds: [ref.id] },
    });
    const conv = (await built.app.inject({ method: "GET", url: `/api/conversations/${c.id}` })).json() as { messages: { attachments: unknown[] }[] };
    expect(res.statusCode).toBe(200);
    expect(conv.messages[0]?.attachments).toHaveLength(1);
  });

  it("rejects unsupported file types", async () => {
    const boundary = "----bombot2";
    const body = [
      `--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="a.exe"', "Content-Type: application/octet-stream", "",
      "MZ", `--${boundary}--`, "",
    ].join("\r\n");
    const up = await built.app.inject({ method: "POST", url: "/api/uploads", payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
    expect(up.statusCode).toBe(415);
  });
});
