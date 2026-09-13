/**
 * Renders the two formats from a synthetic background, with no API keys and no database.
 * Run: npm run smoke:overlay  → data/smoke-feed.jpg, data/smoke-story.jpg
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { renderFormat } from "../src/pipeline/overlay.js";

const bg = await sharp({
  create: { width: 1080, height: 1080, channels: 3, background: { r: 92, g: 64, b: 40 } },
}).composite([{
  input: Buffer.from(`<svg width="1080" height="1080"><defs><radialGradient id="g" cx="50%" cy="65%" r="60%"><stop offset="0" stop-color="#E8C170"/><stop offset="1" stop-color="#3B2A1E"/></radialGradient></defs><rect width="1080" height="1080" fill="url(#g)"/><ellipse cx="540" cy="720" rx="300" ry="170" fill="#8B5A2B"/></svg>`),
}]).jpeg().toBuffer();

const copy = {
  headline: "לחם מחמצת טרי כל בוקר",
  subline: "נאפה ב‑5:00, אצלכם עד 8:00. 25 ₪ לכיכר",
  cta: "להזמנה בוואטסאפ",
  palette: { primary: "#3B2A1E", accent: "#E8C170" },
  text_zone: "top" as const,
};

await mkdir("data", { recursive: true });
await writeFile("data/smoke-feed.jpg", await renderFormat({ image: bg, copy, format: "feed" }));
await writeFile("data/smoke-story.jpg", await renderFormat({ image: bg, copy, format: "story" }));
console.log("wrote data/smoke-feed.jpg and data/smoke-story.jpg");
