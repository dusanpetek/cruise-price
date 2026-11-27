import { drawableStops } from '@cruise/domain';
import { createStores } from '@cruise/shared/storage';
import { createNominatimGeocoder } from '../geocoding/nominatim';
import { readOnlyStore, resolveStopPositions } from '../geocoding/resolvePositions';

// pnpm positions:resolve [--dry-run]: gives the stored itineraries the positions of ports the table does not know (OpenStreetMap,
// one request per second, cached in data/geocode-cache.json). --dry-run writes nothing (no itinerary, no cache entry).
const dryRun = process.argv.includes('--dry-run');
const stores = createStores();
const geocoder = createNominatimGeocoder();

for (const route of await stores.routes.list()) {
  const itinerary = await stores.itineraries.get(route.id);
  if (!itinerary) continue;
  const stops = await resolveStopPositions(itinerary.stops, { geocoder, store: dryRun ? readOnlyStore(stores.geocodes) : stores.geocodes, now: () => new Date() });
  const resolved = stops.filter((s, i) => s.lat !== null && itinerary.stops[i]!.lat === null).length;
  const unresolved = stops.filter((s) => !s.seaDay).length - drawableStops(stops).length;
  console.log(`${route.name}: ${resolved} resolved, ${unresolved} unresolved${dryRun ? ' (dry run)' : ''}`);
  if (!dryRun) await stores.itineraries.put({ ...itinerary, stops });
}
