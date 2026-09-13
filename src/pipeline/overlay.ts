import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdCopy } from "./brief.js";

/**
 * Draws the Hebrew typography, CTA pill and logo on top of a generated image.
 * We never ask the image model to render Hebrew: it gets the letters wrong. Everything textual is drawn here,
 * so a copy change costs nothing and every format shares the same type treatment.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.resolve(here, "../../assets/fonts/Heebo.ttf");
let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  if (!GlobalFonts.has("Heebo")) GlobalFonts.registerFromPath(FONT_PATH, "Heebo");
  fontReady = true;
}

export type Format = "feed" | "story";
export const FORMAT_SIZE: Record<Format, { w: number; h: number }> = {
  feed: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};

export interface OverlayInput {
  image: Buffer;
  copy: Pick<AdCopy, "headline" | "subline" | "cta" | "palette" | "text_zone">;
  logo?: Buffer | null;
  format: Format;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [20, 24, 22];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => `rgba(${hexToRgb(hex).join(",")},${a})`;
function isLight(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

/**
 * Heebo has no glyph for the non-breaking hyphen family, and mixed Hebrew/number runs need a hint so a period
 * after a number does not jump to the next number. Zero-width RLM (U+200F) marks are ignored by the shaper.
 */
export function sanitizeHebrew(text: string): string {
  return text
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/(\d)([.,;!?])(?=\s|$)/g, "$1$2\u200F")
    .trim();
}

/** Word-wraps RTL text to at most `maxLines`, shrinking the font until it fits. Returns the lines and the font size used. */
function fitText(ctx: SKRSContext2D, text: string, weight: number, startPx: number, minPx: number, maxWidth: number, maxLines: number) {
  let px = startPx;
  while (px >= minPx) {
    ctx.font = `${weight} ${px}px Heebo`;
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (ctx.measureText(trial).width <= maxWidth || !line) line = trial;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    if (lines.length === 2) balanceTwoLines(ctx, words, lines, maxWidth);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (lines.length <= maxLines && widest <= maxWidth) return { lines, px };
    px -= 4;
  }
  ctx.font = `${weight} ${minPx}px Heebo`;
  return { lines: [text], px: minPx };
}

/** Moves the split point of a two-line wrap so the lines are close in width (no one-word orphan on line 2). */
function balanceTwoLines(ctx: SKRSContext2D, words: string[], lines: string[], maxWidth: number) {
  let best: { a: string; b: string; diff: number } | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const wa = ctx.measureText(a).width, wb = ctx.measureText(b).width;
    if (wa > maxWidth || wb > maxWidth) continue;
    const diff = Math.abs(wa - wb);
    if (!best || diff < best.diff) best = { a, b, diff };
  }
  if (best) { lines[0] = best.a; lines[1] = best.b; }
}

function drawCover(ctx: SKRSContext2D, img: Awaited<ReturnType<typeof loadImage>>, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawCta(ctx: SKRSContext2D, text: string, right: number, y: number, fill: string, px = 40) {
  ctx.font = `700 ${px}px Heebo`;
  const padX = 34, h = px * 1.9;
  const w = ctx.measureText(text).width + padX * 2;
  const x = right - w;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = isLight(fill) ? "#141816" : "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, right - padX, y + h / 2);
  ctx.textBaseline = "alphabetic";
  return h;
}

export async function renderFormat(input: OverlayInput): Promise<Buffer> {
  ensureFont();
  const { w: W, h: H } = FORMAT_SIZE[input.format];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  const img = await loadImage(input.image);
  const copy = {
    ...input.copy,
    headline: sanitizeHebrew(input.copy.headline),
    subline: sanitizeHebrew(input.copy.subline),
    cta: sanitizeHebrew(input.copy.cta),
  };
  const { primary, accent } = copy.palette;
  const margin = 72;
  const right = W - margin;
  const maxWidth = W - margin * 2;

  if (input.format === "feed") {
    drawCover(ctx, img, 0, 0, W, H);
    const top = copy.text_zone === "top";
    // Soft panel behind the type so it reads on any background.
    const grad = top ? ctx.createLinearGradient(0, 0, 0, H * 0.5) : ctx.createLinearGradient(0, H, 0, H * 0.5);
    grad.addColorStop(0, rgba(primary, 0.88));
    grad.addColorStop(1, rgba(primary, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, top ? 0 : H * 0.5, W, H * 0.5);

    ctx.fillStyle = "#ffffff";
    const head = fitText(ctx, copy.headline, 800, 96, 56, maxWidth, 2);
    const sub = fitText(ctx, copy.subline, 500, 44, 30, maxWidth, 2);
    const lh = head.px * 1.12, slh = sub.px * 1.35;
    const block = head.lines.length * lh + 18 + sub.lines.length * slh + 26 + 40 * 1.9;
    let y = top ? margin + head.px : H - margin - block + head.px;
    ctx.font = `800 ${head.px}px Heebo`;
    for (const l of head.lines) { ctx.fillText(l, right, y); y += lh; }
    y += 18 - lh + sub.px;
    ctx.font = `500 ${sub.px}px Heebo`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    for (const l of sub.lines) { ctx.fillText(l, right, y); y += slh; }
    y += 26 - slh;
    drawCta(ctx, copy.cta, right, y, accent);
  } else {
    // Story: brand-colored ground, the square image in the middle, headline above, subline + CTA below.
    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, W, H);
    const imgSize = W - margin * 2;
    const imgY = 430;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(margin, imgY, imgSize, imgSize, 28);
    ctx.clip();
    drawCover(ctx, img, margin, imgY, imgSize, imgSize);
    ctx.restore();

    ctx.fillStyle = isLight(primary) ? "#141816" : "#ffffff";
    const head = fitText(ctx, copy.headline, 800, 104, 60, maxWidth, 2);
    const lh = head.px * 1.12;
    let y = imgY - 40 - (head.lines.length - 1) * lh;
    ctx.font = `800 ${head.px}px Heebo`;
    for (const l of head.lines) { ctx.fillText(l, right, y); y += lh; }

    const sub = fitText(ctx, copy.subline, 500, 48, 32, maxWidth, 2);
    y = imgY + imgSize + 96;
    ctx.font = `500 ${sub.px}px Heebo`;
    ctx.fillStyle = isLight(primary) ? "rgba(20,24,22,0.85)" : "rgba(255,255,255,0.9)";
    for (const l of sub.lines) { ctx.fillText(l, right, y); y += sub.px * 1.35; }
    y += 30;
    drawCta(ctx, copy.cta, right, y, accent, 44);
  }

  if (input.logo) {
    try {
      const logo = await loadImage(input.logo);
      const maxW = 220, maxH = 110;
      const s = Math.min(maxW / logo.width, maxH / logo.height, 1);
      const lw = logo.width * s, lhh = logo.height * s;
      ctx.drawImage(logo, margin, H - margin - lhh, lw, lhh);
    } catch { /* a broken logo file must not fail the job */ }
  }

  const png = canvas.toBuffer("image/png");
  return sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** Normalizes any inbound product photo (HEIC, huge JPEG, EXIF rotation) to an upright JPEG ≤ 2048px. */
export async function normalizeProductPhoto(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
}
