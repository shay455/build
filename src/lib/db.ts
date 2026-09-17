import 'server-only';
import { createClient, type Client, type InArgs, type Row } from '@libsql/client';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Comparable, Features, Property } from '@/types/property';
import type { SavedSearch, SeenState } from './alerts';
import { SEED_PROPERTIES } from './seed-data';

/**
 * One driver for both worlds.
 *
 * libSQL speaks SQLite, so a local `file:` URL and a hosted `libsql://` URL run the
 * same statements over the same client. That is deliberate: a serverless deployment
 * has no writable disk, and a separate local driver would mean the code path that
 * ships is not the one that was tested.
 *
 *   DATABASE_URL         libsql://<db>.turso.io  (hosted) | file:./data/app.db (default)
 *   DATABASE_AUTH_TOKEN  required by a hosted URL
 */
function databaseUrl(): string {
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) return configured;

  // Fail loudly rather than falling back to a file that the platform will discard
  // between invocations, which would look like data silently disappearing.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error(
      'DATABASE_URL is not set. A serverless deployment has no writable disk, so the local ' +
        'file database cannot be used. Set DATABASE_URL to a libsql:// URL and DATABASE_AUTH_TOKEN ' +
        'to its token — see the deployment section of the README.',
    );
  }

  const path = resolve(process.cwd(), 'data', 'app.db');
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return `file:${path}`;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS properties (
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
    market_source_id TEXT NOT NULL DEFAULT 'manual',
    market_status TEXT NOT NULL DEFAULT 'manual',
    market_sample_size INTEGER NOT NULL DEFAULT 0,
    market_fetched_at TEXT,
    arnona INTEGER NOT NULL DEFAULT 0,
    vaad INTEGER NOT NULL DEFAULT 0,
    utilities INTEGER NOT NULL DEFAULT 0,
    deposit_months INTEGER NOT NULL DEFAULT 0,
    min_lease_months INTEGER NOT NULL DEFAULT 12,
    pets_allowed INTEGER NOT NULL DEFAULT 0,
    fair_rent_law INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_properties_deal_city ON properties (deal, city)`,
  `CREATE INDEX IF NOT EXISTS idx_properties_gush_helka ON properties (gush, helka)`,
  `CREATE TABLE IF NOT EXISTS saved_searches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    profile TEXT NOT NULL,
    min_score INTEGER NOT NULL DEFAULT 60,
    created_at TEXT NOT NULL,
    last_run_at TEXT,
    -- NULL means "never run". Distinct from '{}', which means "ran, matched nothing".
    seen TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS source_cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
];

/**
 * Additive column migrations, for a database created by an earlier version.
 * SQLite has no "ADD COLUMN IF NOT EXISTS", so each is applied only when absent.
 */
const COLUMN_MIGRATIONS: Array<[column: string, ddl: string]> = [
  ['market_source_id', "ALTER TABLE properties ADD COLUMN market_source_id TEXT NOT NULL DEFAULT 'manual'"],
  ['market_status', "ALTER TABLE properties ADD COLUMN market_status TEXT NOT NULL DEFAULT 'manual'"],
  ['market_sample_size', 'ALTER TABLE properties ADD COLUMN market_sample_size INTEGER NOT NULL DEFAULT 0'],
  ['market_fetched_at', 'ALTER TABLE properties ADD COLUMN market_fetched_at TEXT'],
];

let ready: Promise<Client> | null = null;

/** Opens the database, applies the schema and seeds an empty one. Idempotent. */
export function getDb(): Promise<Client> {
  ready ??= (async () => {
    const client = createClient({
      url: databaseUrl(),
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });

    for (const statement of SCHEMA) await client.execute(statement);

    const columns = await client.execute('PRAGMA table_info(properties)');
    const present = new Set(columns.rows.map((r) => String(r.name)));
    for (const [column, ddl] of COLUMN_MIGRATIONS) {
      if (!present.has(column)) await client.execute(ddl);
    }

    const { rows } = await client.execute('SELECT COUNT(*) AS n FROM properties');
    if (Number(rows[0].n) === 0) await insertManyWith(client, SEED_PROPERTIES);

    return client;
  })();
  return ready;
}

