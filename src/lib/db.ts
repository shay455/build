import 'server-only';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Comparable, Features, Property } from '@/types/property';
import type { SavedSearch, SeenState } from './alerts';
import { SEED_PROPERTIES } from './seed-data';

const DB_PATH = process.env.DATABASE_PATH ?? resolve(process.cwd(), 'data', 'app.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  deal TEXT NOT NULL CHECK (deal IN ('sale','rent')),
  price INTEGER NOT NULL,

  source TEXT NOT NULL,
  published_at TEXT NOT NULL,
  days_on_market INTEGER NOT NULL DEFAULT 0,
  publisher_kind TEXT NOT NULL CHECK (publisher_kind IN ('agency','private')),
  agent_fee_pct REAL NOT NULL DEFAULT 0,
  price_drop INTEGER NOT NULL DEFAULT 0,
  available_from TEXT NOT NULL DEFAULT 'מיידי',

  city TEXT NOT NULL,
  neighborhood TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  gush INTEGER NOT NULL,
  helka INTEGER NOT NULL,
  tat_helka INTEGER,
  walk_transit_min INTEGER NOT NULL DEFAULT 0,
  walk_school_min INTEGER NOT NULL DEFAULT 0,
  walk_park_min INTEGER NOT NULL DEFAULT 0,

  asset_type TEXT NOT NULL,
  rooms REAL NOT NULL,
  sqm INTEGER NOT NULL,
  balcony_sqm INTEGER NOT NULL DEFAULT 0,
  lot_sqm INTEGER,
  floor INTEGER NOT NULL DEFAULT 0,
  floors_in_building INTEGER NOT NULL DEFAULT 1,
  built_year INTEGER NOT NULL,
  condition TEXT NOT NULL,
  aspects TEXT NOT NULL DEFAULT '',
  features TEXT NOT NULL,

  registry_kind TEXT NOT NULL,
  tenure TEXT NOT NULL,
  lease_ends_at TEXT,
  caveats INTEGER NOT NULL DEFAULT 0,
  mortgages INTEGER NOT NULL DEFAULT 0,
  registry_verified INTEGER NOT NULL DEFAULT 0,
  split_permit TEXT,

  urban_renewal TEXT,
  renewal_stage TEXT,
  betterment_risk TEXT,

  area_median_ppsm INTEGER NOT NULL DEFAULT 0,
  area_median_rent INTEGER NOT NULL DEFAULT 0,
  expected_monthly_rent INTEGER NOT NULL DEFAULT 0,
  comparables TEXT NOT NULL DEFAULT '[]',
  market_as_of TEXT NOT NULL DEFAULT '',

  arnona INTEGER NOT NULL DEFAULT 0,
  vaad INTEGER NOT NULL DEFAULT 0,
  utilities INTEGER NOT NULL DEFAULT 0,

  deposit_months INTEGER NOT NULL DEFAULT 0,
  min_lease_months INTEGER NOT NULL DEFAULT 12,
  pets_allowed INTEGER NOT NULL DEFAULT 0,
  fair_rent_law INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_properties_deal_city ON properties (deal, city);
CREATE INDEX IF NOT EXISTS idx_properties_gush_helka ON properties (gush, helka);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  profile TEXT NOT NULL,
  min_score INTEGER NOT NULL DEFAULT 60,
  created_at TEXT NOT NULL,
  last_run_at TEXT,
  -- NULL means "never run". Distinct from '{}', which means "ran, matched nothing".
  seen TEXT
);

CREATE TABLE IF NOT EXISTS source_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

/**
 * Additive column migrations. SQLite has no "ADD COLUMN IF NOT EXISTS", so each is
 * applied only when absent — keeping an already-seeded local database usable.
 */
const COLUMN_MIGRATIONS: Array<[column: string, ddl: string]> = [
  ['market_source_id', "ALTER TABLE properties ADD COLUMN market_source_id TEXT NOT NULL DEFAULT 'manual'"],
  ['market_status', "ALTER TABLE properties ADD COLUMN market_status TEXT NOT NULL DEFAULT 'manual'"],
  ['market_sample_size', 'ALTER TABLE properties ADD COLUMN market_sample_size INTEGER NOT NULL DEFAULT 0'],
  ['market_fetched_at', 'ALTER TABLE properties ADD COLUMN market_fetched_at TEXT'],
];

function migrate(conn: Database.Database): void {
  const existing = new Set(
    (conn.prepare('PRAGMA table_info(properties)').all() as { name: string }[]).map((c) => c.name),
  );
  for (const [column, ddl] of COLUMN_MIGRATIONS) {
    if (!existing.has(column)) conn.exec(ddl);
  }
}

interface Row {
  [key: string]: unknown;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  migrate(db);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM properties').get() as { n: number };
  if (n === 0) insertMany(SEED_PROPERTIES);
  return db;
}

