/** Deal type. Rent prices are monthly; sale prices are absolute. */
/**
 * How much weight a market figure can carry.
 * - `ok`          enough comparables to quote a percentage
 * - `thin`        a real sample, but too small to quote precisely
 * - `unavailable` the source could not be reached or knows nothing about this parcel
 * - `manual`      a person typed it in
 */
export type MarketStatus = 'ok' | 'thin' | 'unavailable' | 'manual';

export type Deal = 'sale' | 'rent';

export type AssetType =
  | 'apartment'
  | 'garden'
  | 'penthouse'
  | 'studio'
  | 'housingUnit'
  | 'house'
  | 'duplex'
  | 'lot';

export type Condition = 'new' | 'renovated' | 'kept' | 'needsWork';

/** Registry system the rights actually sit in. Not every Israeli property is in the Tabu. */
export type RegistryKind = 'tabu' | 'rmi' | 'housingCompany';

/**
 * Buyer profile drives purchase tax and the Bank of Israel LTV cap.
 * `upgrade` is taxed on the single-home ladder, conditional on selling within the
 * statutory window — the most common mistake in the market.
 */
export type BuyerProfile = 'single' | 'upgrade' | 'additional' | 'oleh' | 'reg11';

export interface Features {
  elevator: boolean;
  parking: number;
  storage: boolean;
  mamad: boolean;
  ac: string;
  accessible: boolean;
  furnished: boolean;
  bars: boolean;
  separateEntrance: boolean;
}

export interface Property {
  id: string;
  deal: Deal;
  /** Sale price, or monthly rent for `deal === 'rent'`. */
  price: number;

  source: string;
  publishedAt: string;
  daysOnMarket: number;
  publisherKind: 'agency' | 'private';
  agentFeePct: number;
  priceDrop: number;
  availableFrom: string;

  city: string;
  neighborhood: string;
  street: string;
  /** Block and parcel — the primary key against every official Israeli source. */
  gush: number;
  helka: number;
  tatHelka: number | null;
  walkTransitMin: number;
  walkSchoolMin: number;
  walkParkMin: number;

  assetType: AssetType;
  rooms: number;
  sqm: number;
  balconySqm: number;
  lotSqm: number | null;
  floor: number;
  floorsInBuilding: number;
  builtYear: number;
  condition: Condition;
  aspects: string;
  features: Features;

  registryKind: RegistryKind;
  tenure: 'ownership' | 'lease';
  leaseEndsAt: string | null;
  caveats: number;
  mortgages: number;
  /** `false` means "we have not checked", which must read differently from "checked, nothing found". */
  registryVerified: boolean;
  /** Only meaningful for housing units. `unknown` is the honest default. */
  splitPermit: 'granted' | 'none' | 'unknown' | null;

  urbanRenewal: string | null;
  renewalStage: string | null;
  bettermentRisk: 'low' | 'medium' | 'high' | null;

  areaMedianPpsm: number;
  areaMedianRent: number;
  expectedMonthlyRent: number;
  comparables: Comparable[];
  marketAsOf: string;
  /** Which adapter produced the market figures — `manual` means a person typed them. */
  marketSourceId: string;
  /** How much weight those figures can carry. A thin sample must not be quoted as a percentage. */
  marketStatus: MarketStatus;
  /** How many comparable transactions stand behind the median. */
  marketSampleSize: number;
  /** When the figures were last pulled. Null when they were never enriched. */
  marketFetchedAt: string | null;

  arnona: number;
  vaad: number;
  utilities: number;

  depositMonths: number;
  minLeaseMonths: number;
  petsAllowed: boolean;
  fairRentLaw: boolean;
}

export interface Comparable {
  date: string;
  sqm: number;
  price: number;
}

export interface Flag {
  level: 'crit' | 'warn' | 'ok';
  text: string;
}
