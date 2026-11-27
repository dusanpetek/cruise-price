import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ItinerarySchema, type Itinerary } from '@cruise/domain';
import { assertSafeId, readJson, writeJsonAtomic } from './jsonFile';
import { resolveDataDir } from './paths';
import { stableStringify } from './stableJson';

/** One itinerary per route, overwritten in place; a re-read with identical stops leaves the file (and its readAt) alone. */
export function createItineraryStore(dataDir: string = resolveDataDir()) {
  const dir = join(dataDir, 'itineraries');
  const fileOf = (routeId: string) => join(dir, `${assertSafeId(routeId)}.json`);

  async function get(routeId: string): Promise<Itinerary | null> {
    const file = fileOf(routeId);
    try {
      return ItinerarySchema.parse(await readJson(file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  return {
    get,

    async put(itinerary: Itinerary): Promise<'created' | 'updated' | 'unchanged'> {
      const file = fileOf(itinerary.routeId);
      const parsed = ItinerarySchema.parse(itinerary);
      const existing = await get(parsed.routeId);
      if (existing && stableStringify(existing.stops) === stableStringify(parsed.stops)) return 'unchanged';
      await writeJsonAtomic(file, parsed);
      return existing ? 'updated' : 'created';
    },

    async remove(routeId: string): Promise<void> {
      await rm(fileOf(routeId), { force: true });
    },
  };
}
export type ItineraryStore = ReturnType<typeof createItineraryStore>;
