import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { and, eq } from "drizzle-orm";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import { log } from "../logger.js";
import { buildBrief } from "../pipeline/brief.js";
import { generateVariants } from "../pipeline/images.js";
import { renderFormat } from "../pipeline/overlay.js";
import { rankVariants } from "../pipeline/rank.js";
import { readJobFile, saveJobFile } from "../storage.js";
import { sendImageBuffer, sendText } from "../whatsapp/client.js";
import { jobCostUsd, usdToIls } from "../costs.js";
import type { Variant } from "../db/schema.js";

export type AdJobData =
  | { step: "brief"; jobId: number }
  | { step: "generate"; jobId: number }
  | { step: "variant"; jobId: number }
  | { step: "render"; jobId: number };

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

function copySummary(c: NonNullable<typeof schema.jobs.$inferSelect["copy"]>, jobId: number, clientName: string) {
  const flags = c.flags.length ? `\n⚠️ לבדיקה: ${c.flags.join("; ")}` : "";
  return `עבודה #${jobId} · ${clientName}
הצעת קופי:
כותרת: ${c.headline}
משפט: ${c.subline}
כפתור: ${c.cta}
כיוון: ${c.style_rationale}
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

async function produceVariants(jobId: number, count: number) {
  const { job } = await loadJob(jobId);
  if (!job.copy) throw new Error("job has no copy yet");
  const references = await Promise.all(job.productImages.map(async (p) => ({ data: await readJobFile(p), mime: "image/jpeg" })));
  const offset = job.variants.length;
  const results = await generateVariants({ jobId, prompt: job.copy.image_prompt, references, aspectRatio: "1:1", size: "2K" }, count, offset);
  const variants: Variant[] = [...job.variants];
  for (const r of results) {
    const index = variants.length;
    const path = await saveJobFile(jobId, `variant-${index + 1}.${r.mime.includes("png") ? "png" : "jpg"}`, r.data);
    variants.push({ path, index });
  }
  await setJob(jobId, { variants });
  return variants;
}

async function renderOutputs(jobId: number) {
  const { job, client } = await loadJob(jobId);
  if (!job.copy) throw new Error("job has no copy");
  const idx = job.chosenVariant ?? 0;
  const variant = job.variants[idx];
  if (!variant) throw new Error(`variant ${idx} missing`);
  const image = await readJobFile(variant.path);
  const logo = client.logoPath ? await readJobFile(client.logoPath) : null;
  const [feed, story] = await Promise.all([
    renderFormat({ image, copy: job.copy, logo, format: "feed" }),
    renderFormat({ image, copy: job.copy, logo, format: "story" }),
  ]);
  const slug = client.name.replace(/\s+/g, "-");
  const date = new Date().toISOString().slice(0, 10);
  const feedPath = await saveJobFile(jobId, `${slug}_${date}_feed.jpg`, feed);
  const storyPath = await saveJobFile(jobId, `${slug}_${date}_story.jpg`, story);
  await setJob(jobId, { outputs: { feed: feedPath, story: storyPath, variantIndex: idx }, status: "awaiting_review" });
  return { feed, story, feedPath, storyPath };
}

async function stepGenerate(jobId: number) {
  await setJob(jobId, { status: "generating" });
  const variants = await produceVariants(jobId, 3);
  const { job } = await loadJob(jobId);
  const buffers = await Promise.all(variants.map((v) => readJobFile(v.path)));
  const jpegs = await Promise.all(buffers.map((b) => sharpToJpeg(b)));
  const rank = await rankVariants(jobId, job.brief, job.copy!.headline, jpegs);
  await setJob(jobId, { chosenVariant: rank.best_index });

  for (const [i, v] of variants.entries()) {
    await sendImageBuffer(operator(), jpegs[i], `variant-${i + 1}.jpg`, `גרסה ${i + 1}${i === rank.best_index ? " ★ מומלצת" : ""}`);
    void v;
  }
  const out = await renderOutputs(jobId);
  await sendImageBuffer(operator(), out.feed, "feed.jpg", `פיד 1080×1080 (גרסה ${rank.best_index + 1})`, true);
  await sendImageBuffer(operator(), out.story, "story.jpg", "סטורי 1080×1920", true);
  const cost = await jobCostUsd(jobId);
  await sendText(operator(), `${rank.reason ? `למה גרסה ${rank.best_index + 1}: ${rank.reason}\n` : ""}עלות עד כה: ₪${usdToIls(cost).toFixed(2)}
"בחר 2" לגרסה אחרת · "כותרת: …" לשינוי טקסט · "עוד גרסה" · "סיום"`);
}

async function stepVariant(jobId: number) {
  const { job } = await loadJob(jobId);
  await setJob(jobId, { status: "generating", revisionRounds: job.revisionRounds + 1 });
  const variants = await produceVariants(jobId, 1);
  const v = variants[variants.length - 1];
  const jpeg = await sharpToJpeg(await readJobFile(v.path));
  await sendImageBuffer(operator(), jpeg, `variant-${v.index + 1}.jpg`, `גרסה ${v.index + 1}. "בחר ${v.index + 1}" כדי להשתמש בה.`);
  await setJob(jobId, { status: "awaiting_review" });
}

async function stepRender(jobId: number) {
  const out = await renderOutputs(jobId);
  const { job } = await loadJob(jobId);
  await sendImageBuffer(operator(), out.feed, "feed.jpg", `פיד (גרסה ${(job.chosenVariant ?? 0) + 1})`, true);
  await sendImageBuffer(operator(), out.story, "story.jpg", "סטורי", true);
}

async function sharpToJpeg(buf: Buffer) {
  const sharp = (await import("sharp")).default;
  return sharp(buf).jpeg({ quality: 88 }).toBuffer();
}

// ---------- worker ----------

export function startWorker() {
  const worker = new Worker<AdJobData>(
    QUEUE,
    async (job: Job<AdJobData>) => {
      const { step, jobId } = job.data;
      log.info({ step, jobId, attempt: job.attemptsMade + 1 }, "job step start");
      switch (step) {
        case "brief": return stepBrief(jobId);
        case "generate": return stepGenerate(jobId);
        case "variant": return stepVariant(jobId);
        case "render": return stepRender(jobId);
      }
    },
    { connection: redis(), concurrency: 2 },
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { step, jobId } = job.data;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    log.error({ step, jobId, err, final }, "job step failed");
    if (final) {
      await setJob(jobId, { status: "failed", lastError: err.message.slice(0, 500) });
      await sendText(operator(), `❌ עבודה #${jobId}, שלב ${step} נכשל אחרי 3 ניסיונות:\n${err.message.slice(0, 300)}\nכתוב "אישור" כדי לנסות שוב.`);
    }
  });

  log.info("worker started");
  return worker;
}

/** The operator's "current job": the newest one that is not finished. */
export async function currentJob() {
  const rows = await db.select().from(schema.jobs)
    .where(and(eq(schema.jobs.status, schema.jobs.status)))
    .orderBy(schema.jobs.createdAt);
  return rows.filter((j) => j.status !== "done").at(-1) ?? null;
}
