import type { LlmProvider, ChatRequest, ProviderEvent, SafetyVerdict } from "./types.js";
import { estimateCostUsd } from "./pricing.js";

/**
 * Deterministic provider for local development and tests. Emits a realistic event sequence:
 * (thinking) -> web_search -> text with one citation -> final usage.
 * Include `[[BLOCK]]` in a message to make the safety classifier block it.
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock";
  constructor(private readonly delayMs = 0) {}

  private async tick() {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
  }

  async *streamChat(req: ChatRequest): AsyncIterable<ProviderEvent> {
    const last = req.messages[req.messages.length - 1];
    const userText = extractText(last?.content);
    const hebrew = /[֐-׿]/.test(userText);

    if (req.think) {
      for (const chunk of ["בודק מה נשאל, ", "מחליט אם צריך חיפוש, ", "מנסח תשובה קצרה."]) {
        await this.tick();
        yield { type: "thinking_delta", text: chunk };
      }
    }
    yield { type: "tool_start", tool: "web_search", input: userText.slice(0, 60) };
    await this.tick();
    yield { type: "tool_result", tool: "web_search", ok: true, resultCount: 3 };

    const answer = hebrew
      ? `זו תשובת דמה של Bombot במצב ${req.mode}. שאלת: "${userText.slice(0, 80)}". במערכת אמיתית התשובה הייתה מבוססת על חיפוש חי עם מקורות.`
      : `This is a Bombot mock answer in ${req.mode} mode. You asked: "${userText.slice(0, 80)}". A live system would ground this in fresh search results.`;
    let text = "";
    for (const word of answer.split(" ")) {
      await this.tick();
      const piece = (text ? " " : "") + word;
      text += piece;
      yield { type: "text_delta", text: piece };
    }
    yield { type: "citation", url: "https://example.com/source", title: "Example source", citedText: "An example passage." };

    const usage = { model: "mock", inputTokens: 420, outputTokens: 60, cacheReadInputTokens: 300, cacheCreationInputTokens: 0, webSearchRequests: 1 };
    yield {
      type: "final", text, thinking: req.think ? "בודק מה נשאל, מחליט אם צריך חיפוש, מנסח תשובה קצרה." : "", stopReason: "end_turn",
      usage: { ...usage, estimatedCostUsd: estimateCostUsd({ ...usage, model: "claude-opus-5" }) },
    };
  }

  async classifySafety(input: { stage: "input" | "output"; text: string }): Promise<SafetyVerdict> {
    if (input.text.includes("[[BLOCK]]")) return { action: "block", category: "hate", reason: "mock: explicit block marker" };
    return { action: "allow", category: null, reason: "mock: allowed" };
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "")).join(" ").trim();
  }
  return "";
}
