import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** CRUISE_DATA_DIR wins; otherwise `<repo root>/data`, found by walking up to pnpm-workspace.yaml. */
export function resolveDataDir(): string {
  if (process.env.CRUISE_DATA_DIR) return resolve(process.env.CRUISE_DATA_DIR);
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, 'data');
    const parent = dirname(dir);
    if (parent === dir) return resolve('data');
    dir = parent;
  }
}
