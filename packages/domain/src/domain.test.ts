import { describe, expect, it } from 'vitest';
import {
  CruiseSnapshotSchema,
  FareOptionSchema,
  PricingOptionSchema,
  PricingSnapshotSchema,
  fareCodeOf,
  makePricing,
  RouteInputSchema,
  SnapshotInputSchema,
  detectProviderId,
  migrateSnapshot,
  parseSnapshot,
} from './index';

describe('detectProviderId', () => {
  it.each([
    ['https://aida.de/finden/CO07270313/CLASSIC?pax[adults]=2', 'aida'],
    ['https://www.aida.de/kreuzfahrt/x', 'aida'],
    ['https://www.meinschiff.com/de/trips/abc', 'mein-schiff'],
    ['https://www.tuicruises.com/x', 'mein-schiff'],
    ['https://example.com', null],
    ['https://notaida.de', null],
    ['https://aida.de.evil.com', null],
    ['not a url', null],
  ])('%s -> %s', (url, expected) => {
    expect(detectProviderId(url)).toBe(expected);
  });
});

describe('RouteInputSchema', () => {
  it('accepts a matching provider and URL', () => {
    expect(RouteInputSchema.parse({ name: ' X ', provider: 'aida', url: 'https://aida.de/x' }).name).toBe('X');
  });
  it('rejects a provider/URL mismatch and empty names', () => {
    expect(RouteInputSchema.safeParse({ name: 'X', provider: 'aida', url: 'https://meinschiff.com/x' }).success).toBe(false);
    expect(RouteInputSchema.safeParse({ name: ' ', provider: 'aida', url: 'https://aida.de/x' }).success).toBe(false);
  });
});

const pricing = { cruisePerPerson: 649, cruiseTotal: 1298, flightPerPerson: 590, flightTotal: 1180, mandatoryFees: 0, tripPerPerson: 1239, tripTotal: 2478 };
const v4 = {
  schemaVersion: 4,
  id: 's1',
  routeId: 'r1',
  provider: 'aida',
  collectedAt: '2026-01-01T00:00:00.000Z',
  source: 'live',
  currency: 'EUR',
  cruise: { name: 'N', ship: 'S', departure: '2027-03-13', durationNights: 7 },
  party: { adults: 2, departureAirport: 'FRA' },
  cabins: [{ category: 'Inside', packagePerPerson: 649, flightPerPerson: 590, packageTotal: 1298, flightTotal: 1180, mandatoryFees: 0, tripPerPerson: 1239, tripTotal: 2478 }],
  packagePrice: 1298,
  flightSurcharge: 1180,
  pricing,
  fares: [],
  options: [],
  warnings: [],
};

describe('snapshot schema', () => {
  it('accepts a valid v4 snapshot', () => {
    expect(CruiseSnapshotSchema.parse(v4)).toEqual(v4);
  });

  it.each([
    ['negative price', { packagePrice: -1 }],
    ['bad timestamp', { collectedAt: 'yesterday' }],
    ['unknown source', { source: 'scraped' }],
    ['bad currency', { currency: 'EURO' }],
    ['zero adults', { party: { adults: 0, departureAirport: null } }],
    ['bad departure date', { cruise: { name: null, ship: null, departure: '13.03.2027', durationNights: 7 } }],
    ['negative cabin price', { cabins: [{ ...v4.cabins[0], packageTotal: -5 }] }],
    ['a headline that disagrees with the pricing block', { packagePrice: 1000 }],
    ['a trip total that is not cruise + flight + fees', { pricing: { ...pricing, tripTotal: 1298 } }],
  ])('rejects %s', (_label, patch) => {
    expect(CruiseSnapshotSchema.safeParse({ ...v4, ...patch }).success).toBe(false);
  });

  it('fills defaults on input and derives every price consistently', () => {
    const input = SnapshotInputSchema.parse({ routeId: 'r1', source: 'manual', packagePrice: 1000, flightSurcharge: 200 });
    expect(input).toMatchObject({ provider: null, currency: 'EUR', cabins: [], fares: [], options: [], warnings: [], party: { adults: 2 } });
    expect(input.pricing).toEqual({ cruisePerPerson: 500, cruiseTotal: 1000, flightPerPerson: 100, flightTotal: 200, mandatoryFees: 0, tripPerPerson: 600, tripTotal: 1200 });
  });

  it('derives the trip prices of cabins and options on input', () => {
    const input = SnapshotInputSchema.parse({
      routeId: 'r1',
      source: 'live',
      packagePrice: 1298,
      flightSurcharge: 1180,
      cabins: [{ category: 'Inside', packagePerPerson: 649, flightPerPerson: 590, packageTotal: 1298, flightTotal: 1180 }],
      options: [{ cabinCategory: 'Inside', fareCode: 'CLASSIC', flightCode: 'FRA', cruisePrice: 1298, flightPrice: 1180, totalPrice: 2478 }],
    });
    expect(input.cabins[0]).toMatchObject({ mandatoryFees: 0, tripPerPerson: 1239, tripTotal: 2478 });
    expect(input.options[0]).toMatchObject({ cruisePerPerson: 649, flightPerPerson: 590, mandatoryFees: 0, tripPerPerson: 1239, totalPrice: 2478 });
  });
});

