import { pricingOption } from '@cruise/analytics';
import { makePricing, type ProviderId, type SnapshotInput } from '@cruise/domain';
import type { CollectedCruise } from './types';


/**
 * Turns a provider's collected cabins into a snapshot: derives every price (per person and total, cruise, flight and trip)
 * from the party totals, keeps the flight separate, and sets the headline to the cheapest trip.
 */
export function buildSnapshotInput(args: {
  routeId: string;
  provider: ProviderId;
  source: 'mock' | 'live';
  collectedAt: string;
  collected: CollectedCruise;
}): SnapshotInput {
  const { collected } = args;
  const n = collected.party.adults;
  if (collected.cabins.length === 0) throw new Error('No cabin prices were collected');

  const flightCode = collected.party.departureAirport;
  const collectedOptions = collected.options ?? [];
  const warnings = [...(collected.warnings ?? [])];

  // A cabin's price is its cheapest fare, so the cabin list always agrees with the fare list.
  const cabins = collected.cabins.map((c) => {
    const cheapest = Math.min(...collectedOptions.filter((o) => o.cabinCategory === c.category).map((o) => o.cruisePrice));
    if (collectedOptions.length > 0 && !Number.isFinite(cheapest)) warnings.push(`No fares collected for ${c.category}`);
    const p = makePricing({ passengers: n, cruiseTotal: Number.isFinite(cheapest) ? cheapest : c.packagePerPerson * n, flightTotal: c.flightPerPerson * n });
    return {
      category: c.category,
      packagePerPerson: p.cruisePerPerson,
      flightPerPerson: p.flightPerPerson,
      packageTotal: p.cruiseTotal,
      flightTotal: p.flightTotal,
      mandatoryFees: p.mandatoryFees,
      tripPerPerson: p.tripPerPerson,
      tripTotal: p.tripTotal,
    };
  });

  const options = collectedOptions.flatMap((o) => {
    const cabin = cabins.find((c) => c.category === o.cabinCategory);
    return cabin ? [pricingOption({ cabinCategory: o.cabinCategory, fareCode: o.fareCode, flightCode, passengers: n, cruisePrice: o.cruisePrice, flightPrice: cabin.flightTotal })] : [];
  });
  const used = new Set(options.map((o) => o.fareCode));
  const fares = (collected.fares ?? []).filter((f) => used.has(f.fareCode));

  // The headline is the cheapest TRIP (cruise + flight + fees), the number everything is ranked on.
  const cheapest = cabins.reduce((a, b) => (b.tripTotal < a.tripTotal ? b : a));

  return {
    routeId: args.routeId,
    provider: args.provider,
    source: args.source,
    collectedAt: args.collectedAt,
    currency: collected.currency,
    cruise: collected.cruise,
    party: collected.party,
    cabins,
    packagePrice: cheapest.packageTotal,
    flightSurcharge: cheapest.flightTotal,
    mandatoryFees: cheapest.mandatoryFees,
    fares,
    options,
    warnings,
  };
}
