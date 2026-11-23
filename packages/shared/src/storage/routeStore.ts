import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { FavoriteSchema, RouteInputSchema, RouteSchema, type Favorite, type Route, type RouteInput } from '@cruise/domain';
import { newId } from '../index';
import { NotFoundError } from './errors';
import { assertSafeId, readJson, writeJsonAtomic } from './jsonFile';
import { resolveDataDir } from './paths';

export function createRouteStore(dataDir: string = resolveDataDir()) {
  const dir = join(dataDir, 'routes');
  const fileOf = (id: string) => join(dir, `${assertSafeId(id)}.json`);

  async function get(id: string): Promise<Route> {
    try {
      return RouteSchema.parse(await readJson(fileOf(id)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(`Route ${id}`);
      throw e;
    }
  }

  return {
    get,

    async list(): Promise<Route[]> {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        return [];
      }
      const routes = await Promise.all(
        files.filter((f) => f.endsWith('.json')).map(async (f) => RouteSchema.parse(await readJson(join(dir, f)))),
      );
      return routes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async create(input: RouteInput): Promise<Route> {
      const now = new Date().toISOString();
      const route: Route = { ...RouteInputSchema.parse(input), favorite: null, id: newId(), createdAt: now, updatedAt: now };
      await writeJsonAtomic(fileOf(route.id), route);
      return route;
    },

    async update(id: string, input: RouteInput): Promise<Route> {
      const existing = await get(id);
      const route: Route = { ...existing, ...RouteInputSchema.parse(input), updatedAt: new Date().toISOString() };
      await writeJsonAtomic(fileOf(id), route);
      return route;
    },

    /** Sets (or, with null or an empty choice, clears) the fare and cabin the route page opens with. */
    async setFavorite(id: string, favorite: Favorite | null): Promise<Route> {
      const existing = await get(id);
      const parsed = favorite ? FavoriteSchema.parse(favorite) : null;
      const route: Route = { ...existing, favorite: parsed && (parsed.fareCode || parsed.cabin) ? parsed : null, updatedAt: new Date().toISOString() };
      await writeJsonAtomic(fileOf(id), route);
      return route;
    },

    /** Snapshots are immutable history and are intentionally left on disk. */
    async remove(id: string): Promise<void> {
      await get(id);
      await rm(fileOf(id));
    },
  };
}
export type RouteStore = ReturnType<typeof createRouteStore>;
