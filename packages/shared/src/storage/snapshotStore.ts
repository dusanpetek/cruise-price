import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CruiseSnapshotSchema,
  SNAPSHOT_SCHEMA_VERSION,
  SnapshotInputSchema,
  parseSnapshot,
  type CruiseSnapshot,
  type SnapshotInput,
} from '@cruise/domain';
import { newId } from '../index';
import { CorruptSnapshotError, SnapshotExistsError } from './errors';
import { assertSafeId, readJson, writeJsonExclusive } from './jsonFile';
import { resolveDataDir } from './paths';
import { sha256 } from './stableJson';

export interface CorruptFile {
  file: string;
  reason: string;
}

async function readSnapshotFile(path: string): Promise<CruiseSnapshot> {
  let raw: unknown;
  try {
    raw = await readJson(path);
  } catch (e) {
    throw new CorruptSnapshotError(path, `unreadable JSON (${(e as Error).message})`);
  }
  if (typeof raw === 'object' && raw !== null && 'checksum' in raw) {
    const { checksum, ...rest } = raw as Record<string, unknown>;
    if (checksum !== sha256(rest)) throw new CorruptSnapshotError(path, 'checksum mismatch');
  }
  try {
    return parseSnapshot(raw);
  } catch (e) {
    throw new CorruptSnapshotError(path, `schema validation failed (${(e as Error).message.split('\n')[0]})`);
  }
}

/**
 * Layout: data/snapshots/<routeId>/<snapshotId>.json, written create-only (never overwritten).
 * Everything is validated with Zod before it is saved, and carries a checksum so edits or
 * truncation of a stored file are detected on read.
 */
export function createSnapshotStore(dataDir: string = resolveDataDir()) {
  const root = join(dataDir, 'snapshots');
  const routeDir = (routeId: string) => join(root, assertSafeId(routeId));

  async function append(snapshot: CruiseSnapshot): Promise<CruiseSnapshot> {
    const { checksum: _ignored, ...valid } = CruiseSnapshotSchema.parse(snapshot);
    const stored: CruiseSnapshot = { ...valid, checksum: sha256(valid) };
    try {
      await writeJsonExclusive(join(routeDir(valid.routeId), `${assertSafeId(valid.id)}.json`), stored);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new SnapshotExistsError(valid.id);
      throw e;
    }
    return stored;
  }

  /** Oldest first, plus the files that failed validation (so nothing is silently lost). */
  async function inspect(routeId: string): Promise<{ snapshots: CruiseSnapshot[]; corrupt: CorruptFile[] }> {
    const dir = routeDir(routeId);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return { snapshots: [], corrupt: [] };
    }
    const snapshots: CruiseSnapshot[] = [];
    const corrupt: CorruptFile[] = [];
    for (const f of files.filter((f) => f.endsWith('.json')).sort()) {
      try {
        snapshots.push(await readSnapshotFile(join(dir, f)));
      } catch (e) {
        corrupt.push({ file: join(dir, f), reason: (e as Error).message });
      }
    }
    snapshots.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
    return { snapshots, corrupt };
  }

  return {
    append,
    inspect,

    /** Assigns a fresh id (and timestamp, unless given) and stores the snapshot. */
    async create(input: SnapshotInput): Promise<CruiseSnapshot> {
      const parsed = SnapshotInputSchema.parse(input);
      return append({
        ...parsed,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        id: newId(),
        collectedAt: parsed.collectedAt ?? new Date().toISOString(),
      });
    },

    /** Valid snapshots only, oldest first. Corrupt files are reported, not returned. */
    async listByRoute(routeId: string): Promise<CruiseSnapshot[]> {
      const { snapshots, corrupt } = await inspect(routeId);
      for (const c of corrupt) console.warn(`[storage] ${c.reason}`);
      return snapshots;
    },
  };
}
export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
