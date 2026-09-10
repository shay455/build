import type { SafetyOutcome } from "@bombot/shared";
import type { LlmProvider } from "../llm/types.js";

export const BLOCKED_INPUT_REPLY_HE = "אני לא יכול לעזור עם הבקשה הזו. אם יש לך שאלה אחרת, אשמח לנסות.";
export const BLOCKED_INPUT_REPLY_EN = "I can't help with that request. If you have a different question, I'm happy to try.";
export const BLOCKED_OUTPUT_REPLY_HE = "התשובה שנוצרה לא עמדה בכללי הבטיחות של Bombot ולכן לא הוצגה. נסו לנסח את השאלה אחרת.";
export const BLOCKED_OUTPUT_REPLY_EN = "The generated answer did not pass Bombot's safety rules and was withheld. Try rephrasing the question.";

const hasHebrew = (s: string) => /[֐-׿]/.test(s);

export class SafetyFilter {
  constructor(private readonly llm: LlmProvider) {}

  /** Runs the classifier. A classifier failure never blocks the user; it is logged and the output stage runs anyway. */
  async check(stage: "input" | "output", text: string): Promise<SafetyOutcome> {
    if (!text.trim()) return { stage, action: "allow", category: null, reason: "empty" };
    try {
      const v = await this.llm.classifySafety({ stage, text });
      if (v.action === "block") {
        return { stage, action: stage === "input" ? "block" : "replace", category: v.category, reason: v.reason };
      }
      return { stage, action: "allow", category: null, reason: v.reason };
    } catch (err) {
      return { stage, action: "allow", category: null, reason: `classifier error, failed open: ${(err as Error).message}` };
    }
  }

  replacementText(stage: "input" | "output", userText: string): string {
    const he = hasHebrew(userText);
    if (stage === "input") return he ? BLOCKED_INPUT_REPLY_HE : BLOCKED_INPUT_REPLY_EN;
    return he ? BLOCKED_OUTPUT_REPLY_HE : BLOCKED_OUTPUT_REPLY_EN;
  }
}
