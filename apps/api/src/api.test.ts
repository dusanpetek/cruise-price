import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderRegistry, createProviderRegistry, type BrowserFactory, type CruiseProviderCollector } from '@cruise/collector';
import { createStores, type Stores } from '@cruise/shared/storage';
import { createApiServer } from './app';

let dir: string;
let stores: Stores;
let server: Server;
let base: string;

const failing: CruiseProviderCollector = {
  id: 'aida',
  label: 'failing',
  source: 'live',
  headless: true,
  matches: () => true,
  collect: async (ctx) => {
    await ctx.getPage();
    throw new Error('selector broke');
  },
};
const fakeBrowserFactory = {
  launch: async () =>
    ({
      newPage: async () =>
        ({
          screenshot: async () => Buffer.from('PNGDATA'),
          content: async () => '<html>dump</html>',
          title: async () => 'T',
          url: () => 'https://aida.de/p',
          isClosed: () => false,
        }) as unknown as Page,
      close: async () => undefined,
    }) as unknown as Browser,
};

async function start(collection: Parameters<typeof createApiServer>[0]['collection']) {
  server = createApiServer({ stores, collection });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
}
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, body: type.includes('json') ? await res.json().catch(() => null) : await res.text() };
};

const aida = { name: 'Canaries', provider: 'aida', url: 'https://aida.de/finden/CO07270313/CLASSIC' };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cruise-api-'));
  stores = createStores(dir);
  await start({ registry: createProviderRegistry('mock') });
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

