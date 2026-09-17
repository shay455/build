import type { BuyerProfile, MarketStatus, Property } from '@/types/property';
import { purchaseTax, type TaxResult } from './tax';

/** Bank of Israel loan-to-value caps. */
export const LTV_CAP: Record<BuyerProfile, number> = {
  single: 0.75,
  upgrade: 0.7,
  additional: 0.5,
  oleh: 0.75,
  reg11: 0.75,
};

export interface MortgageAssumptions {
  annualRate: number;
  years: number;
}

export const DEFAULT_MORTGAGE: MortgageAssumptions = { annualRate: 0.049, years: 25 };

/** Net-yield assumptions. Each is a dial, not a constant of nature. */
export const YIELD_ASSUMPTIONS = {
  vacancyRate: 0.04,
  upkeepRate: 0.05,
  annualInsurance: 1250,
} as const;

/** Level-payment (Spitzer) monthly instalment. */
export function monthlyPayment(principal: number, a: MortgageAssumptions = DEFAULT_MORTGAGE): number {
  if (principal <= 0) return 0;
  const r = a.annualRate / 12;
  const n = a.years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export interface ClosingCosts {
  lawyer: number;
  agent: number;
  appraiser: number;
  misc: number;
  total: number;
}

export function closingCosts(p: Property): ClosingCosts {
  const lawyer = Math.max(6000, p.price * 0.005);
  // Agent fee is quoted before VAT; the buyer pays it with VAT.
  const agent = p.publisherKind === 'agency' ? p.price * (p.agentFeePct / 100) * 1.17 : 0;
  const appraiser = 2400;
  const misc = 1800;
  return { lawyer, agent, appraiser, misc, total: lawyer + agent + appraiser + misc };
}

export interface Economics {
  ppsm: number | null;
  /**
   * Price per sqm against the area median, as a signed fraction.
   * Null whenever the market data cannot carry a percentage — see `comparableBasis`.
   */
  deltaVsArea: number | null;
  /** Why `deltaVsArea` is or is not a number. Drives what the card shows in its place. */
  comparableBasis: MarketStatus;
  monthlyAllIn: number;

  tax?: TaxResult;
  closing?: ClosingCosts;
  acquisitionTotal?: number;
  ltv?: number;
  loan?: number;
  equityRequired?: number;
  monthlyMortgage?: number;
  grossYield?: number;
  netYield?: number;
  monthlyCashflow?: number;

  deposit?: number;
}

/**
 * All per-user money. Deliberately never persisted: it depends on the buyer profile
 * and on tax brackets that change by legislation.
 */
export function economics(
  p: Property,
  profile: BuyerProfile,
  mortgage: MortgageAssumptions = DEFAULT_MORTGAGE,
): Economics {
  if (p.deal === 'rent') {
    const benchmark = p.areaMedianRent;
    return {
      ppsm: null,
      deltaVsArea: benchmark > 0 ? (p.price - benchmark) / benchmark : null,
      comparableBasis: benchmark > 0 ? p.marketStatus : 'unavailable',
      monthlyAllIn: p.price + p.arnona + p.vaad + p.utilities,
      deposit: p.price * p.depositMonths,
    };
  }

  const ppsm = p.sqm > 0 ? p.price / p.sqm : null;
  // A thin or missing sample yields no percentage at all. Quoting "12% below the
  // median" off two transactions is the failure mode this guard exists to prevent.
  const quotable = p.marketStatus === 'ok' || p.marketStatus === 'manual';
  const hasBasis = ppsm !== null && p.areaMedianPpsm > 0;
  const comparableBasis: MarketStatus = !hasBasis ? 'unavailable' : p.marketStatus;
  const deltaVsArea = hasBasis && quotable ? (ppsm - p.areaMedianPpsm) / p.areaMedianPpsm : null;

  const tax = purchaseTax(p.price, profile);
  const closing = closingCosts(p);
  const acquisitionTotal = p.price + tax.amount + closing.total;
  const ltv = LTV_CAP[profile];
  const loan = p.price * ltv;
  const equityRequired = acquisitionTotal - loan;
  const mortgagePayment = monthlyPayment(loan, mortgage);

  const annualRent = p.expectedMonthlyRent * 12;
  const grossYield = p.price > 0 ? annualRent / p.price : 0;
  const netOperatingIncome =
    annualRent * (1 - YIELD_ASSUMPTIONS.vacancyRate - YIELD_ASSUMPTIONS.upkeepRate) -
    YIELD_ASSUMPTIONS.annualInsurance -
    p.vaad * 12;
  // Denominator is total acquisition cost, not the headline price.
  const netYield = acquisitionTotal > 0 ? netOperatingIncome / acquisitionTotal : 0;

  const monthlyAllIn = mortgagePayment + p.arnona + p.vaad;

  return {
    ppsm,
    deltaVsArea,
    comparableBasis,
    monthlyAllIn,
    tax,
    closing,
    acquisitionTotal,
    ltv,
    loan,
    equityRequired,
    monthlyMortgage: mortgagePayment,
    grossYield,
    netYield,
    monthlyCashflow: p.expectedMonthlyRent - monthlyAllIn,
  };
}