const COLUMNS = [
  'id', 'deal', 'price', 'source', 'published_at', 'days_on_market', 'publisher_kind', 'agent_fee_pct',
  'price_drop', 'available_from', 'city', 'neighborhood', 'street', 'gush', 'helka', 'tat_helka',
  'walk_transit_min', 'walk_school_min', 'walk_park_min', 'asset_type', 'rooms', 'sqm', 'balcony_sqm',
  'lot_sqm', 'floor', 'floors_in_building', 'built_year', 'condition', 'aspects', 'features',
  'registry_kind', 'tenure', 'lease_ends_at', 'caveats', 'mortgages', 'registry_verified', 'split_permit',
  'urban_renewal', 'renewal_stage', 'betterment_risk', 'area_median_ppsm', 'area_median_rent',
  'expected_monthly_rent', 'comparables', 'market_as_of', 'market_source_id', 'market_status',
  'market_sample_size', 'market_fetched_at', 'arnona', 'vaad', 'utilities',
  'deposit_months', 'min_lease_months', 'pets_allowed', 'fair_rent_law',
] as const;

function toRow(p: Property): Row {
  return {
    id: p.id, deal: p.deal, price: p.price, source: p.source, published_at: p.publishedAt,
    days_on_market: p.daysOnMarket, publisher_kind: p.publisherKind, agent_fee_pct: p.agentFeePct,
    price_drop: p.priceDrop, available_from: p.availableFrom, city: p.city, neighborhood: p.neighborhood,
    street: p.street, gush: p.gush, helka: p.helka, tat_helka: p.tatHelka,
    walk_transit_min: p.walkTransitMin, walk_school_min: p.walkSchoolMin, walk_park_min: p.walkParkMin,
    asset_type: p.assetType, rooms: p.rooms, sqm: p.sqm, balcony_sqm: p.balconySqm, lot_sqm: p.lotSqm,
    floor: p.floor, floors_in_building: p.floorsInBuilding, built_year: p.builtYear, condition: p.condition,
    aspects: p.aspects, features: JSON.stringify(p.features), registry_kind: p.registryKind,
    tenure: p.tenure, lease_ends_at: p.leaseEndsAt, caveats: p.caveats, mortgages: p.mortgages,
    registry_verified: p.registryVerified ? 1 : 0, split_permit: p.splitPermit,
    urban_renewal: p.urbanRenewal, renewal_stage: p.renewalStage, betterment_risk: p.bettermentRisk,
    area_median_ppsm: p.areaMedianPpsm, area_median_rent: p.areaMedianRent,
    expected_monthly_rent: p.expectedMonthlyRent, comparables: JSON.stringify(p.comparables),
    market_as_of: p.marketAsOf, market_source_id: p.marketSourceId, market_status: p.marketStatus,
    market_sample_size: p.marketSampleSize, market_fetched_at: p.marketFetchedAt,
    arnona: p.arnona, vaad: p.vaad, utilities: p.utilities,
    deposit_months: p.depositMonths, min_lease_months: p.minLeaseMonths,
    pets_allowed: p.petsAllowed ? 1 : 0, fair_rent_law: p.fairRentLaw ? 1 : 0,
  };
}

function fromRow(r: Row): Property {
  return {
    id: r.id as string,
    deal: r.deal as Property['deal'],
    price: r.price as number,
    source: r.source as string,
    publishedAt: r.published_at as string,
    daysOnMarket: r.days_on_market as number,
    publisherKind: r.publisher_kind as Property['publisherKind'],
    agentFeePct: r.agent_fee_pct as number,
    priceDrop: r.price_drop as number,
    availableFrom: r.available_from as string,
    city: r.city as string,
    neighborhood: r.neighborhood as string,
    street: r.street as string,
    gush: r.gush as number,
    helka: r.helka as number,
    tatHelka: (r.tat_helka as number | null) ?? null,
    walkTransitMin: r.walk_transit_min as number,
    walkSchoolMin: r.walk_school_min as number,
    walkParkMin: r.walk_park_min as number,
    assetType: r.asset_type as Property['assetType'],
    rooms: r.rooms as number,
    sqm: r.sqm as number,
    balconySqm: r.balcony_sqm as number,
    lotSqm: (r.lot_sqm as number | null) ?? null,
    floor: r.floor as number,
    floorsInBuilding: r.floors_in_building as number,
    builtYear: r.built_year as number,
    condition: r.condition as Property['condition'],
    aspects: r.aspects as string,
    features: JSON.parse(r.features as string) as Features,
    registryKind: r.registry_kind as Property['registryKind'],
    tenure: r.tenure as Property['tenure'],
    leaseEndsAt: (r.lease_ends_at as string | null) ?? null,
    caveats: r.caveats as number,
    mortgages: r.mortgages as number,
    registryVerified: r.registry_verified === 1,
    splitPermit: (r.split_permit as Property['splitPermit']) ?? null,
    urbanRenewal: (r.urban_renewal as string | null) ?? null,
    renewalStage: (r.renewal_stage as string | null) ?? null,
    bettermentRisk: (r.betterment_risk as Property['bettermentRisk']) ?? null,
    areaMedianPpsm: r.area_median_ppsm as number,
    areaMedianRent: r.area_median_rent as number,
    expectedMonthlyRent: r.expected_monthly_rent as number,
    comparables: JSON.parse(r.comparables as string) as Comparable[],
    marketAsOf: r.market_as_of as string,
    marketSourceId: (r.market_source_id as string) ?? 'manual',
    marketStatus: (r.market_status as Property['marketStatus']) ?? 'manual',
    marketSampleSize: (r.market_sample_size as number) ?? 0,
    marketFetchedAt: (r.market_fetched_at as string | null) ?? null,
    arnona: r.arnona as number,
    vaad: r.vaad as number,
    utilities: r.utilities as number,
    depositMonths: r.deposit_months as number,
    minLeaseMonths: r.min_lease_months as number,
    petsAllowed: r.pets_allowed === 1,
    fairRentLaw: r.fair_rent_law === 1,
  };
}

