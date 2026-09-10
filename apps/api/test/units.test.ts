import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../src/llm/pricing.js";
import { SafetyFilter } from "../src/safety/filter.js";
import { MockProvider } from "../src/llm/mock.js";
import { EFFORT_BY_MODE } from "../src/llm/types.js";

describe("pricing", () => {
  it("matches the Opus 5 price table", () => {
    const usd = estimateCostUsd({ model: "claude-opus-5", inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0 });
    expect(usd).toBe(5);
    const withSearch = estimateCostUsd({ model: "claude-opus-5", inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 1000 });
    expect(withSearch).toBe(10);
  });
  it("keeps a typical balanced turn under the 4 cent target", () => {
    const usd = estimateCostUsd({ model: "claude-opus-5", inputTokens: 1500, outputTokens: 600, cacheReadInputTokens: 2500, cacheCreationInputTokens: 0, webSearchRequests: 1 });
    expect(usd).toBeLessThan(0.04);
  });
});

describe("safety filter", () => {
  const f = new SafetyFilter(new MockProvider());
  it("maps a classifier block to 'block' on input and 'replace' on output", async () => {
    expect((await f.check("input", "[[BLOCK]]")).action).toBe("block");
    expect((await f.check("output", "[[BLOCK]]")).action).toBe("replace");
    expect((await f.check("input", "שלום")).action).toBe("allow");
  });
  it("fails open when the classifier throws", async () => {
    const broken = new SafetyFilter({ name: "broken", streamChat: async function* () {}, classifySafety: async () => { throw new Error("boom"); } });
    const out = await broken.check("input", "anything");
    expect(out.action).toBe("allow");
    expect(out.reason).toContain("failed open");
  });
  it("picks the reply language from the user's text", () => {
    expect(f.replacementText("input", "שאלה")).toMatch(/[֐-׿]/);
    expect(f.replacementText("input", "question")).toMatch(/can't help/);
  });
});

describe("mode mapping", () => {
  it("never sends xhigh/max from the chat UI", () => {
    expect(Object.values(EFFORT_BY_MODE)).toEqual(["low", "medium", "high"]);
  });
});
