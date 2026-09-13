import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import { log } from "../logger.js";
import { normalizeProductPhoto } from "../pipeline/overlay.js";
import { currentJob, enqueue } from "../queue/index.js";
import { saveJobFile } from "../storage.js";
import { downloadMedia, markRead, sendText } from "../whatsapp/client.js";
import type { Inbound } from "../whatsapp/webhook.js";
import { HELP, parseCommand } from "./router.js";
import { jobCostUsd, monthSummary, usdToIls } from "../costs.js";

const STATUS_HE: Record<string, string> = {
  briefing: "Claude כותב קופי",
  awaiting_approval: "ממתין לאישור הקופי שלך",
  generating: "מייצר תמונות",
  awaiting_review: "ממתין לבדיקה שלך",
  done: "הסתיימה",
  failed: "נכשלה",
};

/** Entry point for every inbound WhatsApp message. Runs outside the HTTP request so Meta gets its 200 quickly. */
export async function handleInbound(msg: Inbound): Promise<void> {
  const c = config();
  // Meta redelivers when it doesn't get a 200 in time; the unique index makes duplicates a no-op.
  const inserted = await db
    .insert(schema.inboundMessages)
    .values({ waMessageId: msg.id, fromPhone: msg.from, kind: msg.kind, body: msg.kind === "text" ? msg.text : msg.caption ?? null })
    .onConflictDoNothing()
    .returning({ id: schema.inboundMessages.id });
  if (inserted.length === 0) return;

  if (msg.from !== c.OPERATOR_PHONE) {
    log.warn({ from: msg.from }, "message from non-operator ignored");
    await sendText(msg.from, "היי! המספר הזה משרת את הסטודיו בלבד. לפרטים על מודעה ב‑98 ₪ נחזור אליך בהקדם.");
    return;
  }
  await markRead(msg.id);

  try {
    if (msg.kind === "image") await handleImage(msg);
    else await handleText(msg.text);
  } catch (err) {
    log.error({ err }, "handleInbound failed");
    await sendText(c.OPERATOR_PHONE, `שגיאה: ${(err as Error).message.slice(0, 300)}`);
  }
}

async function handleImage(msg: Extract<Inbound, { kind: "image" }>) {
  const op = config().OPERATOR_PHONE;
  const { buffer } = await downloadMedia(msg.mediaId);
  const jpeg = await normalizeProductPhoto(buffer);

  const cmd = msg.caption ? parseCommand(msg.caption) : null;
  if (cmd?.type === "new_job") {
    if (!cmd.brief) {
      await sendText(op, "חסר הטקסט למודעה. שלח את התמונה שוב עם כיתוב:\nלקוח: שם\nמה לכתוב במודעה");
      return;
    }
    const client = await upsertClient(cmd.client);
    const [job] = await db.insert(schema.jobs)
      .values({ clientId: client.id, brief: cmd.brief, style: cmd.style ?? null, status: "briefing" })
      .returning();
    const p = await saveJobFile(job.id, "product-1.jpg", jpeg);
    await db.update(schema.jobs).set({ productImages: [p] }).where(eq(schema.jobs.id, job.id));
    await enqueue({ step: "brief", jobId: job.id });
    await sendText(op, `נפתחה עבודה #${job.id} עבור ${client.name}. כותב קופי…`);
    return;
  }

  // An image without a "לקוח:" caption attaches to the current job (extra product angles, or a logo).
  const job = await currentJob();
  if (!job || !["briefing", "awaiting_approval", "awaiting_review"].includes(job.status)) {
    await sendText(op, "לאיזו עבודה התמונה? כדי לפתוח עבודה חדשה שלח תמונה עם כיתוב שמתחיל ב‑\"לקוח:\".");
    return;
  }
  if (msg.caption && /לוגו/u.test(msg.caption)) {
    const { saveClientFile } = await import("../storage.js");
    const p = await saveClientFile(job.clientId, "logo.png", buffer);
    await db.update(schema.clients).set({ logoPath: p }).where(eq(schema.clients.id, job.clientId));
    await sendText(op, "הלוגו נשמר בכרטיס הלקוח ויופיע בכל המודעות שלו.");
    return;
  }
  const n = job.productImages.length + 1;
  const p = await saveJobFile(job.id, `product-${n}.jpg`, jpeg);
  await db.update(schema.jobs).set({ productImages: [...job.productImages, p] }).where(eq(schema.jobs.id, job.id));
  await sendText(op, `תמונה ${n} נוספה לעבודה #${job.id}.`);
}

