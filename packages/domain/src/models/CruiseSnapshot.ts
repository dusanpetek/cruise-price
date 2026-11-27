import { z } from 'zod';
import { FareOptionSchema, PricingOptionInputSchema, PricingOptionSchema } from './Fare';
import { PricingSnapshotSchema, makePricing, round2, type PricingSnapshot } from './Pricing';
import { PROVIDER_IDS } from './Provider';

export const SNAPSHOT_SOURCES = ['mock', 'manual', 'live'] as const;
export const SNAPSHOT_SCHEMA_VERSION = 5;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/**
 * Prices for one cabin category (at its cheapest fare). "Total" values are for the whole party; the flight is kept separate.
 * package* is the cruise price; trip* adds the flight and any mandatory fees.
 */
export const CabinPriceSchema = z.object({
  category: z.string().min(1),
  /** Sub-category within the category (e.g. a cabin variant); null when the provider does not distinguish one. */
  subcategory: z.string().min(1).nullable().default(null),
  packagePerPerson: z.number().nonnegative(),
  flightPerPerson: z.number().nonnegative(),
  packageTotal: z.number().nonnegative(),
  flightTotal: z.number().nonnegative(),
  mandatoryFees: z.number().nonnegative(),
  tripPerPerson: z.number().nonnegative(),
  tripTotal: z.number().nonnegative(),
});
export type CabinPrice = z.infer<typeof CabinPriceSchema>;

export const CruiseInfoSchema = z.object({
  name: z.string().nullable(),
  ship: z.string().nullable(),
  departure: isoDate.nullable(),
  durationNights: z.number().int().positive().nullable(),
});
export type CruiseInfo = z.infer<typeof CruiseInfoSchema>;

export const PartySchema = z.object({
  adults: z.number().int().min(1),
  departureAirport: z.string().nullable(),
});
export type Party = z.infer<typeof PartySchema>;

const EMPTY_CRUISE: CruiseInfo = { name: null, ship: null, departure: null, durationNights: null };
const DEFAULT_PARTY: Party = { adults: 2, departureAirport: null };

/**
 * An immutable price observation. `pricing` is the headline (the cabin with the lowest TRIP total, whole party);
 * `packagePrice` / `flightSurcharge` repeat its cruise and flight totals for older readers and must agree with it.
 * `cabins` holds every category at its cheapest fare; `fares` and `options` hold every cabin x fare x flight combination (v3+).
 */
export const CruiseSnapshotSchema = z.object({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  id: z.string().min(1),
  routeId: z.string().min(1),
  provider: z.enum(PROVIDER_IDS).nullable(),
  collectedAt: z.string().datetime(),
  source: z.enum(SNAPSHOT_SOURCES),
  currency: z.string().length(3),
  cruise: CruiseInfoSchema,
  party: PartySchema,
  cabins: z.array(CabinPriceSchema),
  packagePrice: z.number().nonnegative(),
  flightSurcharge: z.number().nonnegative(),
  pricing: PricingSnapshotSchema,
  fares: z.array(FareOptionSchema),
  options: z.array(PricingOptionSchema),
  /** Things that were not collected (e.g. fares of one cabin were unavailable), so gaps are visible. */
  warnings: z.array(z.string()),
  /** sha256 over the rest of the document; added by the storage layer, absent on legacy files. */
  checksum: z.string().optional(),
}).refine((s) => s.packagePrice === s.pricing.cruiseTotal && s.flightSurcharge === s.pricing.flightTotal, {
  message: 'packagePrice and flightSurcharge must equal pricing.cruiseTotal and pricing.flightTotal',
  path: ['pricing'],
});
export type CruiseSnapshot = z.infer<typeof CruiseSnapshotSchema>;

const CabinInputSchema = CabinPriceSchema.partial({ mandatoryFees: true, tripPerPerson: true, tripTotal: true });

/**
 * What a caller supplies; id, schema version and (usually) timestamp are assigned on write. Everything derivable from the
 * party totals (per-person prices, trip prices, the headline `pricing`) may be left out and is filled in consistently.
 */
