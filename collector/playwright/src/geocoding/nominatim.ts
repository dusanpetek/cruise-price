const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_USER_AGENT = 'cruise-price-tracker/1.0 (+https://github.com/dusanpetek/cruise-price)';
/** Nominatim usage policy: at most one request per second. */
const DEFAULT_MIN_INTERVAL_MS = 1100;
/** Without a country, the places an answer names must all lie this close to each other to count as one place. */
const AMBIGUITY_RADIUS_KM = 100;

type Position = { lat: number; lng: number };
type NominatimResult = Position & { category: string };

export type Geocoder = {
  geocode(q: { name: string; country: string | null }): Promise<Position | null>;
};

export type NominatimOptions = {
  fetch?: typeof fetch;
  userAgent?: string;
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

function distanceKm(a: Position, b: Position): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * Looks a port up in OpenStreetMap's Nominatim. Requests are serialized with `minIntervalMs` between them and carry an identifying
 * User-Agent (usage policy). A network error or non-2xx answer throws; null means "no unambiguous place".
 */
export function createNominatimGeocoder(opts: NominatimOptions = {}): Geocoder {
  const doFetch = opts.fetch ?? fetch;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let lastRequestAt: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function search(params: Record<string, string>): Promise<NominatimResult[]> {
    if (lastRequestAt !== null) {
      const wait = lastRequestAt + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt = now();
    const url = `${ENDPOINT}?${new URLSearchParams({ ...params, format: 'jsonv2', limit: '3' })}`;
    const res = await doFetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Nominatim answered HTTP ${res.status}`);
    const body = (await res.json()) as { lat: string; lon: string; category?: string }[];
    return body.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), category: r.category ?? '' }));
  }

  async function lookup({ name, country }: { name: string; country: string | null }): Promise<Position | null> {
    if (country) {
      const results = await search({ q: name, countrycodes: country });
      // an administrative boundary is only a fallback: the harbour town or island ranks below it more often than not
      const chosen = results.find((r) => r.category !== 'boundary') ?? results[0];
      return chosen ? { lat: chosen.lat, lng: chosen.lng } : null;
    }
    const results = await search({ q: name.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim() });
    const first = results[0];
    if (!first || results.some((r) => distanceKm(first, r) > AMBIGUITY_RADIUS_KM)) return null;
    return { lat: first.lat, lng: first.lng };
  }

  return {
    geocode(q) {
      const result = queue.then(() => lookup(q));
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
