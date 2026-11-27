import { portCoordinate, type ItineraryStop } from '@cruise/domain';
import type { GeocodeStore } from '@cruise/shared/storage';
import type { Geocoder } from './nominatim';

/** A "nothing found" answer is asked again after this long. A found position never expires. */
const MISS_RETRY_MS = 30 * 86_400_000;
/** After this many failed requests in a row the rest of the call asks no more (network down, blocked, rate limited). */
const MAX_CONSECUTIVE_ERRORS = 2;

export type ResolveDeps = {
  geocoder: Geocoder;
  store: GeocodeStore;
  now: () => Date;
  log?: (message: string) => void;
};

/** Country of a UN/LOCODE (`SCPOV` -> `sc`); null for a stop without a proper code. */
function countryOf(code: string | null): string | null {
  return code && /^[A-Z]{5}$/.test(code) ? code.slice(0, 2).toLowerCase() : null;
}

const normalize = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Gives stops that the coordinate table does not know a position from OpenStreetMap (cached). Returns copies in the same order;
 * a failed lookup leaves its stop unchanged and is never cached.
 */
export async function resolveStopPositions(stops: ItineraryStop[], deps: ResolveDeps): Promise<ItineraryStop[]> {
  const log = deps.log ?? ((message: string) => console.error(message));
  let consecutiveErrors = 0;
  const out: ItineraryStop[] = [];
  for (const stop of stops) {
    out.push(stop);
    if (stop.seaDay || !stop.name || portCoordinate(stop) || stop.lat !== null) continue;
    const country = countryOf(stop.code);
    const key = `${country ?? '-'}|${normalize(stop.name)}`;
    const cached = await deps.store.get(key);
    if (cached && 'lat' in cached) {
      out[out.length - 1] = { ...stop, lat: cached.lat, lng: cached.lng };
      continue;
    }
    if (cached && deps.now().getTime() - Date.parse(cached.at) < MISS_RETRY_MS) continue;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) continue;
    try {
      const found = await deps.geocoder.geocode({ name: stop.name, country });
      consecutiveErrors = 0;
      const at = deps.now().toISOString();
      if (found) {
        await deps.store.put(key, { lat: found.lat, lng: found.lng, source: 'osm', at });
        out[out.length - 1] = { ...stop, lat: found.lat, lng: found.lng };
      } else {
        await deps.store.put(key, { miss: true, at });
      }
    } catch (e) {
      consecutiveErrors++;
      log(`[collector] could not look up the position of ${stop.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out.map((s) => ({ ...s }));
}
