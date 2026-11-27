import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItineraryStop } from '@cruise/domain';
import { createGeocodeStore, type GeocodeStore } from '@cruise/shared/storage';
import { createNominatimGeocoder } from './geocoding/nominatim';
import { resolveStopPositions } from './geocoding/resolvePositions';

type Hit = { lat: string; lon: string; category?: string; type?: string };
const hit = (lat: number, lon: number, category = 'place', type = 'city'): Hit => ({ lat: String(lat), lon: String(lon), category, type });

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
    const { fetchFn, calls } = fakeFetch(() => [hit(28.68, -17.76), hit(28.7, -17.8)]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Santa Cruz (La Palma)', country: null })).toEqual({ lat: 28.68, lng: -17.76 });
    expect(calls[0]!.url.searchParams.get('q')).toBe('Santa Cruz La Palma');
    expect(calls[0]!.url.searchParams.has('countrycodes')).toBe(false);
    expect(calls[0]!.url.searchParams.get('limit')).toBe('3');
  });

  it('Mein Schiff: a name with places far apart (Santa Cruz) is ambiguous and answers null', async () => {
    const { fetchFn } = fakeFetch(() => [hit(28.47, -16.25), hit(37.39, -5.99), hit(43.19, -5.77)]);
    expect(await geocoderWith(fetchFn).geocode({ name: 'Santa Cruz', country: null })).toBeNull();
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
