import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDataDir } from './paths';

/**
 * data/notifications.json: channel settings and credentials. This file holds secrets, so it is git-ignored
 * and never served by the API. Returns null if it does not exist.
 */
export function createConfigStore(dataDir: string = resolveDataDir()) {
  return {
    async readNotifications(): Promise<unknown | null> {
      try {
        return JSON.parse(await readFile(join(dataDir, 'notifications.json'), 'utf8'));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new Error(`data/notifications.json is not valid JSON: ${(e as Error).message}`);
      }
    },
  };
}
export type ConfigStore = ReturnType<typeof createConfigStore>;