describe('pricing block', () => {
  it('derives everything from party totals or from per-person prices', () => {
    expect(makePricing({ passengers: 2, cruiseTotal: 2998, flightTotal: 598, mandatoryFees: 100 })).toEqual({ cruisePerPerson: 1499, cruiseTotal: 2998, flightPerPerson: 299, flightTotal: 598, mandatoryFees: 100, tripPerPerson: 1848, tripTotal: 3696 }); // the specification's example
    expect(makePricing({ passengers: 2, cruisePerPerson: 1499, flightPerPerson: 299, mandatoryFees: 100 })).toEqual(makePricing({ passengers: 2, cruiseTotal: 2998, flightTotal: 598, mandatoryFees: 100 }));
    expect(makePricing({ passengers: 3, cruiseTotal: 1000 })).toMatchObject({ flightTotal: 0, flightPerPerson: 0, tripTotal: 1000, tripPerPerson: 333.33 });
  });

  it('requires trip total = cruise + flight + mandatory fees', () => {
    expect(PricingSnapshotSchema.safeParse(pricing).success).toBe(true);
    expect(PricingSnapshotSchema.safeParse({ ...pricing, tripTotal: 1298 }).success).toBe(false);
    expect(PricingSnapshotSchema.safeParse({ ...pricing, mandatoryFees: 100, tripTotal: 2578 }).success).toBe(true);
    expect(PricingSnapshotSchema.safeParse({ ...pricing, flightTotal: -1 }).success).toBe(false);
  });
});

