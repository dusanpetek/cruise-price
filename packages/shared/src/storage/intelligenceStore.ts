import { join } from 'node:path';
import { assertSafeId, readJson, writeJsonAtomic } from './jsonFile';
import { resolveDataDir } from './paths';

/**
 * data/intelligence/<routeId>.json: the historical intelligence dataset of a route (lows and highs, booking window and fare
 * statistics, deal score and recommendation history). It is derived from the snapshots and rewritten after every
 * collection, so it can always be rebuilt; the shape is owned by @cruise/analytics.
 */
export function createIntelligenceStore(dataDir: string = resolveDataDir()) {
  const fileOf = (routeId: string) => join(dataDir, 'intelligence', `${assertSafeId(routeId)}.json`);
  return {
    async read(routeId: string): Promise<unknown | null> {
      try {
        return await readJson(fileOf(routeId));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async write(routeId: string, dataset: unknown): Promise<void> {
      await writeJsonAtomic(fileOf(routeId), dataset);
    },
  };
}
export type IntelligenceStore = ReturnType<typeof createIntelligenceStore>;
