import { z } from 'zod';
import type { Property } from '@/types/property';

const assetType = z.enum(['apartment', 'garden', 'penthouse', 'studio', 'housingUnit', 'house', 'duplex', 'lot']);
const condition = z.enum(['new', 'renovated', 'kept', 'needsWork']);

/**
 * What a person or a broker actually types in. Everything the agent derives
 * (yield, tax, delta) is computed, never accepted as input.
 */
export const propertyInputSchema = z
  .object({
    deal: z.enum(['sale', 'rent']),
    price: z.coerce.number({ error: 'מחיר הוא שדה חובה ויש להזין מספר' }).positive('מחיר חייב להיות גדול מאפס'),

    source: z.string().trim().min(1).default('קלט ישיר'),
    publishedAt: z.string().trim().default(() => new Date().toISOString().slice(0, 10)),
    daysOnMarket: z.coerce.number().int().min(0).default(0),
    publisherKind: z.enum(['agency', 'private']).default('private'),
    agentFeePct: z.coerce.number().min(0).max(10).default(0),
    priceDrop: z.coerce.number().min(0).default(0),
    availableFrom: z.string().trim().default('מיידי'),

    city: z.string({ error: 'עיר היא שדה חובה' }).trim().min(1, 'עיר היא שדה חובה'),
    neighborhood: z.string().trim().default(''),
    street: z.string().trim().default(''),
    gush: z.coerce
      .number({ error: 'גוש הוא שדה חובה ויש להזין מספר — הוא המפתח לכל מקור רשמי' })
      .int()
      .positive('גוש הוא שדה חובה — הוא המפתח לכל מקור רשמי'),
    helka: z.coerce.number({ error: 'חלקה היא שדה חובה ויש להזין מספר' }).int().positive('חלקה היא שדה חובה'),
    tatHelka: z.coerce.number().int().positive().nullable().default(null),
    walkTransitMin: z.coerce.number().int().min(0).default(0),
    walkSchoolMin: z.coerce.number().int().min(0).default(0),
    walkParkMin: z.coerce.number().int().min(0).default(0),

    assetType: assetType.catch('apartment'),
    rooms: z.coerce.number({ error: 'מספר חדרים הוא שדה חובה' }).positive('מספר חדרים חייב להיות גדול מאפס'),
    sqm: z.coerce.number({ error: 'שטח הוא שדה חובה ויש להזין מספר' }).positive('שטח חייב להיות גדול מאפס'),
    balconySqm: z.coerce.number().min(0).default(0),
    lotSqm: z.coerce.number().min(0).nullable().default(null),
    floor: z.coerce.number().int().min(-2).default(0),
    floorsInBuilding: z.coerce.number().int().min(1).default(1),
    builtYear: z.coerce
      .number({ error: 'שנת בנייה היא שדה חובה' })
      .int()
      .min(1800, 'שנת בנייה אינה סבירה')
      .max(2100, 'שנת בנייה אינה סבירה'),
    condition: condition.default('kept'),
    aspects: z.string().trim().default(''),

    elevator: z.coerce.boolean().default(false),
    parking: z.coerce.number().int().min(0).default(0),
    storage: z.coerce.boolean().default(false),
    mamad: z.coerce.boolean().default(false),
    ac: z.string().trim().default('ללא'),
    accessible: z.coerce.boolean().default(false),
    furnished: z.coerce.boolean().default(false),
    bars: z.coerce.boolean().default(false),
    separateEntrance: z.coerce.boolean().default(false),

    registryKind: z.enum(['tabu', 'rmi', 'housingCompany']).default('tabu'),
    tenure: z.enum(['ownership', 'lease']).default('ownership'),
    leaseEndsAt: z.string().trim().nullable().default(null),
    caveats: z.coerce.number().int().min(0).default(0),
    mortgages: z.coerce.number().int().min(0).default(0),
    registryVerified: z.coerce.boolean().default(false),
    splitPermit: z.enum(['granted', 'none', 'unknown']).nullable().default(null),

    urbanRenewal: z.string().trim().nullable().default(null),
    renewalStage: z.string().trim().nullable().default(null),
    bettermentRisk: z.enum(['low', 'medium', 'high']).nullable().default('low'),

    areaMedianPpsm: z.coerce.number().min(0).default(0),
    areaMedianRent: z.coerce.number().min(0).default(0),
    expectedMonthlyRent: z.coerce.number().min(0).default(0),
    marketAsOf: z.string().trim().default(() => new Date().toISOString().slice(0, 10)),

    arnona: z.coerce.number().min(0).default(0),
    vaad: z.coerce.number().min(0).default(0),
    utilities: z.coerce.number().min(0).default(0),

    depositMonths: z.coerce.number().min(0).max(3).default(2),
    minLeaseMonths: z.coerce.number().int().min(0).default(12),
    petsAllowed: z.coerce.boolean().default(false),
    fairRentLaw: z.coerce.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.assetType === 'housingUnit' && v.splitPermit === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['splitPermit'],
        message: 'ליחידת דיור חובה לציין את סטטוס היתר הפיצול. "לא ידוע" הוא תשובה תקפה.',
      });
    }
    if (v.tenure === 'lease' && !v.leaseEndsAt) {
      ctx.addIssue({ code: 'custom', path: ['leaseEndsAt'], message: 'בחכירה יש לציין מועד סיום.' });
    }
  });