describe('snapshot versioning', () => {
  const v1 = { id: 'old', routeId: 'r1', collectedAt: '2026-01-01T00:00:00.000Z', source: 'mock', currency: 'EUR', packagePrice: 1200, flightSurcharge: 250 };

  it('upgrades a v1 (MVP) snapshot all the way to v4, with the fare unknown', () => {
    const up = parseSnapshot(v1);
    expect(up).toMatchObject({ schemaVersion: 4, provider: null, cabins: [], packagePrice: 1200, flightSurcharge: 250, fares: [], options: [], warnings: [] });
    expect(up.pricing).toEqual({ cruisePerPerson: 600, cruiseTotal: 1200, flightPerPerson: 125, flightTotal: 250, mandatoryFees: 0, tripPerPerson: 725, tripTotal: 1450 });
  });

  it('upgrades a v2 snapshot: no fares and no options, nothing invented, trip prices derived', () => {
    const { fares: _f, options: _o, warnings: _w, pricing: _p, ...rest } = v4;
    const v2 = { ...rest, schemaVersion: 2, cabins: v4.cabins.map(({ mandatoryFees: _m, tripPerPerson: _tp, tripTotal: _tt, ...c }) => c) };
    expect(parseSnapshot(v2)).toEqual(v4);
  });

  it('upgrades a v3 snapshot: per-person and trip prices are derived from the stored totals', () => {
    const { pricing: _p, ...rest } = v4;
    const v3 = {
      ...rest,
      schemaVersion: 3,
      cabins: v4.cabins.map(({ mandatoryFees: _m, tripPerPerson: _tp, tripTotal: _tt, ...c }) => c),
      fares: [{ fareCode: 'CLASSIC', fareName: 'CLASSIC', provider: 'aida', includedServices: [], excludedServices: [], refundable: null, selectableCabin: null }],
      options: [{ cabinCategory: 'Inside', fareCode: 'CLASSIC', flightCode: 'FRA', cruisePrice: 1298, flightPrice: 1180, totalPrice: 2478 }],
    };
    const up = parseSnapshot(v3);
    expect(up.options[0]).toEqual({ cabinCategory: 'Inside', fareCode: 'CLASSIC', flightCode: 'FRA', cruisePerPerson: 649, cruisePrice: 1298, flightPerPerson: 590, flightPrice: 1180, mandatoryFees: 0, tripPerPerson: 1239, totalPrice: 2478 });
    expect(up.cabins[0]).toMatchObject({ tripPerPerson: 1239, tripTotal: 2478 });
    expect(up.pricing).toEqual(pricing);
  });

  it('assumes 2 passengers when an old document has no party', () => {
    const { party: _party, pricing: _p, ...rest } = v4;
    const up = migrateSnapshot({ ...rest, schemaVersion: 3, cabins: [], options: [] }) as { pricing: { cruisePerPerson: number } };
    expect(up.pricing.cruisePerPerson).toBe(649);
  });

  it('leaves current documents and non-objects untouched', () => {
    expect(migrateSnapshot(v4)).toBe(v4);
    expect(migrateSnapshot('x')).toBe('x');
    expect(migrateSnapshot(null)).toBeNull();
  });

  it('rejects an unknown future version', () => {
    expect(() => parseSnapshot({ ...v4, schemaVersion: 5 })).toThrow();
  });
});

describe('fares and pricing options', () => {
  const fare = { fareCode: 'PREMIUM_ALL_IN', fareName: 'PREMIUM ALL IN', provider: 'aida', includedServices: ['Wunschkabine'], excludedServices: [], refundable: null, selectableCabin: true };

  it('derives fare codes from names', () => {
    expect(fareCodeOf('PREMIUM ALL IN')).toBe('PREMIUM_ALL_IN');
    expect(fareCodeOf('  Comfort  All-In ')).toBe('COMFORT_ALL_IN');
    expect(fareCodeOf('PLUS')).toBe('PLUS');
  });

  it('keeps unknown fare properties unknown', () => {
    expect(FareOptionSchema.parse(fare)).toMatchObject({ refundable: null, selectableCabin: true });
    expect(FareOptionSchema.safeParse({ ...fare, refundable: 'maybe' }).success).toBe(false);
    expect(FareOptionSchema.safeParse({ ...fare, provider: 'tui' }).success).toBe(false);
  });

  it('requires total = cruise + flight + mandatory fees, always, and stores per-person prices too', () => {
    const option = { cabinCategory: 'Balkonkabine', fareCode: 'PREMIUM', flightCode: 'FRA', cruisePerPerson: 1499.5, cruisePrice: 2999, flightPerPerson: 199.5, flightPrice: 399, mandatoryFees: 0, tripPerPerson: 1699, totalPrice: 3398 };
    expect(PricingOptionSchema.safeParse(option).success).toBe(true);
    expect(PricingOptionSchema.safeParse({ ...option, totalPrice: 2999 }).success).toBe(false);
    expect(PricingOptionSchema.safeParse({ ...option, flightCode: null, flightPrice: 0, flightPerPerson: 0, totalPrice: 2999 }).success).toBe(true);
    expect(PricingOptionSchema.safeParse({ ...option, mandatoryFees: 100, totalPrice: 3498 }).success).toBe(true);
    expect(PricingOptionSchema.safeParse({ ...option, cruisePrice: -1, totalPrice: 398 }).success).toBe(false);
    const { tripPerPerson: _t, ...missing } = option;
    expect(PricingOptionSchema.safeParse(missing).success).toBe(false);
  });

});
