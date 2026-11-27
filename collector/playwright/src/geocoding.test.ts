import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItineraryStop } from '@cruise/domain';
import { CollectorLockedError, createGeocodeStore, createStores, type GeocodeStore } from '@cruise/shared/storage';
import { backfillPositions } from './geocoding/backfill';
import { createNominatimGeocoder } from './geocoding/nominatim';
import { readOnlyStore, resolveStopPositions } from './geocoding/resolvePositions';

type Hit = { lat: string; lon: string; category?: string; type?: string; display_name?: string };
const hit = (lat: number, lon: number, category = 'place', type = 'city', display_name = ''): Hit => ({ lat: String(lat), lon: String(lon), category, type, display_name });

/** A fake Nominatim: answers every request from `answer`, records the URLs and headers. */
function fakeFetch(answer: (url: URL) => Hit[] | number) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const body = answer(url);
    if (typeof body === 'number') return new Response('nope', { status: body });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, spy: fetchFn };
}

/** A clock that only moves when `sleep` is called, so the rate limit is observable without waiting. */
function fakeClock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

const geocoderWith = (fetchFn: typeof fetch, clock = fakeClock(), extra: { userAgent?: string } = {}) =>
  createNominatimGeocoder({ fetch: fetchFn, now: clock.now, sleep: clock.sleep, minIntervalMs: 1100, ...extra });

