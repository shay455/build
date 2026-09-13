import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSse, testApp } from "./helpers.js";

let built: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { built = await testApp(); });
afterAll(async () => { await built.close(); });

describe("chat: research mode and /imagine", () => {
  it("accepts research mode and completes with usage", async () => {
    const c = (await built.app.inject({ method: "POST", url: "/api/conversations" })).json() as { id: string };
    const res = await built.app.inject({ method: "POST", url: `/api/conversations/${c.id}/messages`, payload: { text: "סקירה על תקנות AI באיחוד האירופי", mode: "research" } });
    const events = parseSse(res.body);
    expect(events.at(-1)?.type).toBe("done");
    expect(events.some((e) => e.type === "usage")).toBe(true);
  });

  it("/imagine stores an assistant message with a generated image attachment", async () => {
    const c = (await built.app.inject({ method: "POST", url: "/api/conversations" })).json() as { id: string };
    const res = await built.app.inject({ method: "POST", url: `/api/conversations/${c.id}/messages`, payload: { text: "/imagine נמל יפו בשקיעה" } });
    const done = parseSse(res.body).find((e) => e.type === "done");
    if (done?.type !== "done") throw new Error("no done");
    expect(done.message.attachments[0]?.mimeType).toBe("image/generated");
    const img = await built.app.inject({ method: "GET", url: `/api/images/${done.message.attachments[0]!.id}` });
    expect(img.statusCode).toBe(200);
  });

  it("/imagine with a real person is refused", async () => {
    const c = (await built.app.inject({ method: "POST", url: "/api/conversations" })).json() as { id: string };
    const res = await built.app.inject({ method: "POST", url: `/api/conversations/${c.id}/messages`, payload: { text: "/imagine נתניהו על חוף הים" } });
    const done = parseSse(res.body).find((e) => e.type === "done");
    if (done?.type !== "done") throw new Error("no done");
    expect(done.message.attachments).toHaveLength(0);
    expect(done.message.text).toContain("אנשים אמיתיים");
  });
});