export const SnapshotInputSchema = z
  .object({
    routeId: z.string().min(1),
    source: z.enum(SNAPSHOT_SOURCES),
    provider: z.enum(PROVIDER_IDS).nullable().default(null),
    collectedAt: z.string().datetime().optional(),
    currency: z.string().length(3).default('EUR'),
    cruise: CruiseInfoSchema.default(EMPTY_CRUISE),
    party: PartySchema.default(DEFAULT_PARTY),
    cabins: z.array(CabinInputSchema).default([]),
    packagePrice: z.number().nonnegative(),
    flightSurcharge: z.number().nonnegative().default(0),
    mandatoryFees: z.number().nonnegative().default(0),
    fares: z.array(FareOptionSchema).default([]),
    options: z.array(PricingOptionInputSchema).default([]),
    warnings: z.array(z.string()).default([]),
  })
  .transform((i) => {
    const n = i.party.adults;
    const cabins = i.cabins.map((c) => {
      const p = makePricing({ passengers: n, cruiseTotal: c.packageTotal, flightTotal: c.flightTotal, mandatoryFees: c.mandatoryFees });
      return { ...c, mandatoryFees: p.mandatoryFees, tripPerPerson: p.tripPerPerson, tripTotal: p.tripTotal };
    });
    const options = i.options.map((o) => {
      const p = makePricing({ passengers: n, cruiseTotal: o.cruisePrice, flightTotal: o.flightPrice, mandatoryFees: o.mandatoryFees });
      return { ...o, cruisePerPerson: p.cruisePerPerson, flightPerPerson: p.flightPerPerson, mandatoryFees: p.mandatoryFees, tripPerPerson: p.tripPerPerson, totalPrice: p.tripTotal };
    });
    const { mandatoryFees, ...rest } = i;
    return { ...rest, cabins, options, pricing: makePricing({ passengers: n, cruiseTotal: i.packagePrice, flightTotal: i.flightSurcharge, mandatoryFees }) };
  });
export type SnapshotInput = z.input<typeof SnapshotInputSchema>;

/**
 * Upgrades a stored document to the current schema, one version at a time. Files on disk are never rewritten;
 * this runs on read.
 *  - v1 (MVP) had no `schemaVersion` and only the headline prices;
 *  - v2 added provider, cruise info, party and cabins, but no fares: they upgrade to "fare unknown" (no fares, no options);
 *  - v3 added fares and options; v4 adds per-person and trip prices everywhere. They are derived from the stored totals
 *    (exact, since totals are per person x passengers), with no mandatory fees (none were ever stored);
 *  - v5 adds the optional `subcategory` to cabins and options: older documents upgrade to null.
 */
export function migrateSnapshot(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  let doc = raw as Record<string, unknown>;
  if (!('schemaVersion' in doc)) {
    doc = { provider: null, currency: 'EUR', cruise: EMPTY_CRUISE, party: DEFAULT_PARTY, cabins: [], flightSurcharge: 0, ...doc, schemaVersion: 2 };
  }
  if (doc.schemaVersion === 2) doc = { ...doc, fares: [], options: [], warnings: [], schemaVersion: 3 };
  if (doc.schemaVersion === 3) doc = withTripPrices(doc);
  if (doc.schemaVersion === 4) doc = withSubcategories(doc);
  return doc;
}

function withTripPrices(doc: Record<string, unknown>): Record<string, unknown> {
  const n = (doc.party as { adults?: number } | undefined)?.adults || 2;
  const cabins = ((doc.cabins as Record<string, number>[] | undefined) ?? []).map((c) => {
    const p = makePricing({ passengers: n, cruiseTotal: c.packageTotal, flightTotal: c.flightTotal });
    return { ...c, mandatoryFees: 0, tripPerPerson: p.tripPerPerson, tripTotal: p.tripTotal };
  });
  const options = ((doc.options as Record<string, unknown>[] | undefined) ?? []).map((o) => {
    const p = makePricing({ passengers: n, cruiseTotal: o.cruisePrice as number, flightTotal: o.flightPrice as number });
    return { ...o, cruisePerPerson: p.cruisePerPerson, flightPerPerson: p.flightPerPerson, mandatoryFees: 0, tripPerPerson: p.tripPerPerson };
  });
  const pricing = makePricing({ passengers: n, cruiseTotal: (doc.packagePrice as number) ?? 0, flightTotal: (doc.flightSurcharge as number) ?? 0 });
  return { ...doc, cabins, options, pricing, schemaVersion: 4 };
}

function withSubcategories(doc: Record<string, unknown>): Record<string, unknown> {
  const cabins = ((doc.cabins as Record<string, unknown>[] | undefined) ?? []).map((c) => ({ ...c, subcategory: null }));
  const options = ((doc.options as Record<string, unknown>[] | undefined) ?? []).map((o) => ({ ...o, subcategory: null }));
  return { ...doc, cabins, options, schemaVersion: 5 };
}

export function parseSnapshot(raw: unknown): CruiseSnapshot {
  return CruiseSnapshotSchema.parse(migrateSnapshot(raw));
}
