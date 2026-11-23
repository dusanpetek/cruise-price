import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Ids become file names, so reject anything that could escape the data directory. */
export function assertSafeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid id: ${id}`);
  return id;
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Replace-in-place write (temp file + rename) so a crash never leaves a half-written file. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await rename(tmp, path);
}

/** Create-only write: fails with EEXIST if the file is already there. */
export async function writeJsonExclusive(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
