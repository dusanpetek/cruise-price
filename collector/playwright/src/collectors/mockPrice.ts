import type { FareOption, ProviderId } from '@cruise/domain';
import { DEFAULT_COLLECTION_CONFIG, type CollectedCruise, type CollectionConfig } from '../collection/types';

const DAY = 86_400_000;

/** Small deterministic string hash -> [0, 1). */
function hash01(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const FLIGHT_BASE: Record<ProviderId, number> = { aida: 295, 'mein-schiff': 330 };
/** Price multiplier per cabin category relative to the inside cabin. */
const CABINS: [string, number][] = [
  ['Innenkabine', 1],
  ['Balkonkabine', 1.55],
  ['Suite', 2.6],
];

interface MockFare {
  fare: FareOption;
  /** Price multiplier relative to the cheapest fare. */
  factor: number;
  /** Cabin categories this fare is not offered for. */
  except?: string[];
}

const fareOf = (provider: ProviderId, fareName: string, includedServices: string[], excludedServices: string[], flags: Partial<FareOption>): FareOption => ({
  fareCode: fareName.replace(/ /g, '_'),
  fareName,
  provider,
  includedServices,
  excludedServices,
  refundable: null,
  selectableCabin: null,
  ...flags,
});

/** Fares in the style of each provider. AIDA only lists what is included; Mein Schiff also lists what is not. */
const MOCK_FARES: Record<ProviderId, MockFare[]> = {
  aida: [
    { fare: fareOf('aida', 'CLASSIC', ['Wahl der Kabinenkategorie', 'Speisen in allen Buffet-Restaurants inklusive'], [], { selectableCabin: false }), factor: 1 },
    { fare: fareOf('aida', 'PREMIUM', ['Wahl der Kabinenkategorie', 'Speisen in allen Buffet-Restaurants inklusive', 'Wunschkabine', 'Einmalig umbuchen'], [], { selectableCabin: true }), factor: 1.08 },
    { fare: fareOf('aida', 'PREMIUM ALL IN', ['Speisen in allen Buffet-Restaurants inklusive', 'Wunschkabine', 'Einmalig umbuchen', 'Getränkepaket ALL IN'], [], { selectableCabin: true }), factor: 1.28, except: ['Innenkabine'] },
  ],
  'mein-schiff': [
    { fare: fareOf('mein-schiff', 'PLUS', ['Rail&Fly kostenlos', '10 % auf Landausflüge'], ['Frühbucher-Ermäßigung', 'Kostenfrei stornierbar'], { selectableCabin: false, refundable: false }), factor: 1 },
    { fare: fareOf('mein-schiff', 'PRO', ['Rail&Fly kostenlos', '20 % auf Landausflüge', 'Frühbucher-Ermäßigung', 'Freie Kabinen-Umbuchung'], [], { selectableCabin: true }), factor: 1.15 },
  ],
};

/**
 * Plausible fake prices: a per-URL base, a slow seasonal wave, daily noise and a small per-minute jitter.
 * Deterministic for (provider, url, minute), so seeded history is stable across runs.
 */
export function mockCruise(
  provider: ProviderId,
  url: string,
  at: Date,
  config: CollectionConfig = DEFAULT_COLLECTION_CONFIG,
): CollectedCruise {
  const day = Math.floor(at.getTime() / DAY);
  const base = 550 + hash01(`${provider}|${url}`) * 700;
  const wave = Math.sin(day / 11 + hash01(url) * 6) * 0.12;
  const noise = (hash01(`${url}|${day}`) - 0.5) * 0.06;
  const jitter = (hash01(`${url}|m${Math.floor(at.getTime() / 60_000)}`) - 0.5) * 0.03;
  const flight = FLIGHT_BASE[provider] + Math.round((hash01(`f|${url}|${Math.floor(day / 14)}`) - 0.5) * 80);
  const departure = new Date(at.getTime() + 120 * DAY).toISOString().slice(0, 10);
  const cabins = CABINS.map(([category, factor]) => ({
    category,
    packagePerPerson: Math.round(base * factor * (1 + wave + noise + jitter)),
    flightPerPerson: flight,
  }));
  const mockFares = MOCK_FARES[provider];

  return {
    currency: 'EUR',
    cruise: {
      name: provider === 'aida' ? 'Mock Cruise (AIDA)' : 'Mock Cruise (Mein Schiff)',
      ship: provider === 'aida' ? 'AIDAmock' : 'Mein Schiff Mock',
      departure,
      durationNights: 7,
    },
    party: { adults: config.adults, departureAirport: config.airport },
    cabins,
    fares: mockFares.map((m) => m.fare),
    options: cabins.flatMap((c) =>
      mockFares
        .filter((m) => !m.except?.includes(c.category))
        .map((m) => ({ cabinCategory: c.category, fareCode: m.fare.fareCode, cruisePrice: Math.round(c.packagePerPerson * m.factor) * config.adults })),
    ),
  };
}
