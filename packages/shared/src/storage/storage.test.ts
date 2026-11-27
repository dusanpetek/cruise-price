import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makePricing } from '@cruise/domain';
import type { CollectionRun, DailyReport } from '@cruise/domain';
import {
  CollectorLockedError,
  NotFoundError,
  SnapshotExistsError,
  createCollectorLock,
  createFailureStore,
  createReportStore,
  createRouteStore,
  createSearchCacheStore,
  createRunStore,
  createSnapshotStore,
  createStores,
  resolveDataDir,
  sha256,
  stableStringify,
} from './index';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cruise-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const routeInput = { name: 'Fjords', provider: 'aida', url: 'https://www.aida.de/x' } as const;

describe('routeStore', () => {
  it('persists routes across store instances (restart)', async () => {
    const created = await createRouteStore(dir).create(routeInput);
    expect(await createRouteStore(dir).list()).toEqual([created]);
  });

  it('updates and deletes', async () => {
    const store = createRouteStore(dir);
    const r = await store.create(routeInput);
    const updated = await store.update(r.id, { ...routeInput, name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.createdAt).toBe(r.createdAt);
    await store.remove(r.id);
    expect(await store.list()).toEqual([]);
    await expect(store.get(r.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a URL that does not belong to the provider', async () => {
    await expect(createRouteStore(dir).create({ ...routeInput, url: 'https://www.meinschiff.com/x' })).rejects.toThrow();
  });

  it('rejects ids that could escape the data directory', async () => {
    await expect(createRouteStore(dir).get('../../etc/passwd')).rejects.toThrow(/Invalid id/);
  });
});

describe('routeStore favorite', () => {
  it('stores, keeps through edits, clears, and loads old route files without it', async () => {
    const store = createRouteStore(dir);
    const route = await store.create(routeInput);
    expect(route.favorite).toBeNull();

    const fav = await store.setFavorite(route.id, { fareCode: 'PREMIUM', cabin: 'Balkonkabine' });
    expect(fav.favorite).toEqual({ fareCode: 'PREMIUM', cabin: 'Balkonkabine' });
    expect((await store.update(route.id, { ...routeInput, name: 'Renamed' })).favorite).toEqual(fav.favorite);
    expect((await store.get(route.id)).favorite).toEqual(fav.favorite);

    expect((await store.setFavorite(route.id, { fareCode: 'CLASSIC', cabin: null })).favorite).toEqual({ fareCode: 'CLASSIC', cabin: null });
    expect((await store.setFavorite(route.id, { fareCode: null, cabin: null })).favorite).toBeNull();
    expect((await store.setFavorite(route.id, null)).favorite).toBeNull();
    await expect(store.setFavorite(route.id, { fareCode: '', cabin: null })).rejects.toThrow();

    const { favorite: _f, ...old } = route;
    await writeFile(join(dir, 'routes', `${route.id}.json`), JSON.stringify(old));
    expect((await store.get(route.id)).favorite).toBeNull();
  });
});

describe('searchCacheStore', () => {
  it('keeps an entry, reads a missing or damaged one as nothing, and rejects unsafe keys', async () => {
    const store = createSearchCacheStore(dir);
    expect(await store.read('aida')).toBeNull();
    await store.write('aida', { fetchedAt: '2026-11-19T08:00:00.000Z', results: [1, 2] });
    expect(await store.read('aida')).toEqual({ fetchedAt: '2026-11-19T08:00:00.000Z', results: [1, 2] });
    await writeFile(join(dir, 'cache', 'route-search', 'mein-schiff_any_any.json'), '{not json');
    expect(await store.read('mein-schiff_any_any')).toBeNull();
    await expect(store.read('../notifications')).rejects.toThrow(/Invalid id/);
    await store.ensure();
  });

  it('prunes entries that are older than the limit, damaged, or without a date', async () => {
    const store = createSearchCacheStore(dir);
    expect(await store.prune(1000)).toBe(0); // no folder yet
    await store.write('old', { fetchedAt: '2026-11-01T00:00:00.000Z' });
    await store.write('new', { fetchedAt: '2026-11-19T07:00:00.000Z' });
    await store.write('nodate', { results: [] });
    await writeFile(join(dir, 'cache', 'route-search', 'broken.json'), 'x');
    expect(await store.prune(24 * 3_600_000, Date.parse('2026-11-19T08:00:00Z'))).toBe(3);
    expect(await store.read('new')).not.toBeNull();
    expect(await store.read('old')).toBeNull();
  });
});

describe('snapshotStore', () => {
  const input = { routeId: 'r1', source: 'manual', packagePrice: 1000, flightSurcharge: 200 } as const;

  it('stores one file per snapshot and lists oldest first', async () => {
    const store = createSnapshotStore(dir);
    await store.create({ ...input, collectedAt: '2026-01-02T00:00:00.000Z' });
    await store.create({ ...input, collectedAt: '2026-01-01T00:00:00.000Z' });
    expect(await readdir(join(dir, 'snapshots', 'r1'))).toHaveLength(2);
    expect((await store.listByRoute('r1')).map((s) => s.collectedAt)).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z']);
  });

  it('stores v4 snapshots with a checksum and the full pricing block', async () => {
    const s = await createSnapshotStore(dir).create(input);
    expect(s).toMatchObject({ schemaVersion: 5, provider: null, cabins: [], fares: [], options: [], pricing: { cruiseTotal: 1000, flightTotal: 200, tripTotal: 1200, tripPerPerson: 600 } });
    expect(s.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never overwrites an existing snapshot', async () => {
    const store = createSnapshotStore(dir);
    const first = await store.create(input);
    await expect(store.append({ ...first, packagePrice: 1, pricing: makePricing({ passengers: 2, cruiseTotal: 1, flightTotal: first.flightSurcharge }) })).rejects.toBeInstanceOf(SnapshotExistsError);
    expect((await store.listByRoute('r1'))[0]!.packagePrice).toBe(1000);
  });

  it('returns an empty list for unknown routes', async () => {
    expect(await createSnapshotStore(dir).listByRoute('nope')).toEqual([]);
  });

  describe('validation and corruption', () => {
    it('rejects invalid snapshots before anything is written', async () => {
      const store = createSnapshotStore(dir);
      await expect(store.create({ ...input, packagePrice: -5 })).rejects.toThrow();
      await expect(store.create({ ...input, collectedAt: 'not-a-date' })).rejects.toThrow();
      await expect(store.create({ ...input, currency: 'EURO' })).rejects.toThrow();
      expect(await store.listByRoute('r1')).toEqual([]);
    });

    it('rejects a snapshot whose headline disagrees with its pricing block', async () => {
      const store = createSnapshotStore(dir);
      const ok = await store.create(input);
      const { checksum: _c, ...rest } = ok;
      await expect(store.append({ ...rest, id: 'other', packagePrice: 5 })).rejects.toThrow();
    });

    it('detects a file edited after it was written', async () => {
      const store = createSnapshotStore(dir);
      const s = await store.create(input);
      const file = join(dir, 'snapshots', 'r1', `${s.id}.json`);
      await writeFile(file, (await readFile(file, 'utf8')).replace('"packagePrice": 1000', '"packagePrice": 1'));
      const { snapshots, corrupt } = await store.inspect('r1');
      expect(snapshots).toEqual([]);
      expect(corrupt).toEqual([{ file, reason: expect.stringContaining('checksum mismatch') }]);
    });

    it('detects truncated JSON and schema violations, and keeps the good files', async () => {
      const store = createSnapshotStore(dir);
      await store.create(input);
      const folder = join(dir, 'snapshots', 'r1');
      await writeFile(join(folder, 'truncated.json'), '{"schemaVersion": 2, "id":');
      await writeFile(join(folder, 'wrong-shape.json'), JSON.stringify({ schemaVersion: 2, id: 'x' }));
      const { snapshots, corrupt } = await store.inspect('r1');
      expect(snapshots).toHaveLength(1);
      expect(corrupt.map((c) => c.reason)).toEqual([expect.stringContaining('unreadable JSON'), expect.stringContaining('schema validation failed')]);
      expect(await store.listByRoute('r1')).toHaveLength(1); // corrupt files are skipped with a warning
    });

    it('reads legacy v1 files (no schemaVersion, no checksum) and upgrades them in memory', async () => {
      const folder = join(dir, 'snapshots', 'r1');
      const v1 = { id: 'legacy', routeId: 'r1', collectedAt: '2026-01-01T00:00:00.000Z', source: 'mock', currency: 'EUR', packagePrice: 1234, flightSurcharge: 250 };
      await createSnapshotStore(dir).create(input); // creates the folder
      await writeFile(join(folder, 'legacy.json'), JSON.stringify(v1));
      const legacy = (await createSnapshotStore(dir).listByRoute('r1')).find((s) => s.id === 'legacy')!;
      expect(legacy).toMatchObject({ schemaVersion: 5, packagePrice: 1234, cabins: [], fares: [], options: [], pricing: { cruiseTotal: 1234, flightTotal: 250, tripTotal: 1484 } });
      expect(JSON.parse(await readFile(join(folder, 'legacy.json'), 'utf8')).schemaVersion).toBeUndefined(); // file untouched
    });
  });
});

describe('stableStringify / sha256', () => {
  it('is independent of key order and ignores undefined', () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }], z: undefined })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(sha256({ a: 1, b: 2 })).toBe(sha256({ b: 2, a: 1 }));
    expect(sha256({ a: 1 })).not.toBe(sha256({ a: 2 }));
  });
});

