import { randomUUID } from "node:crypto";
import type { AttachmentRef, Citation, ConversationView, MessageView, Role, SafetyOutcome, UsageSummary } from "@bombot/shared";
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
}
