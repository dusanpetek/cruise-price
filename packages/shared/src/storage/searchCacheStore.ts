import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeId, readJson, writeJsonAtomic } from './jsonFile';
import { resolveDataDir } from './paths';

/**
 * data/cache/route-search/<key>.json: what the last search of a cruise line's website found, so the next search does not have to
 * open the website again. Only a cache: it can be deleted at any time; the shape is owned by the collector.
 */
export function createSearchCacheStore(dataDir: string = resolveDataDir()) {
  const dir = join(dataDir, 'cache', 'route-search');
  const fileOf = (key: string) => join(dir, `${assertSafeId(key)}.json`);
  return {
    async read(key: string): Promise<unknown | null> {
      try {
        return await readJson(fileOf(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return null; // a damaged file is just a miss
        throw e;
      }
    },
    async write(key: string, entry: unknown): Promise<void> {
      await writeJsonAtomic(fileOf(key), entry);
    },
    /** Deletes the entries whose file is older than `olderThanMs`. Returns how many. */
    async prune(olderThanMs: number, now = Date.now()): Promise<number> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return 0;
      }
      let removed = 0;
      for (const name of names.filter((n) => n.endsWith('.json'))) {
        const entry = (await readJson(join(dir, name)).catch(() => null)) as { fetchedAt?: string } | null;
        const at = entry?.fetchedAt ? Date.parse(entry.fetchedAt) : NaN;
        if (Number.isNaN(at) || now - at > olderThanMs) {
          await rm(join(dir, name), { force: true });
          removed++;
        }
      }
      return removed;
    },
    async ensure(): Promise<void> {
      await mkdir(dir, { recursive: true });
    },
  };
}
export type SearchCacheStore = ReturnType<typeof createSearchCacheStore>;
