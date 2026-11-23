import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CollectionRunSchema, type CollectionRun } from '@cruise/domain';
import { assertSafeId, readJson, writeJsonExclusive } from './jsonFile';
import { resolveDataDir } from './paths';

/** data/runs/<runId>.json: one immutable record per collection run. */
export function createRunStore(dataDir: string = resolveDataDir()) {
  const dir = join(dataDir, 'runs');
  return {
    async append(run: CollectionRun): Promise<CollectionRun> {
      const valid = CollectionRunSchema.parse(run);
      await writeJsonExclusive(join(dir, `${assertSafeId(valid.id)}.json`), valid);
      return valid;
    },

    /** Newest first. */
    async list(limit = 50): Promise<CollectionRun[]> {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        return [];
      }
      const newest = files.filter((f) => f.endsWith('.json')).sort().reverse().slice(0, limit);
      const runs: CollectionRun[] = [];
      for (const f of newest) {
        const parsed = CollectionRunSchema.safeParse(await readJson(join(dir, f)).catch(() => null));
        if (parsed.success) runs.push(parsed.data);
      }
      return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
  };
}
export type RunStore = ReturnType<typeof createRunStore>;
