/**
 * Parses operator messages (Hebrew) into commands. Kept deterministic on purpose:
 * no model call for routing, so a typo never costs money and the behaviour is testable.
 */
export type Command =
  | { type: "new_job"; client: string; brief: string; style?: string }
  | { type: "approve" }
  | { type: "set_copy"; field: "headline" | "subline" | "cta"; value: string }
  | { type: "choose"; index: number }
  | { type: "more_variant" }
  | { type: "no_video" }
  | { type: "video_only" }
  | { type: "finish" }
  | { type: "costs" }
  | { type: "status" }
  | { type: "help" }
  | { type: "unknown"; text: string };

const STYLES = ["יוקרתי", "חם", "נקי", "צעיר", "חגיגי"];

export function parseCommand(raw: string): Command {
  const text = raw.trim();
  const first = text.split("\n")[0].trim();

  const client = /^לקוח\s*[:：]?\s*(.+)$/u.exec(first);
  if (client) {
    const brief = text.split("\n").slice(1).join("\n").trim();
    const style = STYLES.find((s) => new RegExp(`(^|\\s)סגנון\\s*[:：]?\\s*${s}`, "u").test(text));
    return { type: "new_job", client: client[1].trim(), brief, style };
  }

  const copy = /^(כותרת|משפט|כפתור)\s*[:：]\s*(.+)$/su.exec(text);
  if (copy) {
    const field = copy[1] === "כותרת" ? "headline" : copy[1] === "משפט" ? "subline" : "cta";
    return { type: "set_copy", field, value: copy[2].trim() };
  }

  const choose = /^(?:בחר\s*)?([1-9])$/u.exec(text);
  if (choose) return { type: "choose", index: Number(choose[1]) - 1 };

  const t = text.replace(/[.!]/g, "");
  if (/^(אישור|מאשר|אשר|ok|אוקי|יאללה)$/iu.test(t)) return { type: "approve" };
  if (/^עוד\s*(גרסה|גירסה|אחת|אחד)?$/u.test(t)) return { type: "more_variant" };
  if (/^בלי\s*סרטון$/u.test(t)) return { type: "no_video" };
  if (/^רק\s*סרטון$/u.test(t)) return { type: "video_only" };
  if (/^(סיום|סיים|סגור)$/u.test(t)) return { type: "finish" };
  if (/^(עלויות|עלות|כמה עלה)$/u.test(t)) return { type: "costs" };
  if (/^(סטטוס|מצב|איפה זה)$/u.test(t)) return { type: "status" };
  if (/^(עזרה|פקודות|help|\?)$/iu.test(t)) return { type: "help" };
  return { type: "unknown", text };
}

export const HELP = `פקודות:
• שלח תמונה עם כיתוב:
  לקוח: שם העסק
  הטקסט למודעה (מה לכתוב, מחיר, קריאה לפעולה)
  אפשר להוסיף שורה "סגנון: יוקרתי / חם / נקי / צעיר / חגיגי"
• אישור – מאשר את הקופי ומתחיל ייצור
• כותרת: … / משפט: … / כפתור: … – מחליף טקסט (חינם, בלי ייצור מחדש)
• בחר 2 – בוחר גרסת תמונה אחרת
• עוד גרסה – מייצר תמונה נוספת
• בלי סרטון – מדלג על סרטון (שלב 2)
• סטטוס – איפה העבודה הנוכחית
• עלויות – סיכום עלויות החודש
• סיום – סוגר את העבודה ומציג עלות בפועל`;
