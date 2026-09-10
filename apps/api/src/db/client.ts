import type { Env } from "../config/env.js";

/** The subset of the `pg` / PGlite query surface the repository layer needs. */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  close(): Promise<void>;
}

export async function createDb(env: Env): Promise<Queryable> {
  if (env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    return {
      query: (text, params) => pool.query(text, params as never[]) as never,
      close: () => pool.end(),
    };
  }
  // Embedded Postgres for development and tests. Same SQL dialect as production.
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = env.PGLITE_DIR === ":memory:" ? new PGlite() : new PGlite(env.PGLITE_DIR);
  return {
    query: (text, params) => pg.query(text, params as never[]) as never,
    close: () => pg.close(),
  };
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text TEXT NOT NULL DEFAULT '',
  thinking TEXT,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  usage JSONB,
  safety JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS safety_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  message_id TEXT,
  stage TEXT NOT NULL,
  action TEXT NOT NULL,
  category TEXT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage_log (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  message_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_input_tokens INTEGER NOT NULL,
  cache_creation_input_tokens INTEGER NOT NULL,
  web_search_requests INTEGER NOT NULL,
  estimated_cost_usd NUMERIC(12,6) NOT NULL,
  latency_ms INTEGER NOT NULL,
  first_token_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function migrate(db: Queryable): Promise<void> {
  for (const stmt of SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.query(stmt);
  }
}