/** Test seam: drop the cached connection so the next call reopens it. */
export function resetDbForTesting(): void {
  ready = null;
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

function toArgs(p: Property): InArgs {
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

const str = (v: unknown): string => String(v ?? '');
const optStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const int = (v: unknown): number => Number(v ?? 0);
const optInt = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function fromRow(r: Row): Property {
  return {
    id: str(r.id),
    deal: str(r.deal) as Property['deal'],
    price: int(r.price),
    source: str(r.source),
    publishedAt: str(r.published_at),
    daysOnMarket: int(r.days_on_market),
    publisherKind: str(r.publisher_kind) as Property['publisherKind'],
    agentFeePct: int(r.agent_fee_pct),
    priceDrop: int(r.price_drop),
    availableFrom: str(r.available_from),
    city: str(r.city),
    neighborhood: str(r.neighborhood),
    street: str(r.street),
    gush: int(r.gush),
    helka: int(r.helka),
    tatHelka: optInt(r.tat_helka),
    walkTransitMin: int(r.walk_transit_min),
    walkSchoolMin: int(r.walk_school_min),
    walkParkMin: int(r.walk_park_min),
    assetType: str(r.asset_type) as Property['assetType'],
    rooms: int(r.rooms),
    sqm: int(r.sqm),
    balconySqm: int(r.balcony_sqm),
    lotSqm: optInt(r.lot_sqm),
    floor: int(r.floor),
    floorsInBuilding: int(r.floors_in_building),
    builtYear: int(r.built_year),
    condition: str(r.condition) as Property['condition'],
    aspects: str(r.aspects),
    features: JSON.parse(str(r.features)) as Features,
    registryKind: str(r.registry_kind) as Property['registryKind'],
    tenure: str(r.tenure) as Property['tenure'],
    leaseEndsAt: optStr(r.lease_ends_at),
    caveats: int(r.caveats),
    mortgages: int(r.mortgages),
    registryVerified: int(r.registry_verified) === 1,
    splitPermit: (optStr(r.split_permit) as Property['splitPermit']) ?? null,
    urbanRenewal: optStr(r.urban_renewal),
    renewalStage: optStr(r.renewal_stage),
    bettermentRisk: (optStr(r.betterment_risk) as Property['bettermentRisk']) ?? null,
    areaMedianPpsm: int(r.area_median_ppsm),
    areaMedianRent: int(r.area_median_rent),
    expectedMonthlyRent: int(r.expected_monthly_rent),
    comparables: JSON.parse(str(r.comparables)) as Comparable[],
    marketAsOf: str(r.market_as_of),
    marketSourceId: str(r.market_source_id) || 'manual',
    marketStatus: (str(r.market_status) || 'manual') as Property['marketStatus'],
    marketSampleSize: int(r.market_sample_size),
    marketFetchedAt: optStr(r.market_fetched_at),
    arnona: int(r.arnona),
    vaad: int(r.vaad),
    utilities: int(r.utilities),
    depositMonths: int(r.deposit_months),
    minLeaseMonths: int(r.min_lease_months),
    petsAllowed: int(r.pets_allowed) === 1,
    fairRentLaw: int(r.fair_rent_law) === 1,
  };
}

const INSERT_SQL = `INSERT OR REPLACE INTO properties (${COLUMNS.join(', ')})
                    VALUES (${COLUMNS.map((c) => `:${c}`).join(', ')})`;

/** Takes the client explicitly so seeding can run inside getDb's own initialisation. */
async function insertManyWith(client: Client, properties: readonly Property[]): Promise<number> {
  if (properties.length === 0) return 0;
  await client.batch(
    properties.map((p) => ({ sql: INSERT_SQL, args: toArgs(p) })),
    'write',
  );
  return properties.length;
}

export async function insertMany(properties: readonly Property[]): Promise<number> {
  return insertManyWith(await getDb(), properties);
}

export async function insertProperty(p: Property): Promise<Property> {
  await insertMany([p]);
  return p;
}

export async function listProperties(): Promise<Property[]> {
  const { rows } = await (await getDb()).execute('SELECT * FROM properties ORDER BY created_at DESC');
  return rows.map(fromRow);
}

export async function getProperty(id: string): Promise<Property | null> {
  const { rows } = await (await getDb()).execute({ sql: 'SELECT * FROM properties WHERE id = ?', args: [id] });
  return rows.length > 0 ? fromRow(rows[0]) : null;
}

export async function listCities(): Promise<string[]> {
  const { rows } = await (await getDb()).execute('SELECT DISTINCT city FROM properties ORDER BY city');
  return rows.map((r) => str(r.city));
}

export async function countProperties(): Promise<number> {
  const { rows } = await (await getDb()).execute('SELECT COUNT(*) AS n FROM properties');
  return Number(rows[0].n);
}

/** Write back only the market layer, leaving everything a person entered untouched. */
export async function updateMarketData(
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
): Promise<Property | null> {
  await (await getDb()).execute({
    sql: `UPDATE properties SET
            area_median_ppsm = :areaMedianPpsm,
            comparables = :comparables,
            market_as_of = :marketAsOf,
            market_source_id = :marketSourceId,
            market_status = :marketStatus,
            market_sample_size = :marketSampleSize,
            market_fetched_at = :marketFetchedAt
          WHERE id = :id`,
    args: { ...data, comparables: JSON.stringify(data.comparables), id },
  });
  return getProperty(id);
}

/* ---------- source cache ---------- */

export async function readCache(key: string): Promise<{ payload: string; expiresAt: string } | null> {
  const { rows } = await (await getDb()).execute({
    sql: 'SELECT payload, expires_at FROM source_cache WHERE key = ?',
    args: [key],
  });
  return rows.length > 0 ? { payload: str(rows[0].payload), expiresAt: str(rows[0].expires_at) } : null;
}

export async function writeCache(key: string, payload: string, fetchedAt: string, expiresAt: string): Promise<void> {
  await (await getDb()).execute({
    sql: `INSERT INTO source_cache (key, payload, fetched_at, expires_at)
          VALUES (:key, :payload, :fetched_at, :expires_at)
          ON CONFLICT(key) DO UPDATE SET payload = :payload, fetched_at = :fetched_at, expires_at = :expires_at`,
    args: { key, payload, fetched_at: fetchedAt, expires_at: expiresAt },
  });
}

/* ---------- saved searches ---------- */

function toSaved(r: Row): SavedSearch {
  return {
    id: str(r.id),
    name: str(r.name),
    query: JSON.parse(str(r.query)) as SavedSearch['query'],
    profile: str(r.profile) as SavedSearch['profile'],
    minScore: int(r.min_score),
    createdAt: str(r.created_at),
    lastRunAt: optStr(r.last_run_at),
  };
}

export async function listSavedSearches(): Promise<SavedSearch[]> {
  const { rows } = await (await getDb()).execute('SELECT * FROM saved_searches ORDER BY created_at DESC');
  return rows.map(toSaved);
}

export async function getSavedSearch(id: string): Promise<SavedSearch | null> {
  const { rows } = await (await getDb()).execute({ sql: 'SELECT * FROM saved_searches WHERE id = ?', args: [id] });
  return rows.length > 0 ? toSaved(rows[0]) : null;
}

export async function insertSavedSearch(
  input: Omit<SavedSearch, 'id' | 'createdAt' | 'lastRunAt'>,
): Promise<SavedSearch> {
  const id = `srch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = new Date().toISOString();
  await (await getDb()).execute({
    sql: `INSERT INTO saved_searches (id, name, query, profile, min_score, created_at, last_run_at, seen)
          VALUES (:id, :name, :query, :profile, :min_score, :created_at, NULL, NULL)`,
    args: {
      id,
      name: input.name,
      query: JSON.stringify(input.query),
      profile: input.profile,
      min_score: input.minScore,
      created_at: createdAt,
    },
  });
  return { ...input, id, createdAt, lastRunAt: null };
}

export async function deleteSavedSearch(id: string): Promise<boolean> {
  const result = await (await getDb()).execute({ sql: 'DELETE FROM saved_searches WHERE id = ?', args: [id] });
  return result.rowsAffected > 0;
}

/** Null until the search has run once, which is what makes the first run a baseline. */
export async function getSeen(id: string): Promise<Record<string, SeenState> | null> {
  const { rows } = await (await getDb()).execute({ sql: 'SELECT seen FROM saved_searches WHERE id = ?', args: [id] });
  if (rows.length === 0 || rows[0].seen === null) return null;
  return JSON.parse(str(rows[0].seen)) as Record<string, SeenState>;
}

export async function saveRun(id: string, seen: Record<string, SeenState>, at: string): Promise<void> {
  await (await getDb()).execute({
    sql: 'UPDATE saved_searches SET seen = :seen, last_run_at = :at WHERE id = :id',
    args: { id, seen: JSON.stringify(seen), at },
  });
}
