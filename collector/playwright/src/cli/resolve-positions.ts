import { createStores } from '@cruise/shared/storage';
import { backfillPositions } from '../geocoding/backfill';
import { getDefaultGeocoder } from '../collection/batch';

// pnpm positions:resolve [--dry-run]: gives the stored itineraries the positions of ports the table does not know (OpenStreetMap,
// one request per second, cached in data/geocode-cache.json). --dry-run writes nothing (no itinerary, no cache entry).
process.exitCode = await backfillPositions({ stores: createStores(), geocoder: getDefaultGeocoder(), dryRun: process.argv.includes('--dry-run'), log: console.log });
