import { makePricing, type AlertRule, type CruiseSnapshot } from '@cruise/domain';

/** Test helpers (not exported from the package index). */
export const DAY = 86_400_000;
export const BASE = Date.UTC(2026, 0, 1);
export const at = (day: number) => new Date(BASE + day * DAY).toISOString();

/** A cabin at `perPerson` cruise price and `flightPerPerson` flight price for 2 adults (all derived prices included). */
export function cabin(category: string, perPerson: number, flightPerPerson = 100) {
  const p = makePricing({ passengers: 2, cruisePerPerson: perPerson, flightPerPerson });
  return { category, packagePerPerson: perPerson, flightPerPerson, packageTotal: p.cruiseTotal, flightTotal: p.flightTotal, mandatoryFees: 0, tripPerPerson: p.tripPerPerson, tripTotal: p.tripTotal };
}

/** A v4 snapshot on `day`; the headline is the cabin with the lowest trip total. Pass `departure` for booking-window tests. */
export function snapshot(day: number, cabins: ReturnType<typeof cabin>[], departure: string | null = null): CruiseSnapshot {
  const cheapest = cabins.length ? cabins.reduce((a, b) => (b.tripTotal < a.tripTotal ? b : a)) : { packageTotal: 0, flightTotal: 0 };
  return {
    schemaVersion: 4,
    id: `s${day}`,
    routeId: 'r1',
    provider: 'aida',
    collectedAt: at(day),
    source: 'live',
    currency: 'EUR',
    cruise: { name: 'Cruise', ship: 'Ship', departure, durationNights: 7 },
    party: { adults: 2, departureAirport: 'FRA' },
    cabins,
    packagePrice: cheapest.packageTotal,
    flightSurcharge: cheapest.flightTotal,
    pricing: makePricing({ passengers: 2, cruiseTotal: cheapest.packageTotal, flightTotal: cheapest.flightTotal }),
    fares: [],
    options: [],
    warnings: [],
  };
}

/** Headline-only snapshot whose TRIP total is `price` (no flight, no cabins). */
export function priced(day: number, price: number, departure: string | null = null): CruiseSnapshot {
  return { ...snapshot(day, [cabin('Innenkabine', price / 2, 0)], departure), cabins: [], packagePrice: price, flightSurcharge: 0, pricing: makePricing({ passengers: 2, cruiseTotal: price }) };
}

export const series = (days: number, price: (day: number) => number, departure: string | null = null) =>
  Array.from({ length: days }, (_, d) => priced(d, price(d), departure));

/** Deterministic pseudo-random numbers in [0, 1). */
export function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export const rule = (over: Partial<AlertRule> & Pick<AlertRule, 'type'>): AlertRule => ({
  id: `rule-${over.type}`,
  createdAt: at(0),
  routeId: null,
  cabin: null,
  fare: null,
  percent: null,
  targetPrice: null,
  enabled: true,
  ...over,
});

import type { FareOption, PricingOption } from '@cruise/domain';
import { pricingOption } from './fares';

export const fare = (code: string, over: Partial<FareOption> = {}): FareOption => ({
  fareCode: code,
  fareName: code.replace(/_/g, ' '),
  provider: 'aida',
  includedServices: [],
  excludedServices: [],
  refundable: null,
  selectableCabin: null,
  ...over,
});

export const opt = (cabinCategory: string, fareCode: string, cruise: number, flight = 1180): PricingOption =>
  pricingOption({ cabinCategory, fareCode, flightCode: 'FRA', passengers: 2, cruisePrice: cruise, flightPrice: flight });

/** A v4 snapshot carrying fares and options (cabins derived from the cheapest option per cabin). */
export function fareSnapshot(day: number, fares: FareOption[], options: PricingOption[], departure: string | null = null): CruiseSnapshot {
  const cheapest = new Map<string, PricingOption>();
  for (const o of options) if (!cheapest.has(o.cabinCategory) || o.cruisePrice < cheapest.get(o.cabinCategory)!.cruisePrice) cheapest.set(o.cabinCategory, o);
  const cabins = [...cheapest.values()].map((o) => cabin(o.cabinCategory, o.cruisePrice / 2, o.flightPrice / 2));
  return { ...snapshot(day, cabins, departure), fares, options };
}
