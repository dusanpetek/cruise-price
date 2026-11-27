import { z } from 'zod';
import { PROVIDER_IDS } from './Provider';

/** "PREMIUM ALL IN" -> "PREMIUM_ALL_IN" */
export const fareCodeOf = (name: string): string =>
  name
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/**
 * A fare (tariff) as the provider sells it. What it includes is only what the site states:
 *  - `includedServices` / `excludedServices` list what the site shows with a tick / a cross;
 *  - a service that is in neither list is unknown, never assumed to be excluded;
 *  - `refundable` and `selectableCabin` are null unless the site says so.
 */
export const FareOptionSchema = z.object({
  fareCode: z.string().min(1),
  fareName: z.string().min(1),
  provider: z.enum(PROVIDER_IDS),
  includedServices: z.array(z.string()),
  excludedServices: z.array(z.string()),
  refundable: z.boolean().nullable(),
  /** Whether a specific cabin can be chosen (not just the category). */
  selectableCabin: z.boolean().nullable(),
});
export type FareOption = z.infer<typeof FareOptionSchema>;

/**
 * One bookable combination: cabin + fare + flight, for the whole party. Cruise, flight and trip price always go together.
 * Names: cruisePrice = cruise total, flightPrice = flight total, totalPrice = trip total (the number everything is based on).
 */
const pricingOptionShape = z.object({
  cabinCategory: z.string().min(1),
  /** Sub-category within the cabin category; null when the provider does not distinguish one. */
  subcategory: z.string().min(1).nullable().default(null),
  fareCode: z.string().min(1),
  /** Departure airport the flight price is for; null = no flight. */
  flightCode: z.string().nullable(),
  cruisePerPerson: z.number().nonnegative(),
  cruisePrice: z.number().nonnegative(),
  flightPerPerson: z.number().nonnegative(),
  flightPrice: z.number().nonnegative(),
  mandatoryFees: z.number().nonnegative(),
    tripPerPerson: z.number().nonnegative(),
    totalPrice: z.number().nonnegative(),
  });

export const PricingOptionSchema = pricingOptionShape
  .refine((o) => Math.abs(o.cruisePrice + o.flightPrice + o.mandatoryFees - o.totalPrice) < 0.011, {
    message: 'totalPrice must equal cruisePrice + flightPrice + mandatoryFees',
    path: ['totalPrice'],
  });
export type PricingOption = z.infer<typeof PricingOptionSchema>;

/** What a caller may leave out: everything that can be derived from the party totals. */
export const PricingOptionInputSchema = pricingOptionShape.partial({ cruisePerPerson: true, flightPerPerson: true, mandatoryFees: true, tripPerPerson: true });
