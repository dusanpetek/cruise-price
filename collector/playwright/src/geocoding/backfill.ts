import { drawableStops } from '@cruise/domain';
import { CollectorLockedError, type Stores } from '@cruise/shared/storage';
import type { Geocoder } from './nominatim';
import { readOnlyStore, resolveStopPositions } from './resolvePositions';

/**
 * `positions:resolve`: gives the stored itineraries the positions of ports the table does not know. Takes the collector lock (so it
 * never overlaps a price run and the 1 request/second holds) and carries on past an unreadable itinerary. Dry run writes nothing,
 * neither itineraries nor cache. Returns the process exit code.
 */
export async function backfillPositions(args: {
  stores: Pick<Stores, 'routes' | 'itineraries' | 'geocodes' | 'lock'>;
  geocoder: Geocoder;
  dryRun: boolean;
  log: (line: string) => void;
}): Promise<number> {
  const { stores, geocoder, dryRun, log } = args;
  let release: () => Promise<void>;
  try {
    release = await stores.lock.acquire();
  } catch (e) {
    if (e instanceof CollectorLockedError) {
      log('a collection is running, try again later');
      return 1;
    }
    throw e;
  }
  try {
    for (const route of await stores.routes.list()) {
      try {
        const itinerary = await stores.itineraries.get(route.id);
        if (!itinerary) continue;
        const stops = await resolveStopPositions(itinerary.stops, { geocoder, store: dryRun ? readOnlyStore(stores.geocodes) : stores.geocodes, now: () => new Date() });
        const resolved = stops.filter((s, i) => s.lat !== null && itinerary.stops[i]!.lat === null).length;
        const unresolved = stops.filter((s) => !s.seaDay).length - drawableStops(stops).length;
        log(`${route.name}: ${resolved} resolved, ${unresolved} unresolved${dryRun ? ' (dry run)' : ''}`);
        if (!dryRun) await stores.itineraries.put({ ...itinerary, stops });
      } catch (e) {
        log(`${route.name}: skipped (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    return 0;
  } finally {
    await release();
  }
}