describe('routes', () => {
  it('supports add, list, get, edit and delete', async () => {
    const created = await call('POST', '/api/routes', aida);
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect((await call('GET', '/api/routes')).body).toHaveLength(1);
    expect((await call('GET', `/api/routes/${id}`)).body.name).toBe('Canaries');
    expect((await call('PUT', `/api/routes/${id}`, { ...aida, name: 'Renamed' })).body.name).toBe('Renamed');
    expect((await call('DELETE', `/api/routes/${id}`)).status).toBe(204);
    expect((await call('GET', `/api/routes/${id}`)).status).toBe(404);
  });

  describe('itinerary', () => {
    const stops = [{ code: 'ESPMI', name: 'Palma', seaDay: false, arrival: null, departure: '2026-12-01T17:00:00', lat: null, lng: null }];
    const itineraryFile = (id: string) => join(dir, 'itineraries', `${id}.json`);

    it('answers 404 for an unknown route', async () => {
      expect((await call('GET', '/api/routes/nope/itinerary')).status).toBe(404);
    });

    it('answers null while nothing was collected, then the stops', async () => {
      const { body: route } = await call('POST', '/api/routes', aida);
      expect(await call('GET', `/api/routes/${route.id}/itinerary`)).toMatchObject({ status: 200, body: null });
      await stores.itineraries.put({ routeId: route.id, provider: 'aida', readAt: '2026-11-27T10:00:00.000Z', stops });
      const res = await call('GET', `/api/routes/${route.id}/itinerary`);
      expect(res.status).toBe(200);
      expect(res.body.stops).toEqual(stops);
    });

    it('answers null for a corrupt itinerary file instead of failing', async () => {
      const { body: route } = await call('POST', '/api/routes', aida);
      await mkdir(join(dir, 'itineraries'), { recursive: true });
      await writeFile(itineraryFile(route.id), '{not json');
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        expect(await call('GET', `/api/routes/${route.id}/itinerary`)).toMatchObject({ status: 200, body: null });
        expect(error).toHaveBeenCalledTimes(1);
      } finally {
        error.mockRestore();
      }
    });

    it('deleting the route removes its itinerary', async () => {
      const { body: route } = await call('POST', '/api/routes', aida);
      await stores.itineraries.put({ routeId: route.id, provider: 'aida', readAt: '2026-11-27T10:00:00.000Z', stops });
      await expect(readFile(itineraryFile(route.id), 'utf8')).resolves.toContain('Palma');
      expect((await call('DELETE', `/api/routes/${route.id}`)).status).toBe(204);
      await expect(readFile(itineraryFile(route.id), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('sets and clears the favorite fare and cabin of a route', async () => {
    const { body: route } = await call('POST', '/api/routes', aida);
    expect(route.favorite).toBeNull();
    const set = await call('PUT', `/api/routes/${route.id}/favorite`, { fareCode: 'PREMIUM_ALL_IN', cabin: 'Balkonkabine' });
    expect(set).toMatchObject({ status: 200, body: { favorite: { fareCode: 'PREMIUM_ALL_IN', cabin: 'Balkonkabine' } } });
    expect((await call('GET', `/api/routes/${route.id}`)).body.favorite).toEqual({ fareCode: 'PREMIUM_ALL_IN', cabin: 'Balkonkabine' });
    expect((await call('PUT', `/api/routes/${route.id}/favorite`, { fareCode: null, cabin: null })).body.favorite).toBeNull();
    expect((await call('PUT', `/api/routes/${route.id}/favorite`, { fareCode: 5 })).status).toBe(400);
    expect((await call('PUT', '/api/routes/nope/favorite', { fareCode: null, cabin: null })).status).toBe(404);
  });

  it('validates input and reports problems', async () => {
    expect((await call('POST', '/api/routes', { ...aida, url: 'https://meinschiff.com/x' })).status).toBe(400);
    expect((await call('POST', '/api/routes', '{not json')).status).toBe(400);
    expect((await call('GET', '/api/routes/nope')).status).toBe(404);
    expect((await call('GET', '/api/nope')).status).toBe(404);
    expect((await call('PATCH', '/api/routes')).status).toBe(405);
  });

  it('rejects oversized bodies', async () => {
    expect((await call('POST', '/api/routes', 'x'.repeat(1_100_000))).status).toBe(413);
  });
});

describe('snapshots and collection', () => {
  it('adds a manual snapshot and lists the history', async () => {
    const { body: route } = await call('POST', '/api/routes', aida);
    const manual = await call('POST', `/api/routes/${route.id}/snapshots`, { packagePrice: 1500, flightSurcharge: 300 });
    expect(manual).toMatchObject({ status: 201, body: { source: 'manual', provider: 'aida', packagePrice: 1500, schemaVersion: 5, pricing: { cruiseTotal: 1500, flightTotal: 300, tripTotal: 1800, tripPerPerson: 900 } } });
    expect((await call('POST', `/api/routes/${route.id}/snapshots`, { packagePrice: -1 })).status).toBe(400);
    expect((await call('GET', `/api/routes/${route.id}/snapshots`)).body).toHaveLength(1);
    expect((await call('GET', '/api/routes/nope/snapshots')).status).toBe(404);
  });

  it('collects one route, records a run and generates the report', async () => {
    const { body: route } = await call('POST', '/api/routes', aida);
    const res = await call('POST', `/api/routes/${route.id}/collect`);
    expect(res.status).toBe(201);
    expect(res.body.snapshot).toMatchObject({ source: 'mock', routeId: route.id });
    expect(res.body.diagnostics.status).toBe('success');

    const runs = await call('GET', '/api/runs?limit=5');
    expect(runs.body).toHaveLength(1);
    expect(runs.body[0]).toMatchObject({ trigger: 'manual', results: [{ status: 'success', routeName: 'Canaries' }] });
    expect((await call('GET', '/api/reports/daily')).body).toMatchObject({ collections: 1, successes: 1, successRate: 1 });
  });

  it('collects all routes in one run', async () => {
    await call('POST', '/api/routes', aida);
    await call('POST', '/api/routes', { name: 'MS', provider: 'mein-schiff', url: 'https://www.meinschiff.com/de/trips/x' });
    const res = await call('POST', '/api/collect');
    expect(res.status).toBe(201);
    expect(res.body.run.results).toHaveLength(2);
  });

  it('returns 409 when a collection is already running', async () => {
    const { body: route } = await call('POST', '/api/routes', aida);
    const release = await stores.lock.acquire();
    expect((await call('POST', `/api/routes/${route.id}/collect`)).status).toBe(409);
    expect((await call('POST', '/api/collect')).status).toBe(409);
    await release();
    expect((await call('POST', `/api/routes/${route.id}/collect`)).status).toBe(201);
  });

  it('allows one real price per route and day: a second collection is refused with 409', async () => {
    const live = new ProviderRegistry(createProviderRegistry('mock').list().map((c) => Object.assign(Object.create(c) as CruiseProviderCollector, { source: 'live' as const })));
    const server = createApiServer({ stores, collection: { registry: live } });
    await new Promise<void>((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const route = (await (await fetch(`${base}/api/routes`, { method: 'POST', body: JSON.stringify(aida) })).json()) as { id: string };
      expect((await fetch(`${base}/api/routes/${route.id}/collect`, { method: 'POST' })).status).toBe(201);
      const again = await fetch(`${base}/api/routes/${route.id}/collect?lang=en`, { method: 'POST' });
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ code: 'ALREADY_COLLECTED_TODAY', error: 'Already collected today. Prices are collected once per route and day.' });
      const all = await fetch(`${base}/api/collect`, { method: 'POST' });
      expect(all.status).toBe(409);
      expect(((await all.json()) as { error: string }).error).toContain('heute schon erfasst'); // German by default
      expect(await stores.runs.list()).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('serves empty history before anything ran', async () => {
    expect((await call('GET', '/api/runs')).body).toEqual([]);
    expect((await call('GET', '/api/reports/daily')).body).toBeNull();
    expect((await call('GET', '/api/health')).body).toMatchObject({ ok: true });
  });
});

describe('failures', () => {
  beforeEach(async () => {
    await new Promise((r) => server.close(r));
    await start({ registry: new ProviderRegistry([failing]), browserFactory: fakeBrowserFactory });
  });

  it('returns 502 with diagnostics and serves the failure artifacts', async () => {
    const { body: route } = await call('POST', '/api/routes', aida);
    const res = await call('POST', `/api/routes/${route.id}/collect`);
    expect(res.status).toBe(502);
    expect(res.body.snapshot).toBeNull();
    expect(res.body.diagnostics).toMatchObject({ status: 'failed', error: 'selector broke' });

    const id = res.body.run.results[0].failureId as string;
    const png = await call('GET', `/api/failures/screenshots/${id}.png`);
    expect(png).toMatchObject({ status: 200, type: 'image/png', body: 'PNGDATA' });
    expect(await call('GET', `/api/failures/html/${id}`)).toMatchObject({ status: 200, body: '<html>dump</html>' });
    expect((await call('GET', `/api/failures/logs/${id}`)).body).toMatchObject({ error: { message: 'selector broke' } });
    expect((await call('GET', '/api/failures/logs/unknown-id')).status).toBe(404);
    expect((await call('GET', '/api/failures/other/x')).status).toBe(404);

    const report = (await call('GET', '/api/reports/daily')).body;
    expect(report).toMatchObject({ collections: 1, failures: 1, successRate: 0 });
  });
});

describe('intelligence', () => {
  const DAY = 86_400_000;
  /** 40 days of a falling price for one route. */
  async function seedRoute(name = 'Canaries', perPerson = (d: number) => 900 - 3 * d) {
    const { body: route } = await call('POST', '/api/routes', { name, provider: 'aida', url: 'https://aida.de/finden/CO07270313/CLASSIC' });
    for (let d = 0; d < 40; d++) {
      await stores.snapshots.create({
        routeId: route.id,
        provider: 'aida',
        source: 'live',
        collectedAt: new Date(Date.UTC(2026, 5, 1) + d * DAY).toISOString(),
        cruise: { name: 'N', ship: 'S', departure: '2027-03-13', durationNights: 7 },
        party: { adults: 2, departureAirport: 'FRA' },
        cabins: [{ category: 'Balkonkabine', packagePerPerson: perPerson(d), flightPerPerson: 100, packageTotal: perPerson(d) * 2, flightTotal: 200 }],
        packagePrice: perPerson(d) * 2,
        flightSurcharge: 200,
      });
    }
    return route as { id: string };
  }

  it('analyses one route: recommendation with confidence, forecast, savings, insight', async () => {
    const route = await seedRoute();
    const res = await call('GET', `/api/routes/${route.id}/intelligence?lang=en`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ routeName: 'Canaries', snapshotCount: 40, recommendation: { action: 'BUY_NOW' }, forecast: { model: 'linear-regression' } });
    expect(res.body.recommendation.confidence).toBeGreaterThan(0);
    expect(res.body.groups[0]).toMatchObject({ group: 'balcony', label: 'Balcony' });
    expect(res.body.insight).toContain('Recommendation: BUY NOW');
    const german = await call('GET', `/api/routes/${route.id}/intelligence?lang=de`);
    expect(german.body.insight).toContain('Empfehlung: JETZT KAUFEN');
    expect((await call('GET', `/api/routes/${route.id}/intelligence`)).body.insight).toContain('Empfehlung');
    expect((await call('GET', '/api/routes/nope/intelligence')).status).toBe(404);
  });

  it('ranks the portfolio, and gives routes without data a recommendation too', async () => {
    await seedRoute('Falling');
    await call('POST', '/api/routes', { name: 'Empty', provider: 'mein-schiff', url: 'https://www.meinschiff.com/de/trips/x' });
    const res = await call('GET', '/api/intelligence');
    expect(res.body.routes).toHaveLength(2);
    expect(res.body.routes.every((r: { recommendation: { confidence: number } }) => typeof r.recommendation.confidence === 'number')).toBe(true);
    expect(res.body.bestOpportunities.map((r: { routeName: string }) => r.routeName)).toEqual(['Falling']);
    expect(res.body.rankings.deals).toHaveLength(1);
    expect(res.body.providers).toHaveLength(1);
  });
});

describe('alerts and rules', () => {
  const DAY = 86_400_000;

  it('provides default rules and lets you add and delete rules', async () => {
    const rules = (await call('GET', '/api/alert-rules')).body;
    expect(rules.map((r: { type: string }) => r.type)).toEqual(['NEW_LOW', 'PERCENT_DROP']);

    const { body: route } = await call('POST', '/api/routes', aida);
    const created = await call('POST', '/api/alert-rules', { type: 'TARGET_PRICE', cabin: 'balcony', targetPrice: 2499, routeId: route.id });
    expect(created).toMatchObject({ status: 201, body: { type: 'TARGET_PRICE', cabin: 'balcony', enabled: true } });
    expect((await call('GET', '/api/alert-rules')).body).toHaveLength(3);
    expect((await call('DELETE', `/api/alert-rules/${created.body.id}`)).status).toBe(204);
    expect((await call('DELETE', `/api/alert-rules/${created.body.id}`)).status).toBe(404);
    expect((await call('GET', '/api/alert-rules')).body).toHaveLength(2);
  });

  it('rejects invalid rules', async () => {
    expect((await call('POST', '/api/alert-rules', { type: 'PERCENT_DROP', percent: 7 })).status).toBe(400);
    expect((await call('POST', '/api/alert-rules', { type: 'TARGET_PRICE' })).status).toBe(400);
    expect((await call('POST', '/api/alert-rules', { type: 'NEW_LOW', routeId: 'nope' })).status).toBe(404);
  });

  it('raises an alert when a collection hits a target, lists and filters it, and acknowledges it', async () => {
    const { body: route } = await call('POST', '/api/routes', aida);
    await call('POST', '/api/alert-rules', { type: 'TARGET_PRICE', targetPrice: 1_000_000, routeId: route.id });
    expect((await call('POST', `/api/routes/${route.id}/collect`)).status).toBe(201);

    const alerts = (await call('GET', '/api/alerts')).body;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'TARGET_PRICE', routeName: 'Canaries', provider: 'aida', category: 'Cheapest cabin', status: 'new' });

    expect((await call('GET', '/api/alerts?provider=mein-schiff')).body).toEqual([]);
    expect((await call('GET', '/api/alerts?type=TARGET_PRICE&provider=aida')).body).toHaveLength(1);
    expect((await call('GET', `/api/alerts?since=${new Date(Date.now() + DAY).toISOString()}`)).body).toEqual([]);
    expect((await call('GET', '/api/alerts?since=garbage')).status).toBe(400);

    const acked = await call('POST', `/api/alerts/${alerts[0].id}/acknowledge`);
    expect(acked.body.status).toBe('acknowledged');
    expect((await call('POST', '/api/alerts/nope/acknowledge')).status).toBe(404);
  });
});

describe('notifications', () => {
  const sent: string[] = [];
  const router = (ok: boolean) => ({
    statuses: [{ id: 'teams', label: 'Microsoft Teams', configured: true, enabled: true }],
    sendTest: async (channel: string, payload: { route: string }) =>
      channel === 'teams' ? (sent.push(payload.route), { channel, status: ok ? 'sent' : 'failed', attempts: ok ? 1 : 3, error: ok ? null : 'Teams: HTTP 500' }) : null,
  });

  async function withRouter(r: ReturnType<typeof router> | null) {
    await new Promise((res) => server.close(res));
    server = createApiServer({ stores, collection: { registry: createProviderRegistry('mock') }, notificationRouter: async () => r as never });
    await new Promise<void>((res) => server.listen(0, res));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  }

  it('reports channel status without any credentials', async () => {
    await withRouter(router(true));
    expect((await call('GET', '/api/notifications')).body).toEqual([{ id: 'teams', label: 'Microsoft Teams', configured: true, enabled: true }]);
    await withRouter(null);
    expect((await call('GET', '/api/notifications')).body).toEqual([]);
  });

  it('sends a test message only when the user asks, to one channel', async () => {
    await withRouter(router(true));
    sent.length = 0;
    expect((await call('POST', '/api/notifications/test', { channel: 'teams' })).body).toMatchObject({ status: 'sent' });
    expect(sent).toEqual(['Test notification']);
  });

  it('reports a failing channel, an unconfigured channel and a bad request', async () => {
    await withRouter(router(false));
    expect(await call('POST', '/api/notifications/test', { channel: 'teams' })).toMatchObject({ status: 502, body: { error: 'Teams: HTTP 500' } });
    expect((await call('POST', '/api/notifications/test', { channel: 'email' })).status).toBe(409);
    expect((await call('POST', '/api/notifications/test', { channel: 'fax' })).status).toBe(400);
    await withRouter(null);
    expect((await call('POST', '/api/notifications/test', { channel: 'teams' })).status).toBe(409);
  });

  it('works against the real settings file when no router is injected', async () => {
    await new Promise((res) => server.close(res));
    server = createApiServer({ stores });
    await new Promise<void>((res) => server.listen(0, res));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const statuses = (await call('GET', '/api/notifications')).body as { id: string; enabled: boolean }[];
    expect(statuses.map((s) => s.id)).toEqual(['email', 'teams', 'telegram', 'pushover']);
    expect(statuses.every((s) => !s.enabled)).toBe(true);
    expect((await call('POST', '/api/notifications/test', { channel: 'teams' })).status).toBe(409);
  });
});

describe('weekly reports', () => {
  const pdfBrowser = {
    launch: async () => ({ newPage: async () => ({ setContent: async () => undefined, pdf: async () => Buffer.from('%PDF-fake') }), close: async () => undefined }) as unknown as Browser,
  };

  async function withWeekly(browserFactory: typeof pdfBrowser) {
    await new Promise((res) => server.close(res));
    server = createApiServer({ stores, collection: { registry: createProviderRegistry('mock') }, weekly: { browserFactory, now: () => new Date('2026-07-11T08:00:00.000Z') } });
    await new Promise<void>((res) => server.listen(0, res));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  }

  it('generates, lists and serves the report files', async () => {
    await withWeekly(pdfBrowser);
    expect((await call('GET', '/api/reports/weekly')).body).toEqual([]);
    const made = await call('POST', '/api/reports/weekly');
    expect(made).toMatchObject({ status: 201, body: { date: '2026-07-11', pdfError: null, files: ['weekly-2026-07-11.json', 'weekly-2026-07-11.csv', 'weekly-2026-07-11.pdf', 'weekly-2026-07-11-deals.csv'] } });
    expect((await call('GET', '/api/reports/weekly')).body).toHaveLength(4);
    expect((await call('GET', '/api/reports/weekly/weekly-2026-07-11-deals.csv')).body).toContain('headline,route,provider,cabin,fare');
    const json = await call('GET', '/api/reports/weekly/weekly-2026-07-11.json');
    expect(json).toMatchObject({ status: 200, body: { routes: [] } });
    expect((await call('GET', '/api/reports/weekly/weekly-2026-07-11.csv')).type).toContain('text/csv');
    expect((await call('GET', '/api/reports/weekly/weekly-2026-07-11.pdf')).type).toContain('application/pdf');
    expect((await call('GET', '/api/reports/weekly/weekly-1999-01-01.json')).status).toBe(404);
    expect((await call('GET', '/api/reports/weekly/notifications.json')).status).toBe(404);
  });

  it('reports a missing PDF engine but still delivers JSON and CSV', async () => {
    await withWeekly({ launch: async () => Promise.reject(new Error('no chromium')) } as never);
    expect((await call('POST', '/api/reports/weekly')).body).toMatchObject({ pdfError: 'no chromium', files: ['weekly-2026-07-11.json', 'weekly-2026-07-11.csv', 'weekly-2026-07-11-deals.csv'] });
  });
});

describe('deal intelligence', () => {
  async function seedRoute(name = 'Canary Islands', provider: 'aida' | 'mein-schiff' = 'aida', url = 'https://aida.de/finden/CO07270313/CLASSIC') {
    const { body: route } = await call('POST', '/api/routes', { name, provider, url });
    for (let d = 0; d < 40; d++) {
      const perPerson = 1500 - 3 * d;
      await stores.snapshots.create({
        routeId: route.id,
        provider,
        source: 'live',
        collectedAt: new Date(Date.UTC(2026, 5, 1) + d * 86_400_000).toISOString(),
        cruise: { name: 'N', ship: 'AIDA Nova', departure: '2027-03-13', durationNights: 7 },
        party: { adults: 2, departureAirport: 'FRA' },
        cabins: [{ category: 'Balkonkabine', packagePerPerson: perPerson, flightPerPerson: 100, packageTotal: perPerson * 2, flightTotal: 200 }],
        packagePrice: perPerson * 2,
        flightSurcharge: 200,
      } as never);
    }
    return route as { id: string };
  }

  it('answers copilot questions with a recommendation, reasoning, confidence and metrics, in the requested language', async () => {
    await seedRoute();
    const en = await call('POST', '/api/copilot?lang=en', { question: 'Should I book now?' });
    expect(en.status).toBe(200);
    expect(en.body).toMatchObject({ intent: 'book_now', understood: true });
    expect(en.body.recommendation).toMatch(/^Recommendation for Canary Islands: /);
    expect(en.body.reasoning.length).toBeGreaterThan(0);
    expect(en.body.confidence).toBeGreaterThan(0);
    expect(en.body.metrics.length).toBeGreaterThan(0);
    const de = await call('POST', '/api/copilot?lang=de', { question: 'Soll ich jetzt buchen?' });
    expect(de.body.recommendation).toMatch(/^Empfehlung für Canary Islands: /);
    expect(de.body.reasoning.join(' ')).toContain('Preisposition');
    expect((await call('POST', '/api/copilot', { question: 'Tell me a joke' })).body).toMatchObject({ understood: false, intent: 'unknown' });
  });

  it('rejects empty, oversized and malformed copilot questions', async () => {
    expect((await call('POST', '/api/copilot', { question: '   ' })).status).toBe(400);
    expect((await call('POST', '/api/copilot', {})).status).toBe(400);
    expect((await call('POST', '/api/copilot', { question: 'x'.repeat(501) })).status).toBe(400);
    expect((await call('POST', '/api/copilot', '{broken')).status).toBe(400);
    expect((await call('GET', '/api/copilot')).status).toBe(404);
  });

  it('serves the historical dataset of a route, rebuilt from the snapshots', async () => {
    const route = await seedRoute();
    const res = await call('GET', `/api/routes/${route.id}/dataset`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ routeId: route.id, routeName: 'Canary Islands', snapshotCount: 40 });
    expect(res.body.lows.route.price).toBeLessThan(res.body.lows.highest.price);
    expect(res.body.dealScoreHistory.length).toBeGreaterThan(5);
    expect(res.body.bookingWindowStats.marks).toHaveLength(7);
    expect((await call('GET', '/api/routes/nope/dataset')).status).toBe(404);
  });

  it('adds the deal intelligence to the route analysis', async () => {
    const route = await seedRoute();
    const res = await call('GET', `/api/routes/${route.id}/intelligence?lang=en`);
    expect(res.body).toMatchObject({ ship: 'AIDA Nova', durationNights: 7, lastMinute: { available: true }, upgrades: [], bestUpgrade: null });
    expect(res.body.recommendedBookingWindow.from).toBeLessThan(res.body.recommendedBookingWindow.to);
    expect(res.body.recommendation.explanation.length).toBeGreaterThan(2);
    expect(res.body.groups[0]).toMatchObject({ group: 'balcony', heat: { level: expect.stringMatching(/strong|neutral|poor/) } });
  });
});

describe('response time (the brief: under 3 seconds)', () => {
  it('analyses a portfolio of 12 routes with 40 collections each, and answers the copilot, within 3 seconds', async () => {
    for (let r = 0; r < 12; r++) {
      const { body: route } = await call('POST', '/api/routes', { name: `Route ${r}`, provider: 'aida', url: 'https://aida.de/finden/CO07270313/CLASSIC' });
      for (let d = 0; d < 40; d++) {
        const perPerson = 1500 + r * 20 - 3 * d;
        await stores.snapshots.create({
          routeId: route.id, provider: 'aida', source: 'live', collectedAt: new Date(Date.UTC(2026, 5, 1) + d * 86_400_000).toISOString(),
          cruise: { name: 'N', ship: 'AIDA Nova', departure: '2027-03-13', durationNights: 7 }, party: { adults: 2, departureAirport: 'FRA' },
          cabins: [{ category: 'Balkonkabine', packagePerPerson: perPerson, flightPerPerson: 100, packageTotal: perPerson * 2, flightTotal: 200 }, { category: 'Meerblickkabine', packagePerPerson: perPerson - 100, flightPerPerson: 100, packageTotal: (perPerson - 100) * 2, flightTotal: 200 }],
          packagePrice: perPerson * 2, flightSurcharge: 200,
        } as never);
      }
    }
    const t0 = performance.now();
    const portfolio = await call('GET', '/api/intelligence');
    const t1 = performance.now();
    const answer = await call('POST', '/api/copilot', { question: 'Which balcony offer is currently best under 5.000 €?' });
    const t2 = performance.now();
    expect(portfolio.body.routes).toHaveLength(12);
    expect(answer.status).toBe(200);
    expect(t1 - t0).toBeLessThan(3000);
    expect(t2 - t1).toBeLessThan(3000);
  }, 60_000);
});

describe('deal reports (daily, weekly, monthly)', () => {
  beforeEach(async () => {
    await new Promise((r) => server.close(r));
    const { factory } = (() => {
      const page = { setContent: async () => undefined, pdf: async () => Buffer.from('%PDF-fake') };
      const browser = { newPage: async () => page, close: async () => undefined };
      return { factory: { launch: async () => browser } as unknown as BrowserFactory };
    })();
    server = createApiServer({ stores, collection: { registry: createProviderRegistry('mock') }, weekly: { browserFactory: factory, now: () => new Date('2026-07-11T08:00:00.000Z') } });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  it('generates each kind into its own files, lists them, and downloads them', async () => {
    expect((await call('GET', '/api/reports/deals')).body).toEqual([]);
    for (const kind of ['daily', 'weekly', 'monthly']) {
      const made = await call('POST', `/api/reports/deals?kind=${kind}`);
      expect(made).toMatchObject({ status: 201, body: { kind, date: '2026-07-11', pdfError: null, files: [`${kind}-2026-07-11.json`, `${kind}-2026-07-11.csv`, `${kind}-2026-07-11.pdf`, `${kind}-2026-07-11-deals.csv`] } });
    }
    expect((await call('GET', '/api/reports/deals')).body).toHaveLength(12);
    expect((await call('GET', '/api/reports/deals?kind=monthly')).body).toHaveLength(4);
    expect((await call('GET', '/api/reports/weekly')).body).toHaveLength(4); // the original weekly list is unchanged
    const json = await call('GET', '/api/reports/deals/monthly-2026-07-11.json');
    expect(json.body).toMatchObject({ kind: 'monthly', routes: [], bestUpgrades: [], forecastSummary: [] });
    expect((await call('GET', '/api/reports/deals/daily-2026-07-11.pdf')).type).toContain('application/pdf');
    expect((await call('GET', '/api/reports/deals/yearly-2026-07-11.json')).status).toBe(404);
  });

  it('defaults to weekly and rejects unknown kinds', async () => {
    expect((await call('POST', '/api/reports/deals')).body.kind).toBe('weekly');
    expect((await call('POST', '/api/reports/deals?kind=yearly')).status).toBe(400);
    expect((await call('GET', '/api/reports/deals?kind=yearly')).status).toBe(400);
  });
});

describe('route search', () => {
  const restart = async (search: Parameters<typeof createApiServer>[0]['search']) => {
    await new Promise((r) => server.close(r));
    server = createApiServer({ stores, collection: { registry: createProviderRegistry('mock') }, ...(search ? { search } : {}) });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  };

  it('lists what a cruise line offers, filtered by text and by departure dates (mock catalogue)', async () => {
    await restart({ mode: 'mock' });
    const all = await call('GET', '/api/route-search?provider=aida');
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ provider: 'aida', capped: false });
    expect(all.body.results.length).toBeGreaterThan(2);
    const result = all.body.results[0];
    expect(result).toMatchObject({ provider: 'aida', url: expect.stringContaining('aida.de/finden/'), title: expect.any(String), startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), nights: expect.any(Number) });

    const kanaren = await call('GET', '/api/route-search?provider=aida&query=Kanaren');
    expect(kanaren.body.results.every((r: { title: string }) => /Kanaren/.test(r.title))).toBe(true);
    expect(kanaren.body.total).toBe(kanaren.body.results.length);
    const march = await call('GET', '/api/route-search?provider=aida&from=2027-03-15&to=2027-03-31');
    expect(march.body.results.map((r: { startDate: string }) => r.startDate)).toEqual(['2027-03-20']);
    const limited = await call('GET', '/api/route-search?provider=aida&limit=1');
    expect(limited.body.results).toHaveLength(1);
    expect(limited.body.total).toBeGreaterThan(1);
    expect((await call('GET', '/api/route-search?provider=mein-schiff')).body.results.every((r: { provider: string }) => r.provider === 'mein-schiff')).toBe(true);
  });

  it('a found cruise can be added as a route as it is', async () => {
    await restart({ mode: 'mock' });
    const { body } = await call('GET', '/api/route-search?provider=mein-schiff&query=norwegische');
    const pick = body.results[0];
    const created = await call('POST', '/api/routes', { name: `${pick.title} · ${pick.ship}`, provider: pick.provider, url: pick.url });
    expect(created.status).toBe(201);
    expect(created.body.url).toBe(pick.url);
  });

  it('validates the request', async () => {
    await restart({ mode: 'mock' });
    for (const bad of ['', '?provider=tui', '?provider=aida&from=2027-3-1', '?provider=aida&to=nonsense', '?provider=aida&from=2027-04-01&to=2027-03-01', `?provider=aida&query=${'x'.repeat(101)}`, '?provider=aida&limit=2.5', '?provider=aida&limit=abc']) {
      expect((await call('GET', `/api/route-search${bad}`)).status, bad).toBe(400);
    }
    expect((await call('GET', '/api/route-search?provider=aida&lang=en&from=oops')).body.error).toBe('Dates must be written YYYY-MM-DD.');
    expect((await call('GET', '/api/route-search?provider=aida&lang=de&from=oops')).body.error).toBe('Datumsangaben müssen als JJJJ-MM-TT geschrieben werden.');
    expect((await call('POST', '/api/route-search?provider=aida')).status).toBe(404); // only GET exists
  });

  it('refuses while a collection (or another search) holds the lock, and frees the lock afterwards', async () => {
    await restart({ mode: 'mock' });
    const release = await stores.lock.acquire();
    expect((await call('GET', '/api/route-search?provider=aida')).status).toBe(409);
    await release();
    expect((await call('GET', '/api/route-search?provider=aida')).status).toBe(200);
    expect((await call('GET', '/api/route-search?provider=aida')).status).toBe(200);
  });

  it('answers 502 with the reason when the website cannot be searched, and still frees the lock', async () => {
    const failing = { launch: async () => { throw new Error('browser could not start\nstack…'); } } as unknown as BrowserFactory;
    await restart({ mode: 'live', browserFactory: failing });
    const res = await call('GET', '/api/route-search?provider=mein-schiff&lang=en');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("The cruise line's website could not be searched: browser could not start");
    const release = await stores.lock.acquire(); // the lock is free again
    await release();
  });
});

describe('route search cache', () => {
  /** AIDA's search page, as far as the search reads it. */
  const aidaPage = () => {
    const page = { goto: async () => undefined, waitForLoadState: async () => undefined, evaluate: async () => ({ capped: false, items: [{ title: 'Kanaren & Madeira ab Gran Canaria', duration: 7, ports: [{ name: 'LAS PALMAS' }], cruiseItemVariant: [{ startDate: '2027-03-13', endDate: '2027-03-20', duration: 7, amountPerPerson: 649, journeyIdentifier: 'CO07270313', ship: { marketingName: 'AIDAcosma' } }] }] }) };
    let launches = 0;
    const factory = { launch: async () => { launches++; return { newPage: async () => page, close: async () => undefined }; } } as unknown as BrowserFactory;
    return { factory, launches: () => launches };
  };
  const restart = async (search: Parameters<typeof createApiServer>[0]['search']) => {
    await new Promise((r) => server.close(r));
    server = createApiServer({ stores, collection: { registry: createProviderRegistry('mock') }, search });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  };

  it('reads the website once, then answers from the cache (also while a collection holds the lock), until a reload is asked for', async () => {
    const aida = aidaPage();
    await restart({ mode: 'live', browserFactory: aida.factory });
    const first = await call('GET', '/api/route-search?provider=aida&query=kanaren');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 1, cachedAt: null });
    expect(aida.launches()).toBe(1);

    const release = await stores.lock.acquire(); // a collection is running: a cached answer needs no browser, so it does not wait
    const second = await call('GET', '/api/route-search?provider=aida&query=madeira');
    expect(second.status).toBe(200);
    expect(second.body.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(second.body.results[0]).toMatchObject({ ship: 'AIDAcosma', startDate: '2027-03-13' });
    expect(aida.launches()).toBe(1);
    expect((await call('GET', '/api/route-search?provider=aida&refresh=1')).status).toBe(409); // a reload needs the browser, so it waits for the lock
    await release();

    const again = await call('GET', '/api/route-search?provider=aida&refresh=1');
    expect(again.body.cachedAt).toBeNull();
    expect(aida.launches()).toBe(2);
    expect((await call('GET', '/api/route-search?provider=aida')).body.cachedAt).not.toBeNull(); // and the reload refreshed the cache
    expect(aida.launches()).toBe(2);
  });

  it('keeps the cache in the data directory, so it survives a restart', async () => {
    const aida = aidaPage();
    await restart({ mode: 'live', browserFactory: aida.factory });
    await call('GET', '/api/route-search?provider=aida');
    const stored = (await stores.searchCache.read('aida')) as { fetchedAt: string; results: unknown[] };
    expect(stored.results).toHaveLength(1);
    const other = aidaPage();
    await restart({ mode: 'live', browserFactory: other.factory });
    expect((await call('GET', '/api/route-search?provider=aida')).body.cachedAt).toBe(stored.fetchedAt);
    expect(other.launches()).toBe(0);
  });

  it('does not use the cache in mock mode', async () => {
    await restart({ mode: 'mock' });
    expect((await call('GET', '/api/route-search?provider=aida')).body.cachedAt).toBeNull();
    expect(await stores.searchCache.read('aida')).toBeNull();
  });
});

describe('cruises that leave in more than six months: collected at most once a week', () => {
  const DAY = 86_400_000;
  const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
  /** A real price from `daysAgo` days ago for a cruise that leaves in `departsInDays` days. */
  async function routeWith(name: string, daysAgo: number, departsInDays: number) {
    const { body: route } = await call('POST', '/api/routes', { name, provider: 'aida', url: 'https://aida.de/finden/CO07270313/CLASSIC' });
    await stores.snapshots.create({ routeId: route.id, provider: 'aida', source: 'live', collectedAt: iso(-daysAgo * DAY), cruise: { name: 'N', ship: 'S', departure: iso(departsInDays * DAY).slice(0, 10), durationNights: 7 }, packagePrice: 1000, flightSurcharge: 200 } as never);
    return route as { id: string };
  }
  const restart = async () => {
    await new Promise((r) => server.close(r));
    const live = new ProviderRegistry(createProviderRegistry('mock').list().map((c) => Object.assign(Object.create(c) as CruiseProviderCollector, { source: 'live' as const })));
    server = createApiServer({ stores, collection: { registry: live } });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  };

  it('refuses an individual collection with the reason and the day it is possible again (like the once-a-day error)', async () => {
    await restart();
    const far = await routeWith('Far away', 2, 400);
    const res = await call('POST', `/api/routes/${far.id}/collect?lang=en`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ALREADY_COLLECTED_THIS_WEEK', nextCollection: iso(5 * DAY).slice(0, 10) });
    expect(res.body.error).toBe(`This cruise leaves in more than 6 months, so it is collected at most once a week. Last collected ${iso(-2 * DAY).slice(0, 10)}; next collection from ${iso(5 * DAY).slice(0, 10)}.`);
    expect((await call('POST', `/api/routes/${far.id}/collect?lang=de`)).body.error).toContain('höchstens einmal pro Woche');

    const near = await routeWith('Close', 1, 120); // leaves within six months: collected a day ago, so a collection is fine
    expect((await call('POST', `/api/routes/${near.id}/collect`)).status).toBe(201);
    expect((await call('POST', `/api/routes/${near.id}/collect?lang=en`)).body).toMatchObject({ code: 'ALREADY_COLLECTED_TODAY' }); // now it is the daily rule
  });

  it('leaves such routes out of "collect all", and says so when nothing was left to collect', async () => {
    await restart();
    const far = await routeWith('Far away', 3, 500);
    const near = await routeWith('Close', 2, 100);
    const some = await call('POST', '/api/collect');
    expect(some.status).toBe(201);
    expect(some.body.run.results.map((r: { routeId: string }) => r.routeId)).toEqual([near.id]);
    expect(some.body.skipped).toEqual([far.id]);
    const none = await call('POST', '/api/collect?lang=en');
    expect(none.status).toBe(409);
    expect(none.body).toMatchObject({ code: 'ALREADY_COLLECTED', error: 'Every route was already collected: cruises that leave in more than 6 months once a week, all others once a day.' });
  });

  it('lets one route be collected anyway (?force=1) within its week, but never twice a day, and never in "collect all"', async () => {
    await restart();
    const far = await routeWith('Far away', 2, 400);
    expect((await call('POST', `/api/collect?force=1`)).status).toBe(409); // collect all ignores force
    expect((await call('POST', `/api/routes/${far.id}/collect`)).body.code).toBe('ALREADY_COLLECTED_THIS_WEEK');
    const forced = await call('POST', `/api/routes/${far.id}/collect?force=1`);
    expect(forced.status).toBe(201);
    expect(await stores.snapshots.listByRoute(far.id)).toHaveLength(2);
    const twice = await call('POST', `/api/routes/${far.id}/collect?force=1&lang=en`);
    expect(twice.status).toBe(409);
    expect(twice.body).toMatchObject({ code: 'ALREADY_COLLECTED_TODAY' });
  });

  it('collects the far-away route again once a week has passed', async () => {
    await restart();
    const far = await routeWith('Far away', 7, 500);
    expect((await call('POST', `/api/routes/${far.id}/collect`)).status).toBe(201);
  });
});
