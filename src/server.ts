import Fastify from "fastify";
import { config } from "./config.js";
import { log } from "./logger.js";
import { handleInbound } from "./commands/handle.js";
import { startWorker } from "./queue/index.js";
import { parseInbound, verifySignature } from "./whatsapp/webhook.js";

const c = config();
const app = Fastify({ logger: false });

// Keep the raw body: Meta's signature is computed over the exact bytes.
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

app.get("/health", async () => ({ ok: true }));

// Meta calls this once when you save the webhook URL in the app dashboard.
app.get("/webhook", async (req, reply) => {
  const q = req.query as Record<string, string>;
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === c.WA_VERIFY_TOKEN) {
    return reply.code(200).send(q["hub.challenge"]);
  }
  return reply.code(403).send("verify token mismatch");
});

app.post("/webhook", async (req, reply) => {
  const raw = req.body as Buffer;
  if (!verifySignature(raw, req.headers["x-hub-signature-256"] as string | undefined, c.WA_APP_SECRET)) {
    log.warn("webhook signature mismatch");
    return reply.code(401).send();
  }
  let payload: unknown;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { return reply.code(400).send(); }
  const messages = parseInbound(payload);
  // Acknowledge first; processing (media download, DB, queue) continues in the background.
  reply.code(200).send();
  for (const m of messages) {
    handleInbound(m).catch((err) => log.error({ err, id: m.id }, "inbound handling failed"));
  }
});

startWorker();
app.listen({ port: c.PORT, host: "0.0.0.0" })
  .then(() => log.info({ port: c.PORT, webhook: `${c.PUBLIC_BASE_URL}/webhook` }, "server up"))
  .catch((err) => { log.error(err); process.exit(1); });
