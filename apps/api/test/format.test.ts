import { describe, expect, it } from "vitest";
import { cleanRequest, markdownToTelegramHtml, sourcesFooter, truncate } from "../src/telegram/format.js";

describe("telegram formatting", () => {
  it("converts bold, code and links and escapes the rest", () => {
    const html = markdownToTelegramHtml("**חשוב**: `x < y` ראו [מקור](https://a.b/c) & עוד");
    expect(html).toBe('<b>חשוב</b>: <code>x &lt; y</code> ראו <a href="https://a.b/c">מקור</a> &amp; עוד');
  });
  it("truncates at a sentence boundary with an ellipsis", () => {
    const t = truncate("משפט ראשון. משפט שני ארוך מאוד שממשיך וממשיך. משפט שלישי.", 40);
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(41);
  });
  it("lists at most five sources", () => {
    const cites = Array.from({ length: 7 }, (_, i) => ({ index: i + 1, url: `https://s${i}.com/x`, title: `T${i}`, citedText: null }));
    const f = sourcesFooter(cites, true);
    expect(f.match(/<a /g)).toHaveLength(5);
    expect(f).toContain("מקורות");
  });
  it("strips the mention and the command", () => {
    expect(cleanRequest("/check@bombot  זה נכון?", "bombot")).toBe("זה נכון?");
    expect(cleanRequest("@bombot מה דעתך", "bombot")).toBe("מה דעתך");
  });
});
