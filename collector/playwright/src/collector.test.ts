import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionRun, Route } from '@cruise/domain';
import { CollectorLockedError, createStores, type Stores } from '@cruise/shared/storage';
import type { BrowserFactory } from './browser/browserFactory';
import { createPageSession } from './browser/browserFactory';
import { collectRoutes } from './collection/batch';
import { buildSnapshotInput } from './collection/snapshotBuilder';
import type { CollectedCruise, CruiseProviderCollector } from './collection/types';
import { MockCollector } from './collectors/MockCollector';
import { mockCruise } from './collectors/mockPrice';
import { ProviderRegistry, UnsupportedProviderError, collectorModeFromEnv, createProviderRegistry, providerRegistry } from './providers/providerRegistry';
import { runCollection } from './runner/collectionRunner';
import { DEFAULT_CRON, collectAll, scheduleCollections } from './scheduler';
import { seedDemoData } from './seed';

let dir: string;
let stores: Stores;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cruise-'));
  stores = createStores(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const mockRegistry = createProviderRegistry('mock');
const aidaRoute = (stores: Stores) => stores.routes.create({ name: 'A', provider: 'aida', url: 'https://aida.de/finden/CO07270313/CLASSIC' });
const msRoute = (stores: Stores) => stores.routes.create({ name: 'M', provider: 'mein-schiff', url: 'https://www.meinschiff.com/de/trips/x' });

/** A browser that is just enough like Playwright's for the runner's failure capture. */
function fakeBrowser(opts: { closed?: boolean } = {}) {
  const page = {
    screenshot: vi.fn(async () => Buffer.from('PNG')),
    content: vi.fn(async () => '<html>page</html>'),
    title: vi.fn(async () => 'Title'),
    url: () => 'https://aida.de/page',
    isClosed: () => opts.closed ?? false,
  } as unknown as Page;
  const close = vi.fn(async () => undefined);
  const browser = { newPage: vi.fn(async () => page), close } as unknown as Browser;
  const factory: BrowserFactory = { launch: vi.fn(async () => browser) };
  return { factory, close, page };
}

const failingCollector = (message: string, usePage = true): CruiseProviderCollector => ({
  id: 'aida',
  label: 'Failing',
  source: 'live',
  headless: true,
  matches: () => true,
  collect: async (ctx) => {
    if (usePage) await ctx.getPage();
    await ctx.diagnostics.step('click-something', async () => {
      throw new Error(message);
    });
    throw new Error('unreachable');
  },
});

describe('providerRegistry', () => {
  it('picks the provider from the URL', () => {
    expect(mockRegistry.resolve('https://www.aida.de/kreuzfahrt/x').id).toBe('aida');
    expect(mockRegistry.resolve('https://meinschiff.com/reisen').id).toBe('mein-schiff');
    expect(mockRegistry.resolve('https://www.tuicruises.com/x').id).toBe('mein-schiff');
  });

  it('throws for unknown or lookalike hosts', () => {
    expect(() => mockRegistry.resolve('https://example.com')).toThrow(UnsupportedProviderError);
    expect(() => mockRegistry.resolve('https://notaida.de')).toThrow(UnsupportedProviderError);
    expect(() => mockRegistry.resolve('not a url')).toThrow(UnsupportedProviderError);
  });

  it('looks collectors up by id and lists them', () => {
    expect(mockRegistry.get('aida')?.label).toBe('AIDA (mock)');
    expect(new ProviderRegistry([]).get('aida')).toBeUndefined();
    expect(mockRegistry.list()).toHaveLength(2);
  });

  it('builds live collectors by default: AIDA needs a visible window, Mein Schiff runs headless', () => {
    const live = createProviderRegistry('live');
    expect(live.get('aida')).toMatchObject({ source: 'live', headless: false });
    expect(live.get('mein-schiff')).toMatchObject({ source: 'live', headless: true });
    expect(providerRegistry.list()).toHaveLength(2);
  });

  it('chooses the mode from COLLECTOR_MODE', () => {
    expect(collectorModeFromEnv({ COLLECTOR_MODE: 'mock' })).toBe('mock');
    expect(collectorModeFromEnv({ COLLECTOR_MODE: 'live' })).toBe('live');
    expect(collectorModeFromEnv({})).toBe('live');
  });
});

describe('snapshotBuilder', () => {
  const collected: CollectedCruise = {
    currency: 'EUR',
    cruise: { name: 'N', ship: 'S', departure: '2027-03-13', durationNights: 7 },
    party: { adults: 2, departureAirport: 'FRA' },
    cabins: [
      { category: 'Balcony', packagePerPerson: 1029, flightPerPerson: 590 },
      { category: 'Inside', packagePerPerson: 649.5, flightPerPerson: 590 },
    ],
  };
  const args = { routeId: 'r', provider: 'aida', source: 'live', collectedAt: '2026-01-01T00:00:00.000Z', collected } as const;

  it('computes party totals and uses the cheapest cabin as the headline, flight kept separate', () => {
    const input = buildSnapshotInput(args);
    expect(input.cabins![1]).toEqual({ category: 'Inside', packagePerPerson: 649.5, flightPerPerson: 590, packageTotal: 1299, flightTotal: 1180, mandatoryFees: 0, tripPerPerson: 1239.5, tripTotal: 2479 });
    expect(input).toMatchObject({ packagePrice: 1299, flightSurcharge: 1180, mandatoryFees: 0, provider: 'aida', source: 'live', party: { adults: 2, departureAirport: 'FRA' } });
  });

  it('makes the cheapest TRIP the headline: a dearer flight on the cheaper cruise loses', () => {
    const input = buildSnapshotInput({
      ...args,
      collected: { ...collected, cabins: [{ category: 'A', packagePerPerson: 1000, flightPerPerson: 600 }, { category: 'B', packagePerPerson: 1100, flightPerPerson: 100 }] },
    });
    expect(input).toMatchObject({ packagePrice: 2200, flightSurcharge: 200 }); // B: trip 2400 beats A: trip 3200
  });

  it('refuses a collection without cabins', () => {
    expect(() => buildSnapshotInput({ ...args, collected: { ...collected, cabins: [] } })).toThrow(/No cabin prices/);
  });
});

describe('mock collection', () => {
  it('is deterministic per minute and varies over time', () => {
    const at = new Date('2026-06-01T10:00:00Z');
    expect(mockCruise('aida', 'https://aida.de/x', at)).toEqual(mockCruise('aida', 'https://aida.de/x', at));
    expect(mockCruise('aida', 'https://aida.de/x', at)).not.toEqual(mockCruise('aida', 'https://aida.de/x', new Date('2026-06-12T10:00:00Z')));
    expect(mockCruise('mein-schiff', 'https://meinschiff.com/x', at).cabins.length).toBeGreaterThan(1);
  });

  it('matches only its own provider', () => {
    expect(new MockCollector('aida').matches('https://aida.de/x')).toBe(true);
    expect(new MockCollector('aida').matches('https://meinschiff.com/x')).toBe(false);
  });
});

describe('page session', () => {
  it('launches lazily with the requested mode, reuses the page and closes the browser', async () => {
    const { factory, close } = fakeBrowser();
    const session = createPageSession(factory, { headless: false });
    expect(session.peekPage()).toBeUndefined();
    const page = await session.getPage();
    expect(await session.getPage()).toBe(page);
    expect(factory.launch).toHaveBeenCalledTimes(1);
    expect(factory.launch).toHaveBeenCalledWith({ headless: false });
    await session.close();
    expect(close).toHaveBeenCalled();
    expect(session.peekPage()).toBeUndefined();
  });

  it('close is safe when nothing was launched', async () => {
    await createPageSession({ launch: vi.fn() as never }).close();
  });
});

describe('collection runner', () => {
  const noBrowser: BrowserFactory = { launch: () => Promise.reject(new Error('browser must not start for mock collectors')) };

  it('stores a complete snapshot with diagnostics, without launching a browser', async () => {
    const route = await aidaRoute(stores);
    const { snapshot, diagnostics, result } = await runCollection(route, { snapshots: stores.snapshots, failures: stores.failures, registry: mockRegistry, browserFactory: noBrowser });

    expect(diagnostics.status).toBe('success');
    expect(diagnostics.steps.map((s) => s.name)).toEqual(['resolve-provider', 'aida:mock-price', 'collect', 'store-snapshot']);
    expect(snapshot).toMatchObject({ routeId: route.id, source: 'mock', provider: 'aida', schemaVersion: 4, party: { adults: 2, departureAirport: 'FRA' } });
    expect(snapshot!.cabins.length).toBeGreaterThan(1);
    expect(snapshot!.packagePrice).toBe(Math.min(...snapshot!.cabins.map((c) => c.packageTotal)));
    // every cabin x fare, always as cruise + flight = total
    expect(snapshot!.fares.map((f) => f.fareCode)).toEqual(['CLASSIC', 'PREMIUM', 'PREMIUM_ALL_IN']);
    expect(snapshot!.options.length).toBe(8); // 3 cabins x 3 fares, PREMIUM ALL IN not offered for the inside cabin
    expect(snapshot!.options.every((o) => o.flightCode === 'FRA' && o.cruisePrice + o.flightPrice === o.totalPrice)).toBe(true);
    expect(snapshot!.options.some((o) => o.cabinCategory === 'Innenkabine' && o.fareCode === 'PREMIUM_ALL_IN')).toBe(false);
    // a cabin's headline is its cheapest fare
    for (const c of snapshot!.cabins) expect(c.packageTotal).toBe(Math.min(...snapshot!.options.filter((o) => o.cabinCategory === c.category).map((o) => o.cruisePrice)));
    expect(await stores.snapshots.listByRoute(route.id)).toEqual([snapshot]);
    expect(result).toMatchObject({ status: 'success', provider: 'aida', snapshotId: snapshot!.id, error: null, failureId: null });
  });

  it('reports an unsupported URL as a failure without a browser, and writes a log-only failure package', async () => {
    const route: Route = { id: 'r1', name: 'X', provider: 'aida', url: 'https://example.com', favorite: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const { snapshot, diagnostics, result } = await runCollection(route, { snapshots: stores.snapshots, failures: stores.failures, registry: mockRegistry });
    expect(snapshot).toBeNull();
    expect(diagnostics).toMatchObject({ status: 'failed', provider: null });
    expect(diagnostics.error).toMatch(/No provider/);
    expect(diagnostics.failure?.screenshot).toBeUndefined();
    expect(diagnostics.failure?.log).toMatch(/failures\/logs\//);
    expect(result).toMatchObject({ status: 'failed', provider: null, snapshotId: null, failureId: diagnostics.failure!.id });
    expect(await stores.snapshots.listByRoute('r1')).toEqual([]);
  });

  it('rejects a malformed route', async () => {
    const { diagnostics } = await runCollection({ id: '', name: '', provider: 'aida', url: 'x' } as unknown as Route, { snapshots: stores.snapshots });
    expect(diagnostics.status).toBe('failed');
  });

  it('leaves a full diagnostics package on failure: PNG, HTML dump, error context, timings', async () => {
    const route = await aidaRoute(stores);
    const { factory, close } = fakeBrowser();
    const registry = new ProviderRegistry([failingCollector('selector not found')]);
    const { diagnostics } = await runCollection(route, { snapshots: stores.snapshots, failures: stores.failures, registry, browserFactory: factory });

    expect(diagnostics).toMatchObject({ status: 'failed', error: 'selector not found' });
    expect(close).toHaveBeenCalled(); // browser is closed even on failure
    const failure = diagnostics.failure!;
    expect(await readFile(failure.screenshot!, 'utf8')).toBe('PNG');
    expect(await readFile(failure.html!, 'utf8')).toBe('<html>page</html>');
    const log = JSON.parse(await readFile(failure.log, 'utf8'));
    expect(log).toMatchObject({
      routeId: route.id,
      routeName: 'A',
      provider: 'aida',
      error: { message: 'selector not found' },
      page: { url: 'https://aida.de/page', title: 'Title' },
    });
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
    expect(log.steps.map((s: { name: string; ok: boolean }) => [s.name, s.ok])).toEqual([
      ['resolve-provider', true],
      ['click-something', false],
      ['collect', false],
    ]);
  });

  it('skips the screenshot when the page is already closed, and survives capture errors', async () => {
    const route = await aidaRoute(stores);
    const closed = fakeBrowser({ closed: true });
    const registry = new ProviderRegistry([failingCollector('boom')]);
    const a = await runCollection(route, { snapshots: stores.snapshots, failures: stores.failures, registry, browserFactory: closed.factory });
    expect(a.diagnostics.failure?.screenshot).toBeUndefined();

    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...stores.failures, save: async () => Promise.reject(new Error('disk full')) };
    const b = await runCollection(route, { snapshots: stores.snapshots, failures: broken, registry, browserFactory: fakeBrowser().factory });
    expect(b.diagnostics).toMatchObject({ status: 'failed', error: 'boom' });
    expect(b.diagnostics.failure).toBeUndefined();
    errors.mockRestore();
  });

  it('still reports the failure without a failure store', async () => {
    const route = await aidaRoute(stores);
    const { diagnostics } = await runCollection(route, { snapshots: stores.snapshots, registry: new ProviderRegistry([failingCollector('x', false)]) });
    expect(diagnostics).toMatchObject({ status: 'failed' });
    expect(diagnostics.failure).toBeUndefined();
  });
});

describe('once per route and day', () => {
  /** The mock collectors, but their snapshots count as real (live) prices. */
  const liveRegistry = new ProviderRegistry(mockRegistry.list().map((c) => Object.assign(Object.create(c) as CruiseProviderCollector, { source: 'live' as const })));
  const at = (iso: string) => () => new Date(iso);

  it('collects a route once per day and skips it afterwards, without recording an empty run', async () => {
    const route = await aidaRoute(stores);
    const lines: string[] = [];
    const first = await collectRoutes([route], { stores, registry: liveRegistry }, { trigger: 'manual', now: at('2026-11-17T07:00:00.000Z') });
    expect(first.outcomes).toHaveLength(1);
    expect(first.skipped).toEqual([]);

    const second = await collectRoutes([route], { stores, registry: liveRegistry }, { trigger: 'scheduled', now: at('2026-11-17T19:00:00.000Z'), log: (l) => lines.push(l) });
    expect(second.outcomes).toEqual([]);
    expect(second.skipped.map((r) => r.id)).toEqual([route.id]);
    expect(second.run.results).toEqual([]);
    expect(lines).toContain('skipping A: already collected today');
    expect(await stores.runs.list()).toHaveLength(1); // only the real collection
    expect(await stores.snapshots.listByRoute(route.id)).toHaveLength(1);
  });

  it('collects again the next day, and collects the routes that are still due', async () => {
    const [a, m] = [await aidaRoute(stores), await msRoute(stores)];
    await collectRoutes([a], { stores, registry: liveRegistry }, { trigger: 'manual', now: at('2026-11-17T07:00:00.000Z') });

    const sameDay = await collectRoutes([a, m], { stores, registry: liveRegistry }, { trigger: 'manual', now: at('2026-11-17T12:00:00.000Z') });
    expect(sameDay.skipped.map((r) => r.id)).toEqual([a.id]);
    expect(sameDay.outcomes.map((o) => o.result.routeId)).toEqual([m.id]);

    const nextDay = await collectRoutes([a, m], { stores, registry: liveRegistry }, { trigger: 'manual', now: at('2026-11-18T07:00:00.000Z') });
    expect(nextDay.skipped).toEqual([]);
    expect(nextDay.outcomes).toHaveLength(2);
  });

  it('does not count failed attempts, manual snapshots or mock data as the day\'s price', async () => {
    const route = await aidaRoute(stores);
    const failing = new ProviderRegistry([failingCollector('boom', false)]);
    const now = at('2026-11-17T07:00:00.000Z');
    expect((await collectRoutes([route], { stores, registry: failing }, { trigger: 'manual', now })).outcomes).toHaveLength(1);
    await stores.snapshots.create({ routeId: route.id, source: 'manual', packagePrice: 1, flightSurcharge: 1, collectedAt: '2026-11-17T06:00:00.000Z' } as never);
    const viaMock = await collectRoutes([route], { stores, registry: mockRegistry }, { trigger: 'manual', now });
    expect(viaMock.skipped).toEqual([]);
    const again = await collectRoutes([route], { stores, registry: mockRegistry }, { trigger: 'manual', now });
    expect(again.skipped).toEqual([]); // mock collections are not limited
  });
});

describe('cruises that leave in more than six months: at most once a week', () => {
  const liveRegistry = new ProviderRegistry(mockRegistry.list().map((c) => Object.assign(Object.create(c) as CruiseProviderCollector, { source: 'live' as const })));
  const at = (iso: string) => () => new Date(iso);
  /** A real price collected on `day`, for a cruise that leaves on `departure`. */
  const priceOf = (routeId: string, day: string, departure: string) =>
    stores.snapshots.create({ routeId, provider: 'aida', source: 'live', collectedAt: `${day}T07:00:00.000Z`, cruise: { name: 'N', ship: 'S', departure, durationNights: 7 }, packagePrice: 1000, flightSurcharge: 200 });

  it('leaves such a route out of the general collection until a week has passed, and collects the others', async () => {
    const [far, near] = [await aidaRoute(stores), await msRoute(stores)];
    await priceOf(far.id, '2026-11-17', '2027-09-04'); // leaves in more than six months, collected 3 days ago
    await priceOf(near.id, '2026-11-17', '2027-03-13'); // leaves within six months: a day is enough
    const lines: string[] = [];
    const run = await collectRoutes([far, near], { stores, registry: liveRegistry }, { trigger: 'scheduled', now: at('2026-11-20T07:00:00.000Z'), log: (l) => lines.push(l) });
    expect(run.outcomes.map((o) => o.result.routeId)).toEqual([near.id]);
    expect(run.skipped.map((r) => r.id)).toEqual([far.id]);
    expect(run.skippedDetail).toEqual([{ route: far, reason: 'weekly', lastDay: '2026-11-17', nextDay: '2026-11-24' }]);
    expect(lines).toContain('skipping A: leaves in more than 6 months, collected weekly (next from 2026-11-24)');
    expect(await stores.snapshots.listByRoute(far.id)).toHaveLength(1);
  });

  it('collects it again on the seventh day, and records a run when only that route was due', async () => {
    const far = await aidaRoute(stores);
    await priceOf(far.id, '2026-11-17', '2027-09-04');
    const early = await collectRoutes([far], { stores, registry: liveRegistry }, { trigger: 'manual', now: at('2026-11-23T20:00:00.000Z') });
    expect(early.outcomes).toEqual([]);
    expect(early.run.results).toEqual([]);
    expect(await stores.runs.list()).toEqual([]); // nothing was collected: no run
    const due = await collectRoutes([far], { stores, registry: liveRegistry }, { trigger: 'scheduled', now: at('2026-11-24T07:00:00.000Z') });
    expect(due.outcomes).toHaveLength(1);
    expect(due.skipped).toEqual([]);
    expect(await stores.runs.list()).toHaveLength(1);
  });

  it('collects a far-away cruise within its week when forced, but not twice on one day', async () => {
    const far = await aidaRoute(stores);
    await priceOf(far.id, '2026-11-17', '2027-09-04');
    const forced = await collectRoutes([far], { stores, registry: liveRegistry }, { trigger: 'manual', force: true, now: at('2026-11-20T07:00:00.000Z') });
    expect(forced.outcomes).toHaveLength(1);
    expect(forced.skipped).toEqual([]);
    const again = await collectRoutes([far], { stores, registry: liveRegistry }, { trigger: 'manual', force: true, now: at('2026-11-20T19:00:00.000Z') });
    expect(again.skippedDetail[0]).toMatchObject({ reason: 'daily' }); // the daily limit stays
  });

  it('keeps the daily rule for cruises that leave within six months, exactly six months included', async () => {
    const route = await aidaRoute(stores);
    await priceOf(route.id, '2026-11-20', '2027-05-20');
    const sameDay = await collectRoutes([route], { stores, registry: liveRegistry }, { trigger: 'manual', now: at('2026-11-20T19:00:00.000Z') });
    expect(sameDay.skippedDetail[0]).toMatchObject({ reason: 'daily', nextDay: '2026-11-21' });
    const nextDay = await collectRoutes([route], { stores, registry: liveRegistry }, { trigger: 'manual', now: at('2026-11-21T07:00:00.000Z') });
    expect(nextDay.outcomes).toHaveLength(1);
  });
});

describe('collectRoutes', () => {
  it('collects sequentially, records the run and writes the daily report', async () => {
    const [a, m] = [await aidaRoute(stores), await msRoute(stores)];
    const bad = await stores.routes.create({ name: 'B', provider: 'aida', url: 'https://aida.de/x' });
    const registry = new ProviderRegistry([...mockRegistry.list(), failingCollector('nope', false)].filter((c) => c.label !== 'AIDA (mock)'));
    const lines: string[] = [];
    const now = () => new Date('2026-11-17T10:00:00.000Z');

    // aida routes hit the failing collector, mein-schiff hits its mock
    const { run, outcomes } = await collectRoutes([a, m, bad], { stores, registry }, { trigger: 'manual', now, log: (l) => lines.push(l) });

    expect(run).toMatchObject({ trigger: 'manual', startedAt: '2026-11-17T10:00:00.000Z' });
    expect(run.results.map((r) => r.status)).toEqual(['failed', 'success', 'failed']);
    expect(outcomes).toHaveLength(3);
    expect(lines.some((l) => l.includes('FAILED: nope'))).toBe(true);
    expect(lines.some((l) => l.includes('ok:'))).toBe(true);
    expect(await stores.runs.list()).toEqual([run]);

    const report = (await stores.reports.readDaily())!;
    expect(report).toMatchObject({ date: '2026-11-17', runs: 1, collections: 3, successes: 1, failures: 2 });
    expect(report.providers['mein-schiff']).toMatchObject({ collections: 1, successes: 1 });
  });

  it('pauses between routes when asked to', async () => {
    const [a, m] = [await aidaRoute(stores), await msRoute(stores)];
    const t0 = Date.now();
    await collectRoutes([a, m], { stores, registry: mockRegistry }, { trigger: 'cli', delayBetweenMs: 60 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
  });

  it('prevents overlapping runs and releases the lock afterwards', async () => {
    const route = await aidaRoute(stores);
    const release = await stores.lock.acquire();
    await expect(collectRoutes([route], { stores, registry: mockRegistry }, { trigger: 'manual' })).rejects.toBeInstanceOf(CollectorLockedError);
    expect(await stores.runs.list()).toEqual([]);
    await release();

    await collectRoutes([route], { stores, registry: mockRegistry }, { trigger: 'manual' });
    await (await stores.lock.acquire())(); // free again
  });

  it('releases the lock even if recording the run fails', async () => {
    const route = await aidaRoute(stores);
    const broken = { ...stores, runs: { ...stores.runs, append: () => Promise.reject(new Error('disk full')) } } as unknown as Stores;
    await expect(collectRoutes([route], { stores: broken, registry: mockRegistry }, { trigger: 'manual' })).rejects.toThrow('disk full');
    await (await stores.lock.acquire())();
  });

  it('does not lose the run when the report cannot be written', async () => {
    const route = await aidaRoute(stores);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...stores, reports: { ...stores.reports, writeDaily: () => Promise.reject(new Error('read-only')) } } as unknown as Stores;
    const { run } = await collectRoutes([route], { stores: broken, registry: mockRegistry }, { trigger: 'manual' });
    expect(await stores.runs.list()).toEqual([run]);
    errors.mockRestore();
  });
});

describe('scheduler', () => {
  it('collectAll runs every configured route and returns null if locked', async () => {
    await aidaRoute(stores);
    await msRoute(stores);
    const outcome = await collectAll(stores, 'scheduled', { registry: mockRegistry, delayBetweenMs: 0 });
    expect(outcome!.run).toMatchObject({ trigger: 'scheduled' });
    expect(outcome!.run.results).toHaveLength(2);

    const release = await stores.lock.acquire();
    expect(await collectAll(stores, 'scheduled', { registry: mockRegistry })).toBeNull();
    await release();
  });

  it('collectAll rethrows unexpected errors', async () => {
    const broken = { ...stores, routes: { ...stores.routes, list: () => Promise.reject(new Error('disk')) } } as unknown as Stores;
    await expect(collectAll(broken, 'cli')).rejects.toThrow('disk');
  });

  it('defaults to once a day and validates the cron expression', () => {
    expect(() => scheduleCollections(stores, 'not a cron')).toThrow(/Invalid cron/);
    const task = scheduleCollections(stores, DEFAULT_CRON, () => undefined);
    expect(DEFAULT_CRON).toBe('0 7 * * *');
    expect(task).toBeDefined();
    void task.stop();
  });
});

describe('seed', () => {
  it('seeds demo history once, as v4 snapshots with cabins', async () => {
    expect(await seedDemoData(stores, 10)).toBe(true);
    expect(await seedDemoData(stores, 10)).toBe(false);
    const [first] = await stores.routes.list();
    const history = await stores.snapshots.listByRoute(first!.id);
    expect(history).toHaveLength(11);
    expect(history[0]).toMatchObject({ source: 'mock', schemaVersion: 4 });
    expect(history[0]!.cabins.length).toBeGreaterThan(1);
    expect(history[0]!.options.length).toBeGreaterThan(3);
    expect(new Set(history.map((h) => h.fares.map((f) => f.fareCode).join()))).toHaveProperty('size', 1);
  });
});

// Keeps the type of a run record honest for the dashboard.
const _typecheck: CollectionRun['trigger'] = 'cli';
void _typecheck;

describe('AidaCollector failure handling', () => {
  it('does not leave an unhandled rejection behind when the page fails to load', async () => {
    const { AidaCollector } = await import('./collectors/AidaCollector');
    const { Diagnostics } = await import('./runner/diagnostics');
    // The response we wait for never arrives: Playwright rejects it when the page closes, after collect() has already failed.
    const page = {
      waitForResponse: () => new Promise((_, reject) => setTimeout(() => reject(new Error('Target page closed')), 20)),
      goto: async () => ({ status: () => 403 }),
    } as unknown as Page;
    const ctx = {
      url: 'https://aida.de/finden/X/CLASSIC',
      routeId: 'r',
      config: { adults: 2, airport: 'FRA' },
      diagnostics: new Diagnostics(),
      getPage: async () => page,
      now: new Date(),
    };

    await expect(new AidaCollector().collect(ctx)).rejects.toThrow('HTTP 403');
    await new Promise((r) => setTimeout(r, 80)); // vitest fails the run on an unhandled rejection
  });
});
