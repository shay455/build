import { randomUUID } from "node:crypto";
import type { AttachmentRef, BotIntent, BotRequestView, ChatSettings, Citation, ConversationView, GeneratedImage, MessageView, Role, SafetyOutcome, UsageSummary, Verdict } from "@bombot/shared";
import type { Queryable } from "./client.js";

interface MessageRow {
  id: string;
  conversation_id: string;
  role: Role;
  text: string;
  thinking: string | null;
  citations: Citation[];
  attachments: AttachmentRef[];
  usage: UsageSummary | null;
  safety: SafetyOutcome | null;
  created_at: string | Date;
}
interface ConversationRow { id: string; title: string; created_at: string | Date; updated_at: string | Date }

const iso = (d: string | Date) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

function toMessage(r: MessageRow): MessageView {
  return {
    id: r.id, conversationId: r.conversation_id, role: r.role, text: r.text, thinking: r.thinking,
    citations: r.citations ?? [], attachments: r.attachments ?? [], usage: r.usage, safety: r.safety,
    createdAt: iso(r.created_at),
  };
}

export class Repo {
  constructor(private readonly db: Queryable) {}

  async createConversation(title = ""): Promise<ConversationView> {
    const id = randomUUID();
    const { rows } = await this.db.query<ConversationRow>(
      "INSERT INTO conversations (id, title) VALUES ($1, $2) RETURNING *", [id, title]);
    const c = rows[0]!;
    return { id: c.id, title: c.title, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at), messages: [] };
  }

  async listConversations(limit = 50): Promise<Omit<ConversationView, "messages">[]> {
    const { rows } = await this.db.query<ConversationRow>(
      "SELECT * FROM conversations ORDER BY updated_at DESC LIMIT $1", [limit]);
    return rows.map((c) => ({ id: c.id, title: c.title, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at) }));
  }

  async getConversation(id: string): Promise<ConversationView | null> {
    const { rows } = await this.db.query<ConversationRow>("SELECT * FROM conversations WHERE id = $1", [id]);
    const c = rows[0];
    if (!c) return null;
    const { rows: msgs } = await this.db.query<MessageRow>(
      "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC", [id]);
    return { id: c.id, title: c.title, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at), messages: msgs.map(toMessage) };
  }

  async deleteConversation(id: string): Promise<void> {
    await this.db.query("DELETE FROM conversations WHERE id = $1", [id]);
  }

  async setTitleIfEmpty(id: string, title: string): Promise<void> {
    await this.db.query("UPDATE conversations SET title = $2 WHERE id = $1 AND title = ''", [id, title.slice(0, 80)]);
  }

  async touch(id: string): Promise<void> {
    await this.db.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [id]);
  }

  async insertMessage(m: Omit<MessageView, "createdAt">): Promise<MessageView> {
    const { rows } = await this.db.query<MessageRow>(
      `INSERT INTO messages (id, conversation_id, role, text, thinking, citations, attachments, usage, safety)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [m.id, m.conversationId, m.role, m.text, m.thinking, JSON.stringify(m.citations), JSON.stringify(m.attachments),
       m.usage ? JSON.stringify(m.usage) : null, m.safety ? JSON.stringify(m.safety) : null]);
    await this.touch(m.conversationId);
    return toMessage(rows[0]!);
  }

  async insertAttachment(a: AttachmentRef & { storageKey: string }): Promise<void> {
    await this.db.query(
      "INSERT INTO attachments (id, name, mime_type, size_bytes, storage_key) VALUES ($1,$2,$3,$4,$5)",
      [a.id, a.name, a.mimeType, a.sizeBytes, a.storageKey]);
  }

  async getAttachments(ids: string[]): Promise<(AttachmentRef & { storageKey: string })[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query<{ id: string; name: string; mime_type: string; size_bytes: number; storage_key: string }>(
      "SELECT * FROM attachments WHERE id = ANY($1::text[])", [ids]);
    return rows.map((r) => ({ id: r.id, name: r.name, mimeType: r.mime_type, sizeBytes: r.size_bytes, storageKey: r.storage_key }));
  }

  async logSafety(e: SafetyOutcome & { conversationId: string | null; messageId: string | null }): Promise<void> {
    await this.db.query(
      "INSERT INTO safety_events (id, conversation_id, message_id, stage, action, category, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [randomUUID(), e.conversationId, e.messageId, e.stage, e.action, e.category, e.reason]);
  }

  async logUsage(u: UsageSummary & { conversationId: string; messageId: string; latencyMs: number; firstTokenMs: number | null }): Promise<void> {
    await this.db.query(
      `INSERT INTO usage_log (id, conversation_id, message_id, model, input_tokens, output_tokens, cache_read_input_tokens,
        cache_creation_input_tokens, web_search_requests, estimated_cost_usd, latency_ms, first_token_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [randomUUID(), u.conversationId, u.messageId, u.model, u.inputTokens, u.outputTokens, u.cacheReadInputTokens,
       u.cacheCreationInputTokens, u.webSearchRequests, u.estimatedCostUsd, u.latencyMs, u.firstTokenMs]);
  }

  /** Operator metrics for the dashboard and the phase-A exit criteria. */
  async metrics(): Promise<Record<string, unknown>> {
    const { rows: [u] } = await this.db.query<Record<string, string | null>>(`
      SELECT count(*)::int AS responses,
             coalesce(avg(estimated_cost_usd),0)::float AS avg_cost_usd,
             coalesce(sum(estimated_cost_usd),0)::float AS total_cost_usd,
             coalesce(avg(latency_ms),0)::float AS avg_latency_ms,
             coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY first_token_ms),0)::float AS p95_first_token_ms,
             CASE WHEN sum(input_tokens + cache_read_input_tokens) > 0
                  THEN sum(cache_read_input_tokens)::float / sum(input_tokens + cache_read_input_tokens) ELSE 0 END AS cache_hit_ratio
      FROM usage_log`);
    const { rows: [s] } = await this.db.query<Record<string, string | null>>(
      "SELECT count(*) FILTER (WHERE action <> 'allow')::int AS interventions FROM safety_events");
    const { rows: [c] } = await this.db.query<Record<string, string | null>>(`
      SELECT count(*) FILTER (WHERE jsonb_array_length(citations) > 0)::int AS cited,
             count(*)::int AS total
      FROM messages WHERE role = 'assistant' AND (usage->>'webSearchRequests')::int > 0`);
    return { ...u, safetyInterventions: s?.interventions ?? 0, citationCoverage: c ? { cited: c.cited, searchedResponses: c.total } : null };
  }

  /* ---------------- Phase B: Telegram mention bot ---------------- */

  /** Idempotency for webhooks: returns false if this update was already seen. */
  async claimUpdate(updateId: number): Promise<boolean> {
    const { rows } = await this.db.query<{ update_id: string }>(
      "INSERT INTO processed_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id", [updateId]);
    return rows.length > 0;
  }

  async rememberTgMessage(m: TgStoredMessage): Promise<void> {
    await this.db.query(
      `INSERT INTO tg_messages (chat_id, message_id, thread_id, reply_to_message_id, user_id, user_name, text, has_photo, photo_file_id, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (chat_id, message_id) DO NOTHING`,
      [m.chatId, m.messageId, m.threadId, m.replyToMessageId, m.userId, m.userName, m.text, m.hasPhoto, m.photoFileId, m.sentAt]);
  }

  async getTgMessage(chatId: string, messageId: number): Promise<TgStoredMessage | null> {
    const { rows } = await this.db.query<TgRow>("SELECT * FROM tg_messages WHERE chat_id = $1 AND message_id = $2", [chatId, messageId]);
    return rows[0] ? tgRow(rows[0]) : null;
  }

  /** Most recent messages in a chat (and topic, when given), oldest first. */
  async recentTgMessages(chatId: string, threadId: number | null, limit = 20): Promise<TgStoredMessage[]> {
    const { rows } = threadId === null
      ? await this.db.query<TgRow>("SELECT * FROM tg_messages WHERE chat_id = $1 ORDER BY sent_at DESC LIMIT $2", [chatId, limit])
      : await this.db.query<TgRow>("SELECT * FROM tg_messages WHERE chat_id = $1 AND thread_id = $2 ORDER BY sent_at DESC LIMIT $3", [chatId, threadId, limit]);
    return rows.map(tgRow).reverse();
  }

  async countRecentRequests(platform: string, userId: string, sinceMs: number): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM bot_requests WHERE platform = $1 AND user_id = $2 AND created_at > $3 AND status IN ('answered','silent','blocked')",
      [platform, userId, new Date(Date.now() - sinceMs).toISOString()]);
    return rows[0]?.n ?? 0;
  }

  async insertBotRequest(r: Omit<BotRequestView, "createdAt">): Promise<BotRequestView> {
    const { rows } = await this.db.query<BotRow>(
      `INSERT INTO bot_requests (id, platform, chat_id, chat_title, user_id, user_name, intent, request_text, reply_text, reply_message_id,
        verdict, confidence, citations, safety, usage, latency_ms, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [r.id, r.platform, r.chatId, r.chatTitle, r.userId, r.userName, r.intent, r.requestText, r.replyText, r.replyMessageId,
       r.verdict, r.confidence, JSON.stringify(r.citations), r.safety ? JSON.stringify(r.safety) : null, r.usage ? JSON.stringify(r.usage) : null,
       r.latencyMs, r.status]);
    return botRow(rows[0]!);
  }

  async listBotRequests(limit = 50): Promise<BotRequestView[]> {
    const { rows } = await this.db.query<BotRow>("SELECT * FROM bot_requests ORDER BY created_at DESC LIMIT $1", [limit]);
    return rows.map(botRow);
  }

  async getBotRequest(id: string): Promise<BotRequestView | null> {
    const { rows } = await this.db.query<BotRow>("SELECT * FROM bot_requests WHERE id = $1", [id]);
    return rows[0] ? botRow(rows[0]) : null;
  }

  async markBotRequest(id: string, status: BotRequestView["status"]): Promise<void> {
    await this.db.query("UPDATE bot_requests SET status = $2 WHERE id = $1", [id, status]);
  }

  async getChatSettings(chatId: string): Promise<ChatSettings> {
    const { rows } = await this.db.query<{ chat_id: string; respond_mode: ChatSettings["respondMode"]; language: ChatSettings["language"]; blocked_topics: string[]; enabled: boolean }>(
      "SELECT * FROM chat_settings WHERE chat_id = $1", [chatId]);
    const r = rows[0];
    if (!r) return { chatId, respondMode: "mention_only", language: "auto", blockedTopics: [], enabled: true };
    return { chatId, respondMode: r.respond_mode, language: r.language, blockedTopics: r.blocked_topics ?? [], enabled: r.enabled };
  }

  async saveChatSettings(s: ChatSettings): Promise<void> {
    await this.db.query(
      `INSERT INTO chat_settings (chat_id, respond_mode, language, blocked_topics, enabled) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (chat_id) DO UPDATE SET respond_mode = EXCLUDED.respond_mode, language = EXCLUDED.language,
         blocked_topics = EXCLUDED.blocked_topics, enabled = EXCLUDED.enabled`,
      [s.chatId, s.respondMode, s.language, JSON.stringify(s.blockedTopics), s.enabled]);
  }

  /** Global kill switch and other operator flags. */
  async getState<T>(key: string, fallback: T): Promise<T> {
    const { rows } = await this.db.query<{ value: T }>("SELECT value FROM bot_state WHERE key = $1", [key]);
    return rows[0] ? rows[0].value : fallback;
  }

  async setState(key: string, value: unknown): Promise<void> {
    await this.db.query(
      "INSERT INTO bot_state (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [key, JSON.stringify(value)]);
  }

  /* ---------------- Phase B: images ---------------- */

  async insertImage(i: Omit<GeneratedImage, "url" | "createdAt"> & { ownerKey: string | null; storageKey: string }): Promise<void> {
    await this.db.query(
      "INSERT INTO images (id, owner_key, prompt, final_prompt, provider, model, width, height, storage_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [i.id, i.ownerKey, i.prompt, i.finalPrompt, i.provider, i.model, i.width, i.height, i.storageKey]);
  }

  async getImage(id: string): Promise<(Omit<GeneratedImage, "url"> & { storageKey: string }) | null> {
    const { rows } = await this.db.query<{ id: string; prompt: string; final_prompt: string; provider: GeneratedImage["provider"]; model: string; width: number; height: number; storage_key: string; created_at: string | Date }>(
      "SELECT * FROM images WHERE id = $1", [id]);
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, prompt: r.prompt, finalPrompt: r.final_prompt, provider: r.provider, model: r.model, width: r.width, height: r.height, storageKey: r.storage_key, createdAt: iso(r.created_at) };
  }

  async countImagesToday(ownerKey: string): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM images WHERE owner_key = $1 AND created_at > now() - interval '1 day'", [ownerKey]);
    return rows[0]?.n ?? 0;
  }
}

export interface TgStoredMessage {
  chatId: string; messageId: number; threadId: number | null; replyToMessageId: number | null;
  userId: string | null; userName: string | null; text: string; hasPhoto: boolean; photoFileId: string | null; sentAt: string;
}
interface TgRow { chat_id: string; message_id: string | number; thread_id: string | number | null; reply_to_message_id: string | number | null; user_id: string | null; user_name: string | null; text: string; has_photo: boolean; photo_file_id: string | null; sent_at: string | Date }
const tgRow = (r: TgRow): TgStoredMessage => ({
  chatId: r.chat_id, messageId: Number(r.message_id), threadId: r.thread_id === null ? null : Number(r.thread_id),
  replyToMessageId: r.reply_to_message_id === null ? null : Number(r.reply_to_message_id), userId: r.user_id, userName: r.user_name,
  text: r.text, hasPhoto: r.has_photo, photoFileId: r.photo_file_id, sentAt: iso(r.sent_at),
});
interface BotRow {
  id: string; platform: "telegram"; chat_id: string; chat_title: string | null; user_id: string; user_name: string | null; intent: BotIntent;
  request_text: string; reply_text: string | null; reply_message_id: string | null; verdict: Verdict | null; confidence: number | null;
  citations: Citation[]; safety: SafetyOutcome | null; usage: UsageSummary | null; latency_ms: number | null; status: BotRequestView["status"]; created_at: string | Date;
}
const botRow = (r: BotRow): BotRequestView => ({
  id: r.id, platform: r.platform, chatId: r.chat_id, chatTitle: r.chat_title, userId: r.user_id, userName: r.user_name, intent: r.intent,
  requestText: r.request_text, replyText: r.reply_text, replyMessageId: r.reply_message_id, verdict: r.verdict, confidence: r.confidence,
  citations: r.citations ?? [], safety: r.safety, usage: r.usage, latencyMs: r.latency_ms, status: r.status, createdAt: iso(r.created_at),
});
