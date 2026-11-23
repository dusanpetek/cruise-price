import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeId } from './jsonFile';
import { resolveDataDir } from './paths';

export const FAILURE_KINDS = { screenshots: 'png', html: 'html', logs: 'json' } as const;
export type FailureKind = keyof typeof FAILURE_KINDS;

export interface FailurePackage {
  id: string;
  screenshot?: Buffer;
  html?: string;
  log: unknown;
}

/** data/failures/{screenshots,html,logs}/<failureId>.<ext>: what was on screen when a collection failed. */
export function createFailureStore(dataDir: string = resolveDataDir()) {
  const root = join(dataDir, 'failures');
  const pathOf = (kind: FailureKind, id: string) => join(root, kind, `${assertSafeId(id)}.${FAILURE_KINDS[kind]}`);

  return {
    async save(pkg: FailurePackage): Promise<{ id: string; files: Partial<Record<FailureKind, string>> }> {
      const files: Partial<Record<FailureKind, string>> = {};
      const write = async (kind: FailureKind, data: string | Buffer) => {
        const path = pathOf(kind, pkg.id);
        await mkdir(join(root, kind), { recursive: true });
        await writeFile(path, data);
        files[kind] = path;
      };
      if (pkg.screenshot) await write('screenshots', pkg.screenshot);
      if (pkg.html !== undefined) await write('html', pkg.html);
      await write('logs', JSON.stringify(pkg.log, null, 2) + '\n');
      return { id: pkg.id, files };
    },

    /** Returns null when the file does not exist. */
    async read(kind: FailureKind, id: string): Promise<Buffer | null> {
      try {
        return await readFile(pathOf(kind, id));
      } catch {
        return null;
      }
    },
  };
}
export type FailureStore = ReturnType<typeof createFailureStore>;
