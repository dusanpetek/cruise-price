import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CruiseSnapshotSchema, RouteInputSchema, type Route } from '@cruise/domain';
import { createStores, type Stores } from '@cruise/shared/storage';
import { collectRoutes } from './collection/batch';
import { searchRoutes } from './search/routeSearch';

/**
 * Opt-in (`pnpm test:live`): drives the REAL provider sites, so it needs the network, depends on
 * whatever prices exist today, and AIDA opens a visible browser window. Not part of CI.
 */
const AIDA_URL = 'https://aida.de/finden/CO07270313/CLASSIC?pax[adults]=2&pax[juveniles]=0&pax[children]=0&pax[babies]=0';
const MEIN_SCHIFF_URL =
  'https://www.meinschiff.com/de/trips/7-naechte-kanaren-mit-madeira-abbis-las-palmas-MSA272223SEE?cabinCategoryType=IKUS2V&priceMode=perPerson&tariff=PLUS';

let dir: string;
let stores: Stores;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cruise-live-'));
  stores = createStores(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

async function collect(name: string, provider: Route['provider'], url: string) {
  const route = await stores.routes.create({ name, provider, url });
  const { outcomes } = await collectRoutes([route], { stores }, { trigger: 'cli' });
  const outcome = outcomes[0]!;
  expect(outcome.result.error, JSON.stringify(outcome.diagnostics.steps)).toBeNull();
  return CruiseSnapshotSchema.parse(outcome.snapshot);
}

/** Every option is cruise + flight = total with the configured flight, and every fare is stored with its services. */
function expectFares(s: Awaited<ReturnType<typeof collect>>, expected: string[]) {
  for (const code of expected) expect(s.fares.map((f) => f.fareCode)).toContain(code);
  expect(s.options.length).toBeGreaterThan(s.cabins.length);
  for (const o of s.options) {
    expect(o).toMatchObject({ flightCode: 'FRA', mandatoryFees: 0 });
    expect(o.cruisePrice + o.flightPrice + o.mandatoryFees).toBe(o.totalPrice);
    expect(o.cruisePerPerson * s.party.adults).toBeCloseTo(o.cruisePrice, 2); // per person and total are stored together
    expect(o.flightPerPerson * s.party.adults).toBeCloseTo(o.flightPrice, 2);
    expect(o.tripPerPerson * s.party.adults).toBeCloseTo(o.totalPrice, 2);
    expect(o.flightPrice).toBe(s.cabins.find((c) => c.category === o.cabinCategory)!.flightTotal);
  }
  for (const f of s.fares) expect(f.includedServices.length + f.excludedServices.length).toBeGreaterThan(0);
  // a cabin's price is its cheapest fare, and the headline is the cheapest TRIP
  for (const c of s.cabins) {
    const mine = s.options.filter((o) => o.cabinCategory === c.category).map((o) => o.cruisePrice);
    if (mine.length) expect(c.packageTotal).toBe(Math.min(...mine));
    expect(c.tripTotal).toBe(c.packageTotal + c.flightTotal + c.mandatoryFees);
  }
  expect(s.pricing.tripTotal).toBe(Math.min(...s.cabins.map((c) => c.tripTotal)));
  expect(s.pricing).toMatchObject({ cruiseTotal: s.packagePrice, flightTotal: s.flightSurcharge });
}

describe('live providers', () => {
  it('AIDA: collects inside and balcony cabins for 2 adults from FRA', async () => {
    const s = await collect('AIDA live', 'aida', AIDA_URL);
    expect(s).toMatchObject({ provider: 'aida', source: 'live', party: { adults: 2, departureAirport: 'FRA' } });
    expect(s.cruise.ship).toBeTruthy();
    const names = s.cabins.map((c) => c.category.toLowerCase());
    expect(names.some((n) => n.includes('innen'))).toBe(true);
    expect(names.some((n) => n.includes('balkon'))).toBe(true);
    for (const c of s.cabins) {
      expect(c.packageTotal).toBe(c.packagePerPerson * 2);
      expect(c.flightTotal).toBeGreaterThan(0);
    }
    expectFares(s, ['CLASSIC', 'PREMIUM']);
    expect(s.fares.some((f) => f.fareCode.endsWith('_ALL_IN'))).toBe(true); // ALL IN variants are priced in the next booking step
    const balcony = s.options.filter((o) => o.cabinCategory === 'Balkonkabine');
    expect(balcony.length).toBeGreaterThanOrEqual(3);
    // AIDA lists only what a fare includes: refundability is never invented
    expect(s.fares.every((f) => f.refundable === null)).toBe(true);
  }, 300_000);

  it('Mein Schiff: creates a valid snapshot for 2 adults from FRA', async () => {
    const s = await collect('Mein Schiff live', 'mein-schiff', MEIN_SCHIFF_URL);
    expect(s).toMatchObject({ provider: 'mein-schiff', source: 'live', party: { adults: 2, departureAirport: 'FRA' } });
    expect(s.cruise).toMatchObject({ ship: expect.stringContaining('Mein Schiff'), durationNights: 7 });
    expect(s.cabins.length).toBeGreaterThan(3);
    expect(s.flightSurcharge).toBeGreaterThan(0);
    expectFares(s, ['PLUS', 'PRO']);
    // Mein Schiff marks services with a tick or a cross, so both lists are filled for PLUS
    const plus = s.fares.find((f) => f.fareCode === 'PLUS')!;
    expect(plus.includedServices.length).toBeGreaterThan(0);
    expect(plus.excludedServices.length).toBeGreaterThan(0);
  });
});

describe('route search on the real sites', () => {
  it.each([['aida' as const, 'kanaren'], ['mein-schiff' as const, 'kanaren']])('%s: finds cruises that can be added as routes', async (provider, query) => {
    const out = await searchRoutes(provider, { query, from: '2027-03-01', to: '2027-03-31', limit: 5 });
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) {
      expect(r.startDate! >= '2027-03-01' && r.startDate! <= '2027-03-31').toBe(true);
      expect(r.nights).toBeGreaterThan(0);
      expect(RouteInputSchema.safeParse({ name: r.title, provider, url: r.url }).success).toBe(true);
    }
  }, 300_000);
});
