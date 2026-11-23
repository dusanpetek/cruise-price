import { z } from 'zod';

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Every price of a trip, stored together: per person and for the whole party, for the cruise, the flight and the trip.
 * `tripTotal` is the number everything is ranked, forecast, alerted and scored on.
 *   cruiseTotal = cruisePerPerson x passengers, flightTotal = flightPerPerson x passengers,
 *   tripTotal   = cruiseTotal + flightTotal + mandatoryFees, tripPerPerson = tripTotal / passengers.
 */
export const PricingSnapshotSchema = z
  .object({
    cruisePerPerson: z.number().nonnegative(),
    cruiseTotal: z.number().nonnegative(),
    flightPerPerson: z.number().nonnegative(),
    flightTotal: z.number().nonnegative(),
    /** Fees the provider charges separately and unavoidably. None are shown separately by the sites collected so far, so 0. */
    mandatoryFees: z.number().nonnegative(),
    tripPerPerson: z.number().nonnegative(),
    tripTotal: z.number().nonnegative(),
  })
  .refine((p) => Math.abs(p.cruiseTotal + p.flightTotal + p.mandatoryFees - p.tripTotal) < 0.011, {
    message: 'tripTotal must equal cruiseTotal + flightTotal + mandatoryFees',
    path: ['tripTotal'],
  });
export type PricingSnapshot = z.infer<typeof PricingSnapshotSchema>;

/**
 * Builds the full pricing block. Give the party totals (what AIDA shows) or the per-person prices (what Mein Schiff shows);
 * everything else is derived, so the stored numbers always agree.
 */
export function makePricing(args: {
  passengers: number;
  cruiseTotal?: number;
  cruisePerPerson?: number;
  flightTotal?: number;
  flightPerPerson?: number;
  mandatoryFees?: number;
}): PricingSnapshot {
  const n = args.passengers;
  const cruiseTotal = round2(args.cruiseTotal ?? (args.cruisePerPerson ?? 0) * n);
  const flightTotal = round2(args.flightTotal ?? (args.flightPerPerson ?? 0) * n);
  const mandatoryFees = round2(args.mandatoryFees ?? 0);
  const tripTotal = round2(cruiseTotal + flightTotal + mandatoryFees);
  return {
    cruisePerPerson: round2(cruiseTotal / n),
    cruiseTotal,
    flightPerPerson: round2(flightTotal / n),
    flightTotal,
    mandatoryFees,
    tripPerPerson: round2(tripTotal / n),
    tripTotal,
  };
}