export type PropertyInput = z.infer<typeof propertyInputSchema>;

/** Build the stored entity. The id encodes gush/helka so duplicates from two sources collide by design. */
export function toProperty(input: PropertyInput): Property {
  const id = `${input.gush}-${input.helka}-${input.tatHelka ?? 0}-${input.deal}`;
  return {
    id,
    deal: input.deal,
    price: input.price,
    source: input.source,
    publishedAt: input.publishedAt,
    daysOnMarket: input.daysOnMarket,
    publisherKind: input.publisherKind,
    agentFeePct: input.agentFeePct,
    priceDrop: input.priceDrop,
    availableFrom: input.availableFrom,
    city: input.city,
    neighborhood: input.neighborhood,
    street: input.street,
    gush: input.gush,
    helka: input.helka,
    tatHelka: input.tatHelka,
    walkTransitMin: input.walkTransitMin,
    walkSchoolMin: input.walkSchoolMin,
    walkParkMin: input.walkParkMin,
    assetType: input.assetType,
    rooms: input.rooms,
    sqm: input.sqm,
    balconySqm: input.balconySqm,
    lotSqm: input.lotSqm,
    floor: input.floor,
    floorsInBuilding: input.floorsInBuilding,
    builtYear: input.builtYear,
    condition: input.condition,
    aspects: input.aspects,
    features: {
      elevator: input.elevator,
      parking: input.parking,
      storage: input.storage,
      mamad: input.mamad,
      ac: input.ac,
      accessible: input.accessible,
      furnished: input.furnished,
      bars: input.bars,
      separateEntrance: input.separateEntrance,
    },
    registryKind: input.registryKind,
    tenure: input.tenure,
    leaseEndsAt: input.leaseEndsAt,
    caveats: input.caveats,
    mortgages: input.mortgages,
    registryVerified: input.registryVerified,
    splitPermit: input.splitPermit,
    urbanRenewal: input.urbanRenewal,
    renewalStage: input.renewalStage,
    bettermentRisk: input.bettermentRisk,
    areaMedianPpsm: input.areaMedianPpsm,
    areaMedianRent: input.areaMedianRent,
    expectedMonthlyRent: input.expectedMonthlyRent,
    comparables: [],
    marketAsOf: input.marketAsOf,
    // Provenance is set by the enrichment pipeline, never by whoever fills the form.
    marketSourceId: 'manual',
    marketStatus: 'manual',
    marketSampleSize: 0,
    marketFetchedAt: null,
    arnona: input.arnona,
    vaad: input.vaad,
    utilities: input.utilities,
    depositMonths: input.depositMonths,
    minLeaseMonths: input.minLeaseMonths,
    petsAllowed: input.petsAllowed,
    fairRentLaw: input.fairRentLaw,
  };
}
