import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import { log } from "../logger.js";
import { buildBrief } from "../pipeline/brief.js";
import { EXTRA_VARIATIONS, generateImage } from "../pipeline/images.js";
import { renderFormat } from "../pipeline/overlay.js";
import { rankVariants } from "../pipeline/rank.js";
import { generateVideo } from "../pipeline/video.js";
import { readJobFile, saveJobFile } from "../storage.js";
import { sendImageBuffer, sendText, sendVideoBuffer } from "../whatsapp/client.js";
import { jobCostUsd, usdToIls } from "../costs.js";
import type { Output, Variant } from "../db/schema.js";

export type AdJobData =
  | { step: "brief"; jobId: number }
  | { step: "generate"; jobId: number }
  | { step: "variant"; jobId: number }
  | { step: "render"; jobId: number }
  | { step: "video"; jobId: number; seconds: 5 | 10 };

const QUEUE = "ads";
let connection: Redis | undefined;
let queue: Queue<AdJobData> | undefined;

function redis() {
  connection ??= new Redis(config().REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}

export function adsQueue() {
  queue ??= new Queue<AdJobData>(QUEUE, {
    connection: redis(),
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 4000 }, removeOnComplete: 200, removeOnFail: 500 },
  });
  return queue;
}

export const enqueue = (data: AdJobData) => adsQueue().add(data.step, data);

const operator = () => config().OPERATOR_PHONE;

async function loadJob(jobId: number) {
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  if (!job) throw new Error(`job ${jobId} not found`);
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, job.clientId) });
  if (!client) throw new Error(`client ${job.clientId} not found`);
  return { job, client };
}

async function setJob(jobId: number, patch: Partial<typeof schema.jobs.$inferInsert>) {
  await db.update(schema.jobs).set({ ...patch, updatedAt: new Date() }).where(eq(schema.jobs.id, jobId));
}

const toJpeg = (buf: Buffer) => sharp(buf).jpeg({ quality: 90 }).toBuffer();

function copySummary(c: NonNullable<typeof schema.jobs.$inferSelect["copy"]>, jobId: number, clientName: string) {
  const flags = c.flags.length ? `\n⚠️ לבדיקה: ${c.flags.join("; ")}` : "";
  return `עבודה #${jobId} · ${clientName}
הצעת קופי:
כותרת: ${c.headline}
משפט: ${c.subline}
כפתור: ${c.cta}
כיוון: ${c.style_rationale}
קונספט 1: ${c.concepts[0].label} · קונספט 2: ${c.concepts[1].label}
צבעים: ${c.palette.primary} / ${c.palette.accent}${flags}

כתוב "אישור" לייצור, או "כותרת: …" / "משפט: …" / "כפתור: …" לשינוי.`;
}

// ---------- steps ----------

async function stepBrief(jobId: number) {
  const { job, client } = await loadJob(jobId);
  const images = await Promise.all(job.productImages.map(async (p) => ({ data: await readJobFile(p), mime: "image/jpeg" as const })));
  const copy = await buildBrief({
    jobId, clientName: client.name, brief: job.brief, style: job.style,
    brandColors: { primary: client.primaryColor, accent: client.accentColor }, images,
  });
  await setJob(jobId, { copy, status: "awaiting_approval" });
  await sendText(operator(), copySummary(copy, jobId, client.name));
}

/** Generates one image per prompt (in parallel), stores them, appends to job.variants. */
async function produceVariants(jobId: number, prompts: Array<{ label: string; prompt: string; textZone: "top" | "bottom" }>) {
  const { job } = await loadJob(jobId);
  const references = await Promise.all(job.productImages.map(async (p) => ({ data: await readJobFile(p), mime: "image/jpeg" })));
  const settled = await Promise.allSettled(
    prompts.map((p) => generateImage({ jobId, prompt: p.prompt, references, aspectRatio: "1:1", size: "2K" })),
  );
  const variants: Variant[] = [...job.variants];
  for (const [i, s] of settled.entries()) {
    if (s.status === "rejected") { log.warn({ err: s.reason, label: prompts[i].label }, "concept failed"); continue; }
    const index = variants.length;
    const jpeg = await toJpeg(s.value.data);
    const path = await saveJobFile(jobId, `variant-${index + 1}.jpg`, jpeg);
    variants.push({ path, index, label: prompts[i].label, prompt: prompts[i].prompt, textZone: prompts[i].textZone });
  }
  if (variants.length === job.variants.length) {
    const first = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error(`Image generation failed: ${String(first?.reason)}`);
  }
  await setJob(jobId, { variants });
  return variants.slice(job.variants.length);
}

