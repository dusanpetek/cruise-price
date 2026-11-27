const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_USER_AGENT = 'cruise-price-tracker/1.0 (+https://github.com/dusanpetek/cruise-price)';
/** Nominatim usage policy: at most one request per second. */
const DEFAULT_MIN_INTERVAL_MS = 1100;
/** Without a country, the places an answer names must all lie this close to each other to count as one place. */
const AMBIGUITY_RADIUS_KM = 100;
const DEFAULT_TIMEOUT_MS = 10_000;

type Position = { lat: number; lng: number };
type NominatimResult = Position & { category: string; displayName: string };

/** Lowercase, diacritics removed, for comparing a name with what the geocoder answers. */
export const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export type Geocoder = {
  geocode(q: { name: string; country: string | null }): Promise<Position | null>;
};

export type NominatimOptions = {
  fetch?: typeof fetch;
  /** Default: env GEOCODE_USER_AGENT, else an identifying one for this app. */
  userAgent?: string;
  /** A request that takes longer is aborted and throws. Default 10 s. */
  timeoutMs?: number;
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
 * User-Agent (usage policy). A network error, timeout or non-2xx answer throws; null means "no unambiguous place".
 * After an HTTP 403 or 429 (blocked or rate limited) the instance refuses every further request without calling out: asking on would
 * only deepen the block, and a new instance (process restart) is the way back.
 */
export function createNominatimGeocoder(opts: NominatimOptions = {}): Geocoder {
  const doFetch = opts.fetch ?? fetch;
  const userAgent = opts.userAgent ?? (process.env.GEOCODE_USER_AGENT || DEFAULT_USER_AGENT);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let blocked = false;
  let lastRequestAt: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function search(params: Record<string, string>): Promise<NominatimResult[]> {
    if (blocked) throw new Error('Nominatim refused earlier (HTTP 403/429): no further requests from this process');
    if (lastRequestAt !== null) {
      const wait = lastRequestAt + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt = now();
    const url = `${ENDPOINT}?${new URLSearchParams({ ...params, format: 'jsonv2', limit: '3' })}`;
    const res = await doFetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 403 || res.status === 429) blocked = true;
    if (!res.ok) throw new Error(`Nominatim answered HTTP ${res.status}`);
    const body = (await res.json()) as { lat: string; lon: string; category?: string; display_name?: string }[];
    return body.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), category: r.category ?? '', displayName: r.display_name ?? '' }));
  }

  async function lookup({ name, country }: { name: string; country: string | null }): Promise<Position | null> {
    if (country) {
      const results = await search({ q: name, countrycodes: country });
      // an administrative boundary is only a fallback: the harbour town or island ranks below it more often than not
      const chosen = results.find((r) => r.category !== 'boundary') ?? results[0];
      return chosen ? { lat: chosen.lat, lng: chosen.lng } : null;
    }
    // German qualifiers (Mein Schiff) should match the display names
    const results = await search({ q: name.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(), 'accept-language': 'de,en' });
    const first = results[0];
    if (!first || results.some((r) => distanceKm(first, r) > AMBIGUITY_RADIUS_KM)) return null;
    // The free-text search may find another place altogether (a village "La Palma" in Peru for "Santa Cruz (La Palma)"), so the
    // first result must be named like the port (its first address part) and, for a bracket qualifier, carry it in its address
    const address = fold(first.displayName);
    const base = fold(name.replace(/\([^)]*\)/g, '')).trim();
    if (!address.split(',')[0]!.includes(base)) return null;
    const qualifier = /\(([^)]+)\)/.exec(name)?.[1]?.trim();
    if (qualifier && !address.includes(fold(qualifier))) return null;
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