export function insertMany(properties: readonly Property[]): number {
  const conn = db ?? getDb();
  const sql = `INSERT OR REPLACE INTO properties (${COLUMNS.join(', ')})
               VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')})`;
  const stmt = conn.prepare(sql);
  const tx = conn.transaction((rows: readonly Property[]) => {
    for (const p of rows) stmt.run(toRow(p));
    return rows.length;
  });
  return tx(properties);
}

export function insertProperty(p: Property): Property {
  insertMany([p]);
  return p;
}

export function listProperties(): Property[] {
  return (getDb().prepare('SELECT * FROM properties ORDER BY created_at DESC').all() as Row[]).map(fromRow);
}

export function getProperty(id: string): Property | null {
  const row = getDb().prepare('SELECT * FROM properties WHERE id = ?').get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

export function listCities(): string[] {
  return (getDb().prepare('SELECT DISTINCT city FROM properties ORDER BY city').all() as Row[]).map(
    (r) => r.city as string,
  );
}

export function countProperties(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM properties').get() as { n: number }).n;
}

/** Write back only the market layer, leaving everything a person entered untouched. */
export function updateMarketData(
  id: string,
  data: {
    areaMedianPpsm: number;
    comparables: Property['comparables'];
    marketAsOf: string;
    marketSourceId: string;
    marketStatus: Property['marketStatus'];
    marketSampleSize: number;
    marketFetchedAt: string;
  },
): Property | null {
  getDb()
    .prepare(
      `UPDATE properties SET
         area_median_ppsm = @areaMedianPpsm,
         comparables = @comparables,
         market_as_of = @marketAsOf,
         market_source_id = @marketSourceId,
         market_status = @marketStatus,
         market_sample_size = @marketSampleSize,
         market_fetched_at = @marketFetchedAt
       WHERE id = @id`,
    )
    .run({ ...data, comparables: JSON.stringify(data.comparables), id });
  return getProperty(id);
}

/* ---------- saved searches ---------- */

export function listSavedSearches(): SavedSearch[] {
  return (getDb().prepare('SELECT * FROM saved_searches ORDER BY created_at DESC').all() as Row[]).map(toSaved);
}

export function getSavedSearch(id: string): SavedSearch | null {
  const row = getDb().prepare('SELECT * FROM saved_searches WHERE id = ?').get(id) as Row | undefined;
  return row ? toSaved(row) : null;
}

function toSaved(r: Row): SavedSearch {
  return {
    id: r.id as string,
    name: r.name as string,
    query: JSON.parse(r.query as string) as SavedSearch['query'],
    profile: r.profile as SavedSearch['profile'],
    minScore: r.min_score as number,
    createdAt: r.created_at as string,
    lastRunAt: (r.last_run_at as string | null) ?? null,
  };
}

export function insertSavedSearch(
  input: Omit<SavedSearch, 'id' | 'createdAt' | 'lastRunAt'>,
): SavedSearch {
  const id = `srch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO saved_searches (id, name, query, profile, min_score, created_at, last_run_at, seen)
       VALUES (@id, @name, @query, @profile, @min_score, @created_at, NULL, NULL)`,
    )
    .run({
      id,
      name: input.name,
      query: JSON.stringify(input.query),
      profile: input.profile,
      min_score: input.minScore,
      created_at: createdAt,
    });
  return { ...input, id, createdAt, lastRunAt: null };
}

export function deleteSavedSearch(id: string): boolean {
  return getDb().prepare('DELETE FROM saved_searches WHERE id = ?').run(id).changes > 0;
}

/** Null until the search has run once, which is what makes the first run a baseline. */
export function getSeen(id: string): Record<string, SeenState> | null {
  const row = getDb().prepare('SELECT seen FROM saved_searches WHERE id = ?').get(id) as
    | { seen: string | null }
    | undefined;
  if (!row || row.seen === null) return null;
  return JSON.parse(row.seen) as Record<string, SeenState>;
}

export function saveRun(id: string, seen: Record<string, SeenState>, at: string): void {
  getDb()
    .prepare('UPDATE saved_searches SET seen = @seen, last_run_at = @at WHERE id = @id')
    .run({ id, seen: JSON.stringify(seen), at });
}
