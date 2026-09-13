import { BOT_LIMITS, VERDICT_LABELS, type Citation, type Verdict } from "@bombot/shared";

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Converts the model's light Markdown into Telegram HTML (bold, inline code, links) and strips the rest.
 * Telegram supports a narrow HTML subset; anything else is rendered as plain text.
 */
export function markdownToTelegramHtml(md: string): string {
  let s = md.replace(/```[\s\S]*?```/g, (m) => `<pre>${escapeHtml(m.replace(/```\w*\n?/g, "").trim())}</pre>`);
  s = s.replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*•]\s+/gm, "• ");
  const parts = s.split(/(<pre>[\s\S]*?<\/pre>)/);
  return parts.map((p) => {
    if (p.startsWith("<pre>")) return p;
    let t = escapeHtml(p);
    t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
    return t;
  }).join("");
}

/** Hard cap on visible characters (before HTML), keeping whole sentences when possible. */
export function truncate(text: string, max: number = BOT_LIMITS.telegramReplyChars): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut.trimEnd()) + "…";
}

/** Numbered source links appended under the answer. Telegram ignores citation markers, so we list them. */
export function sourcesFooter(citations: Citation[], he: boolean): string {
  if (citations.length === 0) return "";
  const items = citations.slice(0, 5).map((c) => `<a href="${escapeHtml(c.url)}">[${c.index}] ${escapeHtml((c.title ?? hostOf(c.url)).slice(0, 60))}</a>`);
  return `\n\n<b>${he ? "מקורות" : "Sources"}:</b>\n${items.join("\n")}`;
}

export function verdictHeader(verdict: Verdict, confidence: number, he: boolean): string {
  const v = VERDICT_LABELS[verdict];
  const pct = Math.round(confidence * 100);
  const conf = he ? `ביטחון ${pct}%` : `${pct}% confidence`;
  return `${v.emoji} <b>${he ? v.he : v.en}</b> · ${conf}\n`;
}

export function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

export const hasHebrew = (s: string) => /[֐-׿]/.test(s);
export const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

/** Strips @mentions and the bot command from the request text. */
export function cleanRequest(text: string, botUsername: string): string {
  return text
    .replace(new RegExp(`@${botUsername}\\b`, "gi"), " ")
    .replace(/^\/(check|explain|imagine|summarize|translate|ask|start|help|settings)(@\w+)?\s*/i, "")
    .replace(/\s+/g, " ").trim();
}