const run = (id: string, startedAt: string): CollectionRun => ({
  id,
  trigger: 'manual',
  startedAt,
  finishedAt: startedAt,
  results: [{ routeId: 'r', routeName: 'R', provider: 'aida', status: 'success', durationMs: 5, snapshotId: 's', error: null, failureId: null }],
});

describe('runStore', () => {
  it('lists runs newest first, honours the limit and is append-only', async () => {
    const store = createRunStore(dir);
    await store.append(run('a', '2026-01-01T00:00:00.000Z'));
    await store.append(run('b', '2026-01-03T00:00:00.000Z'));
    await store.append(run('c', '2026-01-02T00:00:00.000Z'));
    expect((await store.list()).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect((await store.list(2)).map((r) => r.id)).toEqual(['b', 'c']);
    await expect(store.append(run('a', '2026-02-01T00:00:00.000Z'))).rejects.toThrow();
  });

  it('is empty without a runs folder and skips unreadable files', async () => {
    expect(await createRunStore(dir).list()).toEqual([]);
    await createRunStore(dir).append(run('a', '2026-01-01T00:00:00.000Z'));
    await writeFile(join(dir, 'runs', 'junk.json'), 'not json');
    expect(await createRunStore(dir).list()).toHaveLength(1);
  });

  it('rejects invalid run records', async () => {
    await expect(createRunStore(dir).append({ ...run('x', 'nope') })).rejects.toThrow();
  });
});

describe('reportStore', () => {
  const report: DailyReport = {
    date: '2026-01-01',
    generatedAt: '2026-01-01T12:00:00.000Z',
    runs: 1,
    collections: 2,
    successes: 1,
    failures: 1,
    successRate: 0.5,
    averageDurationMs: 100,
    providers: { aida: { collections: 2, successes: 1, failures: 1, averageDurationMs: 100 } },
  };

  it('writes daily-report.json plus a dated archive and reads the latest back', async () => {
    const store = createReportStore(dir);
    expect(await store.readDaily()).toBeNull();
    await store.writeDaily(report);
    expect(await store.readDaily()).toEqual(report);
    expect((await readdir(join(dir, 'reports'))).sort()).toEqual(['daily-2026-01-01.json', 'daily-report.json']);
  });

  it('refuses an invalid report', async () => {
    await expect(createReportStore(dir).writeDaily({ ...report, generatedAt: 'x' })).rejects.toThrow();
  });
});

describe('failureStore', () => {
  it('saves screenshot, html and log under failures/{screenshots,html,logs}', async () => {
    const store = createFailureStore(dir);
    const saved = await store.save({ id: 'f1', screenshot: Buffer.from('png-bytes'), html: '<html>x</html>', log: { error: 'boom' } });
    expect(Object.keys(saved.files).sort()).toEqual(['html', 'logs', 'screenshots']);
    expect((await store.read('screenshots', 'f1'))?.toString()).toBe('png-bytes');
    expect((await store.read('html', 'f1'))?.toString()).toBe('<html>x</html>');
    expect(JSON.parse((await store.read('logs', 'f1'))!.toString())).toEqual({ error: 'boom' });
  });

  it('works with only a log, returns null for missing files and rejects unsafe ids', async () => {
    const store = createFailureStore(dir);
    expect((await store.save({ id: 'f2', log: {} })).files).toEqual({ logs: expect.any(String) });
    expect(await store.read('screenshots', 'f2')).toBeNull();
    await expect(store.save({ id: '../x', log: {} })).rejects.toThrow(/Invalid id/);
  });
});

describe('collectorLock', () => {
  it('lets only one holder in at a time and frees the lock on release', async () => {
    const lock = createCollectorLock(dir);
    const release = await lock.acquire();
    await expect(lock.acquire()).rejects.toBeInstanceOf(CollectorLockedError);
    await release();
    await (await lock.acquire())();
  });

  it('takes over a lock whose process has died', async () => {
    await writeFile(join(dir, 'collector.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: new Date().toISOString() }));
    await (await createCollectorLock(dir).acquire())();
  });

  it('takes over an old lock even if the process looks alive, and an unreadable one', async () => {
    const lock = createCollectorLock(dir, 1000);
    await writeFile(join(dir, 'collector.lock'), JSON.stringify({ pid: process.pid, startedAt: '2020-01-01T00:00:00.000Z' }));
    await (await lock.acquire(new Date()))();
    await writeFile(join(dir, 'collector.lock'), 'garbage');
    await (await lock.acquire())();
  });

  it('reports who holds a live lock', async () => {
    const lock = createCollectorLock(dir);
    const release = await lock.acquire();
    await expect(lock.acquire()).rejects.toMatchObject({ holder: { pid: process.pid } });
    await release();
  });

  it('does not delete a lock it no longer owns', async () => {
    const lock = createCollectorLock(dir);
    const release = await lock.acquire();
    await writeFile(join(dir, 'collector.lock'), JSON.stringify({ pid: 1, startedAt: new Date().toISOString() }));
    await release();
    expect(await readFile(join(dir, 'collector.lock'), 'utf8')).toContain('"pid":1');
  });
});

describe('data directory', () => {
  it('honours CRUISE_DATA_DIR', () => {
    const before = process.env.CRUISE_DATA_DIR;
    process.env.CRUISE_DATA_DIR = dir;
    try {
      expect(resolveDataDir()).toBe(dir);
      expect(createStores().dataDir).toBe(dir);
    } finally {
      if (before === undefined) delete process.env.CRUISE_DATA_DIR;
      else process.env.CRUISE_DATA_DIR = before;
    }
  });

  it('falls back to <repo>/data', () => {
    const before = process.env.CRUISE_DATA_DIR;
    delete process.env.CRUISE_DATA_DIR;
    try {
      const resolved = resolveDataDir();
      expect(resolved).toMatch(/[\\/]data$/);
      expect(existsSync(join(resolved, '..', 'pnpm-workspace.yaml'))).toBe(true);
    } finally {
      if (before !== undefined) process.env.CRUISE_DATA_DIR = before;
    }
  });
});