/** Renders feed + story for the given variants with the current copy. */
async function renderVariants(jobId: number, indices: number[]) {
  const { job, client } = await loadJob(jobId);
  if (!job.copy) throw new Error("job has no copy");
  const logo = client.logoPath ? await readJobFile(client.logoPath) : null;
  const slug = client.name.replace(/\s+/g, "-");
  const date = new Date().toISOString().slice(0, 10);
  const renders: Output[] = (job.outputs?.renders ?? []).filter((r) => !indices.includes(r.variantIndex));
  const produced: Array<Output & { feedBuf: Buffer; storyBuf: Buffer }> = [];
  for (const idx of indices) {
    const v = job.variants[idx];
    if (!v) continue;
    const image = await readJobFile(v.path);
    const copy = { ...job.copy, text_zone: v.textZone };
    const [feedBuf, storyBuf] = await Promise.all([
      renderFormat({ image, copy, logo, format: "feed" }),
      renderFormat({ image, copy, logo, format: "story" }),
    ]);
    const feed = await saveJobFile(jobId, `${slug}_${date}_k${idx + 1}_feed.jpg`, feedBuf);
    const story = await saveJobFile(jobId, `${slug}_${date}_k${idx + 1}_story.jpg`, storyBuf);
    const out = { variantIndex: idx, feed, story };
    renders.push(out);
    produced.push({ ...out, feedBuf, storyBuf });
  }
  renders.sort((a, b) => a.variantIndex - b.variantIndex);
  await setJob(jobId, { outputs: { renders }, status: "awaiting_review" });
  return produced;
}

async function sendRenders(jobId: number, produced: Array<Output & { feedBuf: Buffer; storyBuf: Buffer }>) {
  const { job } = await loadJob(jobId);
  for (const r of produced) {
    const label = job.variants[r.variantIndex]?.label ?? "";
    const star = job.chosenVariant === r.variantIndex ? " ★" : "";
    await sendImageBuffer(operator(), r.feedBuf, `k${r.variantIndex + 1}-feed.jpg`, `קונספט ${r.variantIndex + 1}${star} · ${label} · פיד 1080×1080`, true);
    await sendImageBuffer(operator(), r.storyBuf, `k${r.variantIndex + 1}-story.jpg`, `קונספט ${r.variantIndex + 1}${star} · ${label} · סטורי 1080×1920`, true);
  }
}

async function stepGenerate(jobId: number) {
  await setJob(jobId, { status: "generating" });
  const { job } = await loadJob(jobId);
  if (!job.copy) throw new Error("job has no copy yet");
  const made = await produceVariants(jobId, job.copy.concepts.map((c) => ({ label: c.label, prompt: c.image_prompt, textZone: c.text_zone })));

  const buffers = await Promise.all(made.map((v) => readJobFile(v.path)));
  const rank = await rankVariants(jobId, job.brief, job.copy.headline, buffers);
  const chosen = made[rank.best_index]?.index ?? made[0].index;
  await setJob(jobId, { chosenVariant: chosen });

  const produced = await renderVariants(jobId, made.map((v) => v.index));
  await sendRenders(jobId, produced);
  const cost = await jobCostUsd(jobId);
  await sendText(operator(), `${made.length} קונספטים מוכנים לשליחה ללקוח.${rank.reason ? `\nהמלצה: קונספט ${chosen + 1}. ${rank.reason}` : ""}
עלות עד כה: ₪${usdToIls(cost).toFixed(2)}
"בחר N" לפי מה שהלקוח בחר · "כותרת: …" לשינוי טקסט · "עוד גרסה" · "סרטון" · "סיום"`);
}