async function upsertClient(name: string) {
  const existing = await db.query.clients.findFirst({ where: eq(schema.clients.name, name) });
  if (existing) return existing;
  const [created] = await db.insert(schema.clients).values({ name }).returning();
  return created;
}

async function handleText(text: string) {
  const op = config().OPERATOR_PHONE;
  const cmd = parseCommand(text);

  if (cmd.type === "help") return sendText(op, HELP);
  if (cmd.type === "costs") {
    const s = await monthSummary();
    const lines = s.rows.map((r) => `${r.provider}: $${Number(r.total).toFixed(2)}`).join("\n");
    return sendText(op, `החודש: ${s.jobs} עבודות\n${lines || "אין קריאות עדיין"}\nסה״כ: $${s.totalUsd.toFixed(2)} ≈ ₪${s.totalIls.toFixed(0)}`);
  }
  if (cmd.type === "new_job") {
    return sendText(op, "כדי לפתוח עבודה שלח את תמונת המוצר עם הכיתוב הזה (לקוח: … ואז הטקסט).");
  }

  const job = await currentJob();
  if (!job) return sendText(op, "אין עבודה פתוחה. שלח תמונת מוצר עם כיתוב \"לקוח: שם\" ומתחת הטקסט למודעה.");

  switch (cmd.type) {
    case "status":
      return sendText(op, `עבודה #${job.id}: ${STATUS_HE[job.status] ?? job.status}${job.lastError ? `\nשגיאה אחרונה: ${job.lastError}` : ""}`);

    case "approve":
      if (job.status === "awaiting_approval" || job.status === "failed") {
        if (!job.copy) { await enqueue({ step: "brief", jobId: job.id }); return sendText(op, "מנסה שוב לכתוב קופי…"); }
        await enqueue({ step: "generate", jobId: job.id });
        return sendText(op, `מייצר 3 גרסאות תמונה לעבודה #${job.id}. זה לוקח כדקה.`);
      }
      return sendText(op, `עבודה #${job.id} כרגע: ${STATUS_HE[job.status]}. אין מה לאשר.`);

    case "set_copy": {
      if (!job.copy) return sendText(op, "עדיין אין קופי לשנות. חכה להצעה.");
      const copy = { ...job.copy, [cmd.field]: cmd.value };
      await db.update(schema.jobs).set({ copy, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id));
      if (job.status === "awaiting_review" && job.variants.length) {
        await enqueue({ step: "render", jobId: job.id });
        return sendText(op, "עודכן. מצייר מחדש את הטקסט (בלי ייצור תמונה, בלי עלות).");
      }
      return sendText(op, `עודכן. כותרת: ${copy.headline}\nמשפט: ${copy.subline}\nכפתור: ${copy.cta}\nכתוב "אישור" להמשך.`);
    }

    case "choose": {
      if (!job.variants[cmd.index]) return sendText(op, `אין גרסה ${cmd.index + 1}. יש ${job.variants.length} גרסאות.`);
      await db.update(schema.jobs).set({ chosenVariant: cmd.index, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id));
      await enqueue({ step: "render", jobId: job.id });
      return sendText(op, `נבחרה גרסה ${cmd.index + 1}. מרנדר פורמטים…`);
    }

    case "more_variant":
      if (!job.copy) return sendText(op, "קודם צריך קופי מאושר.");
      if (job.revisionRounds >= 3) await sendText(op, `שים לב: זו גרסה נוספת מספר ${job.revisionRounds + 1} בעבודה הזו.`);
      await enqueue({ step: "variant", jobId: job.id });
      return sendText(op, "מייצר גרסה נוספת…");

    case "no_video":
      await db.update(schema.jobs).set({ wantsVideo: false }).where(eq(schema.jobs.id, job.id));
      return sendText(op, "סומן: בלי סרטון. (ייצור סרטון נכנס בשלב 2.)");
    case "video_only":
      return sendText(op, "ייצור סרטון נכנס בשלב 2. בינתיים העבודה ממשיכה עם תמונות.");

    case "finish": {
      const cost = await jobCostUsd(job.id);
      await db.update(schema.jobs).set({ status: "done", updatedAt: new Date() }).where(eq(schema.jobs.id, job.id));
      return sendText(op, `עבודה #${job.id} נסגרה.\nעלות בפועל: $${cost.toFixed(3)} ≈ ₪${usdToIls(cost).toFixed(2)}\nהקבצים בתיקייה data/jobs/${job.id}.`);
    }

    case "unknown":
    default:
      return sendText(op, `לא הבנתי "${text.slice(0, 40)}". כתוב "עזרה" לרשימת הפקודות.`);
  }
}
