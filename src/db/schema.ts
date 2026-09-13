import { pgTable, serial, text, integer, jsonb, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { AdCopy } from "../pipeline/brief.js";

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  phone: text("phone"),
  logoPath: text("logo_path"),
  primaryColor: text("primary_color"),
  accentColor: text("accent_color"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Job lifecycle:
 *   briefing → awaiting_approval → generating → awaiting_review → done
 *   any step may move to `failed`; the operator can resume with `אישור` / `עוד גרסה`.
 */
export type JobStatus = "briefing" | "awaiting_approval" | "generating" | "awaiting_review" | "done" | "failed";

export interface Variant { path: string; index: number; label: string; prompt: string; textZone: "top" | "bottom" }
export interface Output { variantIndex: number; feed: string; story: string }
export interface Outputs { renders: Output[] }

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id),
  status: text("status").$type<JobStatus>().notNull().default("briefing"),
  brief: text("brief").notNull(),
  style: text("style"),
  productImages: jsonb("product_images").$type<string[]>().notNull().default([]),
  copy: jsonb("copy").$type<AdCopy>(),
  variants: jsonb("variants").$type<Variant[]>().notNull().default([]),
  chosenVariant: integer("chosen_variant"),
  outputs: jsonb("outputs").$type<Outputs>(),
  revisionRounds: integer("revision_rounds").notNull().default(0),
  wantsVideo: boolean("wants_video").notNull().default(false),
  videoPath: text("video_path"),
  videoSeconds: integer("video_seconds"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** One row per paid API call, so `עלויות` reports real numbers rather than estimates. */
export const apiCalls = pgTable("api_calls", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => jobs.id),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  action: text("action").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  units: numeric("units"),
  costUsd: numeric("cost_usd").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Inbound WhatsApp message ids, used to drop Meta's redeliveries. */
export const inboundMessages = pgTable("inbound_messages", {
  id: serial("id").primaryKey(),
  waMessageId: text("wa_message_id").notNull().unique(),
  fromPhone: text("from_phone").notNull(),
  kind: text("kind").notNull(),
  body: text("body"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