async function stepVariant(jobId: number) {
  const { job } = await loadJob(jobId);
  if (!job.copy) throw new Error("job has no copy yet");
  await setJob(jobId, { status: "generating", revisionRounds: job.revisionRounds + 1 });
  const base = job.variants[job.chosenVariant ?? 0] ?? job.variants[0];
  const suffix = EXTRA_VARIATIONS[job.revisionRounds % EXTRA_VARIATIONS.length];
  const made = await produceVariants(jobId, [{ label: `${base?.label ?? "גרסה"} (וריאציה)`, prompt: `${base?.prompt ?? job.copy.concepts[0].image_prompt}\n${suffix}`, textZone: base?.textZone ?? "top" }]);
  const produced = await renderVariants(jobId, made.map((v) => v.index));
  await sendRenders(jobId, produced);
}

async function stepRender(jobId: number) {
  const { job } = await loadJob(jobId);
  const produced = await renderVariants(jobId, job.variants.map((v) => v.index));
  await sendRenders(jobId, produced);
}

async function stepVideo(jobId: number, seconds: 5 | 10) {
  const { job, client } = await loadJob(jobId);
  if (!job.copy) throw new Error("job has no copy");
  const idx = job.chosenVariant ?? 0;
  const v = job.variants[idx];
  if (!v) throw new Error("no image to animate yet");
  await setJob(jobId, { status: "generating", wantsVideo: true, videoSeconds: seconds });
  await sendText(operator(), `מייצר סרטון ${seconds} שניות מקונספט ${idx + 1}. בדרך כלל 1–3 דקות.`);
  const image = await readJobFile(v.path);
  const video = await generateVideo({ jobId, image, prompt: job.copy.video_prompt, seconds });
  const slug = client.name.replace(/\s+/g, "-");
  const path = await saveJobFile(jobId, `${slug}_${new Date().toISOString().slice(0, 10)}_k${idx + 1}_${seconds}s.mp4`, video);
  await setJob(jobId, { videoPath: path, status: "awaiting_review" });
  await sendVideoBuffer(operator(), video, `k${idx + 1}-${seconds}s.mp4`, `סרטון ${seconds} שנ׳ · קונספט ${idx + 1} (בלי טקסט; כתוביות נכנסות בשלב 2)`);
  const cost = await jobCostUsd(jobId);
  await sendText(operator(), `עלות עד כה: ₪${usdToIls(cost).toFixed(2)}`);
}

// ---------- worker ----------

export function startWorker() {
  const worker = new Worker<AdJobData>(
    QUEUE,
    async (job: Job<AdJobData>) => {
      const d = job.data;
      log.info({ step: d.step, jobId: d.jobId, attempt: job.attemptsMade + 1 }, "job step start");
      switch (d.step) {
        case "brief": return stepBrief(d.jobId);
        case "generate": return stepGenerate(d.jobId);
        case "variant": return stepVariant(d.jobId);
        case "render": return stepRender(d.jobId);
        case "video": return stepVideo(d.jobId, d.seconds);
      }
    },
    { connection: redis(), concurrency: 2 },
  );

  // Anything thrown inside this handler becomes an unhandled rejection that kills the process,
  // so the whole body is guarded: reporting a failure must never be able to take the bot down.
  worker.on("failed", (job, err) => {
    void (async () => {
      if (!job) return;
      const { step, jobId } = job.data;
      const final = job.attemptsMade >= (job.opts.attempts ?? 1);
      log.error({ step, jobId, err, final }, "job step failed");
      if (!final) return;
      try {
        await setJob(jobId, { status: "failed", lastError: err.message.slice(0, 500) });
      } catch (e) {
        log.error({ err: e, jobId }, "could not mark job as failed");
      }
      try {
        await sendText(operator(), `❌ עבודה #${jobId}, שלב ${step} נכשל אחרי 3 ניסיונות:\n${err.message.slice(0, 300)}\nכתוב "אישור" כדי לנסות שוב.`);
      } catch (e) {
        log.error({ err: e, jobId }, "could not notify the operator about the failure");
      }
    })();
  });

  log.info("worker started");
  return worker;
}

/** The operator's "current job": the newest one that is not finished. */
export async function currentJob() {
  const rows = await db.select().from(schema.jobs).orderBy(schema.jobs.createdAt);
  return rows.filter((j) => j.status !== "done").at(-1) ?? null;
}