describe('createNominatimGeocoder', () => {
  it('asks for an AIDA port with the country of its code, the identifying User-Agent and jsonv2', async () => {
    const { fetchFn, calls } = fakeFetch(() => [hit(-4.62, 55.45)]);
    const at = await geocoderWith(fetchFn, undefined, { userAgent: 'test-agent/1' }).geocode({ name: 'Port Victoria', country: 'sc' });
    expect(at).toEqual({ lat: -4.62, lng: 55.45 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.origin + calls[0]!.url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ q: 'Port Victoria', countrycodes: 'sc', format: 'jsonv2', limit: '3' });
    expect(calls[0]!.headers['User-Agent']).toBe('test-agent/1');
  });

  it('sends a default User-Agent that identifies the app', async () => {
    const { fetchFn, calls } = fakeFetch(() => [hit(1, 2)]);
    await geocoderWith(fetchFn).geocode({ name: 'X', country: 'sc' });
    expect(calls[0]!.headers['User-Agent']).toMatch(/^cruise-price-tracker\/1\.0/);
  });

  it('AIDA: prefers the first non-boundary result over an earlier administrative boundary', async () => {
    const { fetchFn } = fakeFetch(() => [hit(-4.3, 55.8, 'boundary', 'administrative'), hit(-4.36, 55.83, 'place', 'island')]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'La Digue', country: 'sc' })).toEqual({ lat: -4.36, lng: 55.83 });
  });

  it('AIDA: keeps the first result when the answer holds boundaries only', async () => {
    const { fetchFn } = fakeFetch(() => [hit(32.65, -16.9, 'boundary', 'administrative'), hit(32.7, -16.8, 'boundary', 'administrative')]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Funchal', country: 'pt' })).toEqual({ lat: 32.65, lng: -16.9 });
  });

  it('AIDA: keeps the first result when it is not a boundary', async () => {
    const { fetchFn } = fakeFetch(() => [hit(1, 1, 'place', 'island'), hit(2, 2, 'harbour', 'port')]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'X', country: 'sc' })).toEqual({ lat: 1, lng: 1 });
  });

  it('returns null for an empty answer', async () => {
    const { fetchFn } = fakeFetch(() => []);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Nowhere', country: 'sc' })).toBeNull();
  });

  it('Mein Schiff: accepts results that all lie within 100 km, without a country filter', async () => {
    const { fetchFn, calls } = fakeFetch(() => [hit(28.68, -17.76, 'place', 'city', 'Santa Cruz de La Palma, La Palma, Spain'), hit(28.7, -17.8, 'place', 'village', 'Santa Cruz, La Palma, Spain')]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Santa Cruz (La Palma)', country: null })).toEqual({ lat: 28.68, lng: -17.76 });
    expect(calls[0]!.url.searchParams.get('q')).toBe('Santa Cruz La Palma');
    expect(calls[0]!.url.searchParams.has('countrycodes')).toBe(false);
    expect(calls[0]!.url.searchParams.get('limit')).toBe('3');
  });

  it('Mein Schiff: a name with places far apart (Santa Cruz) is ambiguous and answers null', async () => {
    const { fetchFn } = fakeFetch(() => [hit(28.47, -16.25), hit(37.39, -5.99), hit(43.19, -5.77)]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Santa Cruz', country: null })).toBeNull();
  });

  it('Mein Schiff: a qualifier name whose first result lacks the qualifier (Santa Cruz in Peru) answers null although the results agree', async () => {
    const { fetchFn } = fakeFetch(() => [
      hit(-6.75, -78.92, 'boundary', 'administrative', 'Santa Cruz, Cajamarca, Peru'),
      hit(-6.62, -78.95, 'place', 'village', 'Santa Cruz, Provincia de Santa Cruz, Cajamarca, Peru'),
    ]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Santa Cruz (La Palma)', country: null })).toBeNull();
  });

  it('Mein Schiff: a result that only names the qualifier in its address (village "La Palma" in Peru) is rejected, as seen live', async () => {
    const { fetchFn } = fakeFetch(() => [
      hit(-6.7536, -78.9169, 'place', 'village', 'La Palma, Pulán, Santa Cruz, Cajamarca, Perú'),
      hit(-6.6714, -78.8391, 'place', 'village', 'La Palma, Yauyucan, Santa Cruz, Cajamarca, Perú'),
    ]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Santa Cruz (La Palma)', country: null })).toBeNull();
  });

  it('Mein Schiff: accepts a qualifier name when the first result contains the folded qualifier', async () => {
    const { fetchFn } = fakeFetch(() => [hit(32.65, -16.91, 'place', 'city', 'Funchal, Madeira, Portugal')]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Funchal (Madeira)', country: null })).toEqual({ lat: 32.65, lng: -16.91 });
    const accents = fakeFetch(() => [hit(1, 1, 'place', 'city', 'Málaga, Andalucía, España')]);
    expect(await geocoderWith(accents.fetchFn).geocode({ name: 'Malaga (ANDALUCIA)', country: null })).toEqual({ lat: 1, lng: 1 });
  });

  it('Mein Schiff: only the first result counts for the qualifier', async () => {
    const { fetchFn } = fakeFetch(() => [hit(-6.75, -78.92, 'place', 'city', 'Santa Cruz, Cajamarca, Peru'), hit(-6.7, -78.9, 'place', 'village', 'Santa Cruz, La Palma, Peru')]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Santa Cruz (La Palma)', country: null })).toBeNull();
  });

  it('AIDA: a qualifier in the name does not matter, the country filter rules', async () => {
    const { fetchFn } = fakeFetch(() => [hit(1, 1, 'place', 'city', 'Somewhere')]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Santa Cruz (La Palma)', country: 'es' })).toEqual({ lat: 1, lng: 1 });
  });

  it('Mein Schiff: a plain name needs its first address part to contain the name', async () => {
    const other = fakeFetch(() => [hit(43.3, -8.4, 'place', 'city', 'A Coruña, Galicia, España')]);
    expect(await geocoderWith(other.fetchFn).geocode({ name: 'Hamburg', country: null })).toBeNull();
    const same = fakeFetch(() => [hit(53.55, 10, 'place', 'city', 'Hamburg, Deutschland')]);
    expect(await geocoderWith(same.fetchFn).geocode({ name: 'Hamburg', country: null })).toEqual({ lat: 53.55, lng: 10 });
  });

  it('Mein Schiff: asks with accept-language de,en; AIDA does not', async () => {
    const ms = fakeFetch(() => [hit(53.55, 10, 'place', 'city', 'Hamburg, Deutschland')]);
    await geocoderWith(ms.fetchFn).geocode({ name: 'Hamburg', country: null });
    expect(ms.calls[0]!.url.searchParams.get('accept-language')).toBe('de,en');
    const aida = fakeFetch(() => [hit(1, 1)]);
    await geocoderWith(aida.fetchFn).geocode({ name: 'X', country: 'sc' });
    expect(aida.calls[0]!.url.searchParams.has('accept-language')).toBe(false);
  });

  it('reads the User-Agent from GEOCODE_USER_AGENT, an option wins over it', async () => {
    const before = process.env.GEOCODE_USER_AGENT;
    process.env.GEOCODE_USER_AGENT = 'from-env/2';
    try {
      const a = fakeFetch(() => [hit(1, 1)]);
      await geocoderWith(a.fetchFn).geocode({ name: 'X', country: 'sc' });
      expect(a.calls[0]!.headers['User-Agent']).toBe('from-env/2');
      const b = fakeFetch(() => [hit(1, 1)]);
      await geocoderWith(b.fetchFn, undefined, { userAgent: 'opt/1' }).geocode({ name: 'X', country: 'sc' });
      expect(b.calls[0]!.headers['User-Agent']).toBe('opt/1');
    } finally {
      if (before === undefined) delete process.env.GEOCODE_USER_AGENT;
      else process.env.GEOCODE_USER_AGENT = before;
    }
  });

  it('times out a request that never answers, throws and keeps working afterwards', async () => {
    let hang = true;
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      if (!hang) return new Response(JSON.stringify([hit(1, 1)]), { status: 200 });
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)));
    }) as unknown as typeof fetch;
    const geocoder = createNominatimGeocoder({ fetch: fetchFn, timeoutMs: 5, minIntervalMs: 0 });
    await expect(geocoder.geocode({ name: 'A', country: 'sc' })).rejects.toThrow();
    hang = false;
    expect(await geocoder.geocode({ name: 'A', country: 'sc' })).toEqual({ lat: 1, lng: 1 });
  });

  it.each([403, 429])('after an HTTP %i the geocoder refuses every further request without calling fetch', async (status) => {
    const { fetchFn, spy } = fakeFetch(() => status);
    const geocoder = geocoderWith(fetchFn);
    await expect(geocoder.geocode({ name: 'A', country: 'sc' })).rejects.toThrow(String(status));
    await expect(geocoder.geocode({ name: 'B', country: 'sc' })).rejects.toThrow(/blocked|refus/i);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a 500 does not trip the breaker', async () => {
    let n = 0;
    const { fetchFn, spy } = fakeFetch(() => (n++ === 0 ? 500 : [hit(1, 1)]));
    const geocoder = geocoderWith(fetchFn);
    await expect(geocoder.geocode({ name: 'A', country: 'sc' })).rejects.toThrow();
    await geocoder.geocode({ name: 'B', country: 'sc' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('waits at least minIntervalMs between two requests, not before the first', async () => {
    const { fetchFn } = fakeFetch(() => [hit(1, 1)]);
    const clock = fakeClock();
    const geocoder = geocoderWith(fetchFn, clock);
    await Promise.all([geocoder.geocode({ name: 'A', country: 'sc' }), geocoder.geocode({ name: 'B', country: 'sc' }), geocoder.geocode({ name: 'C', country: 'sc' })]);
    expect(clock.sleeps).toEqual([1100, 1100]);
  });

  it('throws on a non-2xx answer and on a network error', async () => {
    await expect(geocoderWith(fakeFetch(() => 429).fetchFn).geocode({ name: 'A', country: 'sc' })).rejects.toThrow(/429/);
    const broken = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(geocoderWith(broken).geocode({ name: 'A', country: 'sc' })).rejects.toThrow('offline');
  });

  it('keeps working after a failed request', async () => {
    let n = 0;
    const { fetchFn } = fakeFetch(() => (n++ === 0 ? 500 : [hit(1, 1)]));
    const geocoder = geocoderWith(fetchFn);
    await expect(geocoder.geocode({ name: 'A', country: 'sc' })).rejects.toThrow();
    expect(await geocoder.geocode({ name: 'A', country: 'sc' })).toEqual({ lat: 1, lng: 1 });
  });
});

describe('resolveStopPositions', () => {
  let dir: string;
  let store: GeocodeStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cruise-'));
    store = createGeocodeStore(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const stop = (over: Partial<ItineraryStop>): ItineraryStop => ({ code: null, name: null, seaDay: false, arrival: null, departure: null, lat: null, lng: null, ...over });
  const NOW = new Date('2026-11-27T10:00:00.000Z');
  const geocoderOf = (geocode: (q: { name: string; country: string | null }) => Promise<{ lat: number; lng: number } | null>) => ({ geocode: vi.fn(geocode) });
  const resolve = (stops: ItineraryStop[], geocoder: ReturnType<typeof geocoderOf>, now = NOW) => resolveStopPositions(stops, { geocoder, store, now: () => now, log: () => {} });

  it('skips table ports, sea days, nameless stops and stops that already have a position', async () => {
    const geocoder = geocoderOf(async () => ({ lat: 9, lng: 9 }));
    const stops = [stop({ code: 'ESLPA', name: 'Las Palmas' }), stop({ seaDay: true, code: 'SEE', name: 'Seetag' }), stop({ code: 'XXXXX' }), stop({ code: 'YYYYY', name: 'Y', lat: 1, lng: 2 })];
    expect(await resolve(stops, geocoder)).toEqual(stops);
    expect(geocoder.geocode).not.toHaveBeenCalled();
  });

  it('sets lat/lng from the geocoder with the country of the code, caches the hit and does not ask twice', async () => {
    const geocoder = geocoderOf(async () => ({ lat: -4.62, lng: 55.45 }));
    const [a] = await resolve([stop({ code: 'SCXYZ', name: 'Port Victoria' })], geocoder);
    expect(a).toMatchObject({ lat: -4.62, lng: 55.45 });
    expect(geocoder.geocode).toHaveBeenCalledWith({ name: 'Port Victoria', country: 'sc' });
    expect(await store.get('sc|port victoria')).toEqual({ lat: -4.62, lng: 55.45, source: 'osm', at: NOW.toISOString() });
    const [b] = await resolve([stop({ code: 'SCXYZ', name: 'Port Victoria' })], geocoder);
    expect(b).toMatchObject({ lat: -4.62, lng: 55.45 });
    expect(geocoder.geocode).toHaveBeenCalledTimes(1);
  });

  it('uses no country for a stop without a UN/LOCODE and normalizes the cache key', async () => {
    const geocoder = geocoderOf(async () => ({ lat: 1, lng: 2 }));
    await resolve([stop({ name: ' Séville (Spain) ' })], geocoder);
    expect(geocoder.geocode).toHaveBeenCalledWith({ name: ' Séville (Spain) ', country: null });
    expect(await store.get('-|seville (spain)')).toMatchObject({ lat: 1, lng: 2 });
  });

  it('asks only once for a port that appears twice in one route', async () => {
    const geocoder = geocoderOf(async () => ({ lat: 1, lng: 2 }));
    const out = await resolve([stop({ code: 'SCXYZ', name: 'Port Victoria' }), stop({ code: 'SCXYZ', name: 'Port Victoria' })], geocoder);
    expect(out.map((s) => s.lat)).toEqual([1, 1]);
    expect(geocoder.geocode).toHaveBeenCalledTimes(1);
  });

  it('caches an unknown answer as a miss, skips it within 30 days and retries after', async () => {
    const geocoder = geocoderOf(async () => null);
    const s = stop({ code: 'SCXYZ', name: 'Port Victoria' });
    expect(await resolve([s], geocoder)).toEqual([s]);
    expect(await store.get('sc|port victoria')).toEqual({ miss: true, at: NOW.toISOString() });
    await resolve([s], geocoder, new Date(NOW.getTime() + 29 * 86_400_000));
    expect(geocoder.geocode).toHaveBeenCalledTimes(1);
    geocoder.geocode.mockResolvedValueOnce({ lat: 3, lng: 4 });
    const [again] = await resolve([s], geocoder, new Date(NOW.getTime() + 31 * 86_400_000));
    expect(geocoder.geocode).toHaveBeenCalledTimes(2);
    expect(again).toMatchObject({ lat: 3, lng: 4 });
  });

  it('does not cache an error, logs it and still resolves the other stops', async () => {
    const geocoder = geocoderOf(async ({ name }) => {
      if (name === 'Bad') throw new Error('HTTP 503');
      return { lat: 5, lng: 6 };
    });
    const log = vi.fn();
    const out = await resolveStopPositions([stop({ code: 'SCBAD', name: 'Bad' }), stop({ code: 'SCGOD', name: 'Good' })], { geocoder, store, now: () => NOW, log });
    expect(out.map((s) => s.lat)).toEqual([null, 5]);
    expect(await store.get('sc|bad')).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain('Bad');
    expect(log.mock.calls[0]![0]).toContain('HTTP 503');
  });

  it('stops asking after 2 consecutive errors but still uses the cache', async () => {
    await store.put('sc|cached', { lat: 7, lng: 8, source: 'osm', at: NOW.toISOString() });
    const geocoder = geocoderOf(async () => {
      throw new Error('down');
    });
    const stops = ['A', 'B', 'C', 'D'].map((n) => stop({ code: 'SCXXX', name: n })).concat(stop({ code: 'SCCCC', name: 'Cached' }));
    const out = await resolve(stops, geocoder);
    expect(geocoder.geocode).toHaveBeenCalledTimes(2);
    expect(out.map((s) => s.lat)).toEqual([null, null, null, null, 7]);
  });

  it('resets the error count after a success', async () => {
    const geocoder = geocoderOf(async ({ name }) => {
      if (name === 'A' || name === 'C') throw new Error('flaky');
      return { lat: 1, lng: 1 };
    });
    await resolve(['A', 'B', 'C', 'D'].map((n) => stop({ code: 'SCXXX', name: n })), geocoder);
    expect(geocoder.geocode).toHaveBeenCalledTimes(4);
  });

  it('caches a rejected qualifier answer as a miss', async () => {
    const { fetchFn } = fakeFetch(() => [hit(-6.75, -78.92, 'place', 'city', 'Santa Cruz, Cajamarca, Peru')]);
    const geocoder = geocoderWith(fetchFn);
    const out = await resolveStopPositions([stop({ name: 'Santa Cruz (Laguna)' })], { geocoder, store, now: () => NOW, log: () => {} });
    expect(out[0]).toMatchObject({ lat: null, lng: null });
    expect(await store.get('-|santa cruz (laguna)')).toEqual({ miss: true, at: NOW.toISOString() });
  });

  it('a read-only store (dry run) still serves hits but writes nothing', async () => {
    await store.put('sc|cached', { lat: 7, lng: 8, source: 'osm', at: NOW.toISOString() });
    const geocoder = geocoderOf(async () => ({ lat: 1, lng: 2 }));
    const out = await resolveStopPositions([stop({ code: 'SCXYZ', name: 'Cached' }), stop({ code: 'SCXYZ', name: 'New' })], { geocoder, store: readOnlyStore(store), now: () => NOW, log: () => {} });
    expect(out.map((s) => s.lat)).toEqual([7, 1]);
    expect(await store.get('sc|new')).toBeNull();
  });

  it('keeps the order and never mutates its input', async () => {
    const geocoder = geocoderOf(async () => ({ lat: 1, lng: 2 }));
    const stops = [stop({ code: 'ESLPA', name: 'Las Palmas' }), stop({ code: 'SCXYZ', name: 'Port Victoria' }), stop({ seaDay: true })];
    const before = structuredClone(stops);
    const out = await resolve(stops, geocoder);
    expect(stops).toEqual(before);
    expect(out.map((s) => s.code)).toEqual(['ESLPA', 'SCXYZ', null]);
    expect(out[1]).not.toBe(stops[1]);
  });
});

describe('backfillPositions (positions:resolve)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cruise-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const stopAt = (code: string, name: string): ItineraryStop => ({ code, name, seaDay: false, arrival: null, departure: null, lat: null, lng: null });
  const setup = async (names: string[]) => {
    const stores = createStores(dir);
    for (const name of names) {
      const route = await stores.routes.create({ name, provider: 'aida', url: 'https://aida.de/x' });
      await stores.itineraries.put({ routeId: route.id, provider: 'aida', readAt: '2026-11-27T10:00:00.000Z', stops: [stopAt('SCXYZ', 'Port Victoria')] });
    }
    return stores;
  };
  const geocoder = () => ({ geocode: vi.fn(async () => ({ lat: -4.6, lng: 55.4 })) });

  it('resolves and stores every itinerary and reports the counts', async () => {
    const stores = await setup(['A', 'B']);
    const lines: string[] = [];
    const code = await backfillPositions({ stores, geocoder: geocoder(), dryRun: false, log: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(lines).toEqual(['A: 1 resolved, 0 unresolved', 'B: 1 resolved, 0 unresolved']);
    for (const r of await stores.routes.list()) expect((await stores.itineraries.get(r.id))!.stops[0]).toMatchObject({ lat: -4.6, lng: 55.4 });
  });

  it('dry run writes neither itineraries nor cache', async () => {
    const stores = await setup(['A']);
    await backfillPositions({ stores, geocoder: geocoder(), dryRun: true, log: () => {} });
    const [route] = await stores.routes.list();
    expect((await stores.itineraries.get(route!.id))!.stops[0]).toMatchObject({ lat: null, lng: null });
    expect(await stores.geocodes.get('sc|port victoria')).toBeNull();
  });

  it('a held collector lock answers 1 and touches nothing', async () => {
    const stores = await setup(['A']);
    const g = geocoder();
    const lines: string[] = [];
    const locked = { ...stores, lock: { acquire: async () => Promise.reject(new CollectorLockedError({ pid: 1, startedAt: '2026-11-27T10:00:00.000Z' })) } } as never;
    expect(await backfillPositions({ stores: locked, geocoder: g, dryRun: false, log: (l) => lines.push(l) })).toBe(1);
    expect(lines).toEqual(['a collection is running, try again later']);
    expect(g.geocode).not.toHaveBeenCalled();
    const [route] = await stores.routes.list();
    expect((await stores.itineraries.get(route!.id))!.stops[0]).toMatchObject({ lat: null });
  });

  it('releases the lock afterwards', async () => {
    const stores = await setup(['A']);
    await backfillPositions({ stores, geocoder: geocoder(), dryRun: false, log: () => {} });
    const release = await stores.lock.acquire();
    await release();
  });

  it('one unreadable itinerary does not stop the others', async () => {
    const stores = await setup(['A', 'B']);
    const [a, b] = await stores.routes.list();
    await writeFile(join(dir, 'itineraries', `${a!.id}.json`), '{broken');
    const lines: string[] = [];
    expect(await backfillPositions({ stores, geocoder: geocoder(), dryRun: false, log: (l) => lines.push(l) })).toBe(0);
    expect(lines[0]).toMatch(/^A: skipped \(.+\)$/);
    expect(lines[1]).toBe('B: 1 resolved, 0 unresolved');
    expect((await stores.itineraries.get(b!.id))!.stops[0]).toMatchObject({ lat: -4.6 });
  });
});
