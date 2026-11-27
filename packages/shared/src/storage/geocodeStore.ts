import { join } from 'node:path';
import { readJson, writeJsonAtomic } from './jsonFile';
import { resolveDataDir } from './paths';

/** `miss` is a real "nothing (unambiguous) found" answer, never a failed request. */
export type GeocodeEntry = { lat: number; lng: number; source: 'osm'; at: string } | { miss: true; at: string };

/**
 * data/geocode-cache.json: port name -> position found via OpenStreetMap, so every port is looked up once. Only a cache: it can be
 * deleted at any time, a missing or damaged file is simply empty.
 */
export function createGeocodeStore(dataDir: string = resolveDataDir()) {
  const file = join(dataDir, 'geocode-cache.json');

  async function readAll(): Promise<Record<string, GeocodeEntry>> {
    try {
      const all = await readJson(file);
      return all && typeof all === 'object' && !Array.isArray(all) ? (all as Record<string, GeocodeEntry>) : {};
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return {};
      throw e;
    }
  }

  return {
    async get(key: string): Promise<GeocodeEntry | null> {
      return (await readAll())[key] ?? null;
    },
    async put(key: string, entry: GeocodeEntry): Promise<void> {
      await writeJsonAtomic(file, { ...(await readAll()), [key]: entry });
    },
  };
}
export type GeocodeStore = ReturnType<typeof createGeocodeStore>;
