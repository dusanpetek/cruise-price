import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CollectorLockedError } from './errors';
import { resolveDataDir } from './paths';

interface LockInfo {
  pid: number;
  startedAt: string;
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * data/collector.lock prevents overlapping collections (scheduler vs. manual vs. CLI).
 * A lock whose process has died, or that is older than `staleMs`, is taken over.
 */
export function createCollectorLock(dataDir: string = resolveDataDir(), staleMs = 30 * 60_000) {
  const path = join(dataDir, 'collector.lock');

  async function tryCreate(info: LockInfo): Promise<boolean> {
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, JSON.stringify(info), { flag: 'wx' });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e;
    }
  }

  async function readHolder(): Promise<LockInfo | null> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as LockInfo;
      return typeof parsed.pid === 'number' && typeof parsed.startedAt === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  return {
    /** Returns a release function, or throws CollectorLockedError. */
    async acquire(now = new Date()): Promise<() => Promise<void>> {
      const info: LockInfo = { pid: process.pid, startedAt: now.toISOString() };
      if (!(await tryCreate(info))) {
        const holder = await readHolder();
        const stale = !holder || !isAlive(holder.pid) || now.getTime() - Date.parse(holder.startedAt) > staleMs;
        if (!stale) throw new CollectorLockedError(holder);
        await rm(path, { force: true });
        if (!(await tryCreate(info))) throw new CollectorLockedError((await readHolder()) ?? info);
      }
      return async () => {
        const holder = await readHolder();
        if (holder?.pid === process.pid) await rm(path, { force: true });
      };
    },
  };
}
export type CollectorLock = ReturnType<typeof createCollectorLock>;
