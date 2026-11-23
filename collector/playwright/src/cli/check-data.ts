import { computeAnalytics, toSeries } from '@cruise/analytics';
import { createStores } from '@cruise/shared/storage';

/** Read-only check: does every stored snapshot load, and are any files corrupt? */
const stores = createStores();
for (const route of await stores.routes.list()) {
  const { snapshots, corrupt } = await stores.snapshots.inspect(route.id);
  const a = computeAnalytics(toSeries(snapshots));
  console.log(`${route.name}: ${snapshots.length} snapshots, ${corrupt.length} corrupt${a ? `, current ${a.current}, min ${a.min}, max ${a.max}` : ''}`);
  for (const c of corrupt) console.log('  CORRUPT', c.file, c.reason);
}
