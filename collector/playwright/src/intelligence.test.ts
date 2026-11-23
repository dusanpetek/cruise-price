import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CruiseSnapshot, Delivery, NotificationPayload, Route } from '@cruise/domain';
import type { NotificationRouter } from '@cruise/notifications';
import { createStores, type Stores } from '@cruise/shared/storage';
import { createAlertPipeline, routerFromStores, toPayload } from './alerts/pipeline';
import { collectRoutes } from './collection/batch';
import { createProviderRegistry } from './providers/providerRegistry';
import { generateDealReport, generateWeeklyReport, renderPdf } from './reports/weekly';
import { weeklyReportHtml } from './reports/weeklyHtml';
import { DEFAULT_DAILY_REPORT_CRON, DEFAULT_MONTHLY_REPORT_CRON, DEFAULT_WEEKLY_CRON, scheduleDealReport, scheduleDealReports, scheduleWeeklyReport } from './scheduler';
import { buildSnapshotInput } from './collection/snapshotBuilder';
import { mockCruise } from './collectors/mockPrice';

let dir: string;
let stores: Stores;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cruise-'));
  stores = createStores(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
const base = Date.UTC(2026, 5, 1);
const routeInput = { name: 'AIDA Nova', provider: 'aida', url: 'https://aida.de/finden/X/CLASSIC' } as const;

/** Stores a snapshot with a single Balkonkabine at `perPerson` on `day`. */
async function addSnapshot(route: Route, day: number, perPerson: number, source: 'live' | 'mock' = 'live'): Promise<CruiseSnapshot> {
  return stores.snapshots.create({
    routeId: route.id,
    provider: route.provider,
    source,
    collectedAt: new Date(base + day * DAY).toISOString(),
    cruise: { name: 'N', ship: 'S', departure: '2027-03-13', durationNights: 7 },
    party: { adults: 2, departureAirport: 'FRA' },
    cabins: [{ category: 'Balkonkabine', packagePerPerson: perPerson, flightPerPerson: 100, packageTotal: perPerson * 2, flightTotal: 200 }],
    packagePrice: perPerson * 2,
    flightSurcharge: 200,
  });
}

function fakeRouter(deliveries: Delivery[] = [{ channel: 'email', status: 'sent', attempts: 1, error: null }]) {
  const dispatch = vi.fn(async (_p: NotificationPayload) => deliveries);
  return { router: { enabledChannels: deliveries.map((d) => d.channel), dispatch } as unknown as NotificationRouter, dispatch };
}

describe('alert pipeline', () => {
  it('raises the default alerts after a collection and sends live ones to the channels', async () => {
    const route = await stores.routes.create(routeInput);
    await addSnapshot(route, 0, 1250);
    const latest = await addSnapshot(route, 1, 1100); // new low and a 12% drop
    const { router, dispatch } = fakeRouter();

    const alerts = await createAlertPipeline({ stores, getRouter: async () => router })(route, latest);

    expect(alerts.map((a) => a.type).sort()).toEqual(['NEW_LOW', 'PERCENT_DROP']);
    expect(alerts.every((a) => a.routeName === 'AIDA Nova' && a.provider === 'aida' && a.snapshotId === latest.id)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ route: 'AIDA Nova', category: 'Cheapest cabin', currentPrice: 2400, cruisePrice: 2200, flightPrice: 200, totalPrice: 2400, url: route.url });
    expect(alerts.every((a) => a.deliveries[0]?.status === 'sent')).toBe(true);
    expect((await stores.alerts.list()).map((a) => a.id).sort()).toEqual(alerts.map((a) => a.id).sort()); // persisted
  });

  it('records failed deliveries on the alert', async () => {
    const route = await stores.routes.create(routeInput);
    await addSnapshot(route, 0, 1250);
    const latest = await addSnapshot(route, 1, 1000);
    const { router } = fakeRouter([{ channel: 'telegram', status: 'failed', attempts: 3, error: 'Telegram: HTTP 503' }]);
    const [alert] = await createAlertPipeline({ stores, getRouter: async () => router })(route, latest);
    expect(alert!.deliveries).toEqual([{ channel: 'telegram', status: 'failed', attempts: 3, error: 'Telegram: HTTP 503' }]);
  });

  it('raises alerts for mock snapshots but never sends them', async () => {
    const route = await stores.routes.create(routeInput);
    await addSnapshot(route, 0, 1250, 'mock');
    const latest = await addSnapshot(route, 1, 1000, 'mock');
    const { router, dispatch } = fakeRouter();
    const getRouter = vi.fn(async () => router);
    const alerts = await createAlertPipeline({ stores, getRouter })(route, latest);
    expect(alerts).toHaveLength(2);
    expect(dispatch).not.toHaveBeenCalled();
    expect(getRouter).not.toHaveBeenCalled();
  });

  it('stores the alert without deliveries when no channel is configured', async () => {
    const route = await stores.routes.create(routeInput);
    await addSnapshot(route, 0, 1250);
    const latest = await addSnapshot(route, 1, 1000);
    for (const router of [null, fakeRouter([]).router]) {
      const [alert] = await createAlertPipeline({ stores, getRouter: async () => router })(route, latest);
      expect(alert!.deliveries).toEqual([]);
    }
  });

  it('is quiet when nothing noteworthy happened, and honours cabin-specific and target rules', async () => {
    const route = await stores.routes.create(routeInput);
    await stores.alertRules.ensureDefaults();
    await addSnapshot(route, 0, 1000);
    const flat = await addSnapshot(route, 1, 1010);
    const pipeline = createAlertPipeline({ stores, getRouter: async () => null });
    expect(await pipeline(route, flat)).toEqual([]);

    await stores.alertRules.create({ type: 'TARGET_PRICE', cabin: 'balcony', targetPrice: 2200, routeId: route.id });
    const cheaper = await addSnapshot(route, 2, 995);
    const alerts = await pipeline(route, cheaper);
    expect(alerts.find((a) => a.type === 'TARGET_PRICE')).toMatchObject({ category: 'Balcony', referencePrice: 2200, currentPrice: 2190 }); // trip total: cruise 1990 + flight 200
  });

  it('builds the notification payload from an alert', async () => {
    const route = await stores.routes.create(routeInput);
    await addSnapshot(route, 0, 1250);
    const latest = await addSnapshot(route, 1, 1000);
    const [alert] = await createAlertPipeline({ stores, getRouter: async () => null })(route, latest);
    expect(toPayload(route, alert!)).toEqual({ route: 'AIDA Nova', category: 'Cheapest cabin', alertType: alert!.type, currentPrice: 2200, previousPrice: alert!.referencePrice, cruisePrice: 2000, flightPrice: 200, totalPrice: 2200, message: alert!.message, provider: 'aida', url: route.url, createdAt: alert!.createdAt });
  });

  it('builds the router from data/notifications.json, and degrades to no notifications if it is broken', async () => {
    expect((await routerFromStores(stores))!.enabledChannels).toEqual([]);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'notifications.json'), JSON.stringify({ teams: { webhookUrl: 'https://w' } }));
    expect((await routerFromStores(stores))!.enabledChannels).toEqual(['teams']);
    await writeFile(join(dir, 'notifications.json'), '{broken');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await routerFromStores(stores)).toBeNull();
    errors.mockRestore();
  });
});

describe('alerts after a collection run', () => {
  const registry = createProviderRegistry('mock');

  it('evaluates alerts for every successfully collected route', async () => {
    const route = await stores.routes.create(routeInput);
    const afterSnapshot = vi.fn(async (_route: Route, _snapshot: CruiseSnapshot) => [] as never[]);
    await collectRoutes([route], { stores, registry, afterSnapshot }, { trigger: 'manual' });
    expect(afterSnapshot).toHaveBeenCalledTimes(1);
    expect(afterSnapshot.mock.calls[0]![1]).toMatchObject({ routeId: route.id, source: 'mock' });
  });

  it('does not let an alert failure fail the collection', async () => {
    const route = await stores.routes.create(routeInput);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { run } = await collectRoutes([route], { stores, registry, afterSnapshot: async () => Promise.reject(new Error('rules unreadable')) }, { trigger: 'manual' });
    expect(run.results[0]!.status).toBe('success');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('alert evaluation failed'), 'rules unreadable');
    errors.mockRestore();
  });

  it('uses the alert pipeline by default and can be switched off', async () => {
    const route = await stores.routes.create(routeInput);
    // history first, then a collection: the mock price differs from the seeded one, so alerts are plausible; rules must exist either way
    for (let d = 1; d <= 3; d++) {
      const at = new Date(Date.now() - d * DAY);
      await stores.snapshots.create(buildSnapshotInput({ routeId: route.id, provider: 'aida', source: 'mock', collectedAt: at.toISOString(), collected: mockCruise('aida', route.url, at) }));
    }
    const lines: string[] = [];
    await collectRoutes([route], { stores, registry }, { trigger: 'manual', log: (l) => lines.push(l) });
    expect((await stores.alertRules.list()).length).toBe(2); // defaults were created by the pipeline

    const other = createStores(await mkdtemp(join(tmpdir(), 'cruise-')));
    const r2 = await other.routes.create(routeInput);
    await collectRoutes([r2], { stores: other, registry, afterSnapshot: null }, { trigger: 'manual' });
    expect(await other.alertRules.list()).toEqual([]);
  });
});

function fakePdfBrowser(opts: { fail?: boolean } = {}) {
  const page = { setContent: vi.fn(async () => undefined), pdf: vi.fn(async () => Buffer.from('%PDF-fake')) };
  const close = vi.fn(async () => undefined);
  const browser = { newPage: vi.fn(async () => page), close } as unknown as Browser;
  return { page, close, factory: { launch: vi.fn(async () => (opts.fail ? Promise.reject(new Error('Executable doesn\'t exist at /nowhere\nrun playwright install')) : browser)) } };
}

describe('weekly report', () => {
  const now = new Date(base + 40 * DAY);

  async function seed() {
    const route = await stores.routes.create({ name: 'Fjords & "Co"', provider: 'aida', url: 'https://aida.de/x' });
    for (let d = 0; d < 40; d++) await addSnapshot(route, d, 1500 - 3 * d);
    return route;
  }

  it('writes JSON, CSV and PDF for the week', async () => {
    await seed();
    const { factory, page, close } = fakePdfBrowser();
    const result = await generateWeeklyReport(stores, { now, browserFactory: factory });

    expect(result).toMatchObject({ date: '2026-07-11', pdfError: null });
    expect(result.files).toEqual(['weekly-2026-07-11.json', 'weekly-2026-07-11.csv', 'weekly-2026-07-11.pdf', 'weekly-2026-07-11-deals.csv']);
    const json = JSON.parse((await stores.weeklyReports.read('weekly-2026-07-11.json'))!.data.toString());
    expect(json.routes[0]).toMatchObject({ route: 'Fjords & "Co"', recommendation: 'BUY_NOW' });
    expect(json.routes[0].weekChangePct).toBeLessThan(0);
    expect((await stores.weeklyReports.read('weekly-2026-07-11.csv'))!.data.toString()).toContain('"Fjords & ""Co"""');
    expect((await stores.weeklyReports.read('weekly-2026-07-11.pdf'))!.data.toString()).toBe('%PDF-fake');
    expect(page.setContent).toHaveBeenCalledWith(expect.stringContaining('Fjords &amp; &quot;Co&quot;'), expect.anything());
    expect(close).toHaveBeenCalled();
  });

  it('still writes JSON and CSV when the PDF cannot be rendered', async () => {
    await seed();
    const result = await generateWeeklyReport(stores, { now, browserFactory: fakePdfBrowser({ fail: true }).factory });
    expect(result.files).toEqual(['weekly-2026-07-11.json', 'weekly-2026-07-11.csv', 'weekly-2026-07-11-deals.csv']);
    expect(result.pdfError).toContain("Executable doesn't exist");
    expect(result.pdfError).not.toContain('\n');
  });

  it('can skip the PDF, and copes with no routes', async () => {
    const { factory } = fakePdfBrowser();
    const result = await generateWeeklyReport(stores, { now, pdf: false, browserFactory: factory });
    expect(result.files).toEqual(['weekly-2026-07-11.json', 'weekly-2026-07-11.csv', 'weekly-2026-07-11-deals.csv']);
    expect(factory.launch).not.toHaveBeenCalled();
    expect(result.report.routes).toEqual([]);
  });

  it('renders the report as HTML with every section', async () => {
    await seed();
    const { report } = await generateWeeklyReport(stores, { now, pdf: false });
    const html = weeklyReportHtml(report);
    for (const heading of ['Executive deal summary', 'Best opportunities', 'Biggest price drops this week', 'Provider comparison', 'Recommendations', 'Forecast accuracy']) expect(html).toContain(heading);
    expect(html).toContain('Fjords &amp; &quot;Co&quot;');
    expect(html).not.toContain('Fjords & "Co"');
    const empty = weeklyReportHtml({ ...report, routes: [], bestOpportunities: [], biggestDrops: [], providerComparison: [], forecastAccuracy: { overall: null, byProvider: {} } });
    expect(html).toContain('none this week'); // no fare data in this fixture
    expect(empty).toContain('No route is currently recommended');
    expect(empty).toContain('No route got cheaper');
    expect(empty).toContain('No provider data yet');
    expect(empty).toContain('Not yet measurable');
  });

  it('renders a PDF through the browser factory and always closes the browser', async () => {
    const ok = fakePdfBrowser();
    expect((await renderPdf('<p>x</p>', ok.factory)).toString()).toBe('%PDF-fake');
    expect(ok.page.pdf).toHaveBeenCalledWith(expect.objectContaining({ format: 'A4' }));
    const bad = fakePdfBrowser();
    bad.page.pdf.mockRejectedValueOnce(new Error('print failed'));
    await expect(renderPdf('<p>x</p>', bad.factory)).rejects.toThrow('print failed');
    expect(bad.close).toHaveBeenCalled();
  });

  it('schedules the weekly report for Monday morning and validates the expression', () => {
    expect(DEFAULT_WEEKLY_CRON).toBe('0 8 * * 1');
    expect(() => scheduleWeeklyReport(stores, 'nope')).toThrow(/Invalid cron/);
    void scheduleWeeklyReport(stores, DEFAULT_WEEKLY_CRON, () => undefined).stop();
  });

  describe('daily, weekly and monthly deal reports', () => {
    it('writes each kind to its own folder with the period of that kind', async () => {
      await seed();
      for (const [kind, days] of [['daily', 1], ['weekly', 7], ['monthly', 30]] as const) {
        const r = await generateDealReport(stores, kind, { now, pdf: false });
        expect(r.kind).toBe(kind);
        expect(r.files).toEqual([`${kind}-2026-07-11.json`, `${kind}-2026-07-11.csv`, `${kind}-2026-07-11-deals.csv`]);
        expect(r.report).toMatchObject({ kind, bestUpgrades: expect.any(Array), forecastSummary: expect.any(Array) });
        expect((Date.parse(r.report.periodEnd) - Date.parse(r.report.periodStart)) / DAY).toBe(days);
        expect(await readFile(join(dir, 'reports', kind, `${kind}-2026-07-11.json`), 'utf8')).toContain(`"kind": "${kind}"`);
      }
      expect(await stores.weeklyReports.list('monthly')).toEqual(['monthly-2026-07-11.json', 'monthly-2026-07-11.csv', 'monthly-2026-07-11-deals.csv']);
      expect((await stores.weeklyReports.list()).length).toBe(9);
      expect((await stores.weeklyReports.read('daily-2026-07-11.json'))!.contentType).toBe('application/json');
      expect(await stores.weeklyReports.read('quarterly-2026-07-11.json')).toBeNull();
    });

    it('measures the change over the period of the report: more than a day, a week or a month ago', async () => {
      await seed();
      const later = new Date(base + 39 * DAY + 3_600_000); // an hour after the latest collection
      const week = (await generateDealReport(stores, 'weekly', { now: later, pdf: false })).report;
      const day = (await generateDealReport(stores, 'daily', { now: later, pdf: false })).report;
      expect(day.routes[0]!.weekChangePct).toBeLessThan(0);
      expect(week.routes[0]!.weekChangePct!).toBeLessThan(day.routes[0]!.weekChangePct!); // a steadily falling price fell more over a week than over a day
    });

    it('renders the title, the period words and the new sections in HTML, in English and German', async () => {
      await seed();
      const english = { daily: ['Daily cruise price report', 'Biggest price drops today'], weekly: ['Weekly cruise price report', 'Biggest price drops this week'], monthly: ['Monthly cruise price report', 'Biggest price drops this month'] } as const;
      for (const kind of ['daily', 'weekly', 'monthly'] as const) {
        const { report } = await generateDealReport(stores, kind, { now, pdf: false });
        const html = weeklyReportHtml(report);
        for (const text of [...english[kind], 'Best upgrades', 'Forecast summary', 'No upgrade is worth considering right now.']) expect(html).toContain(text);
      }
      const { report } = await generateDealReport(stores, 'monthly', { now, pdf: false, locale: 'de' });
      const german = weeklyReportHtml(report, 'de');
      for (const text of ['Monatlicher Kreuzfahrt-Preisbericht', 'Größte Preisrückgänge diesen Monat', 'Beste Upgrades', 'Prognose-Zusammenfassung']) expect(german).toContain(text);
      expect(german).toContain('<b>JETZT KAUFEN</b>');
    });

    it('lists the best upgrades and the forecast of every route in the report', async () => {
      const route = await stores.routes.create({ name: 'Upgrade route', provider: 'aida', url: 'https://aida.de/x' });
      for (let d = 0; d < 20; d++) {
        await stores.snapshots.create({
          routeId: route.id, provider: 'aida', source: 'live', collectedAt: new Date(base + d * DAY).toISOString(),
          cruise: { name: 'N', ship: 'S', departure: '2027-03-13', durationNights: 7 }, party: { adults: 2, departureAirport: 'FRA' },
          cabins: [{ category: 'Meerblickkabine', packagePerPerson: 1000, flightPerPerson: 100, packageTotal: 2000, flightTotal: 200 }, { category: 'Balkonkabine', packagePerPerson: 1010, flightPerPerson: 100, packageTotal: 2020, flightTotal: 200 }],
          packagePrice: 2000, flightSurcharge: 200,
        });
      }
      const { report } = await generateDealReport(stores, 'weekly', { now, pdf: false });
      expect(report.bestUpgrades).toHaveLength(1);
      expect(report.bestUpgrades[0]).toMatchObject({ route: 'Upgrade route', from: 'Meerblickkabine', to: 'Balkonkabine', costDifference: 20, verdict: 'RECOMMENDED' });
      expect(report.forecastSummary.map((f) => f.route)).toEqual(['Upgrade route']);
      const html = weeklyReportHtml(report);
      expect(html).toContain('Meerblickkabine → Balkonkabine');
      expect(html).toContain('Recommended upgrade');
    });

    it('schedules daily at 07:30, weekly on Mondays and monthly on the 1st, with overrides from the environment', () => {
      expect([DEFAULT_DAILY_REPORT_CRON, DEFAULT_WEEKLY_CRON, DEFAULT_MONTHLY_REPORT_CRON]).toEqual(['30 7 * * *', '0 8 * * 1', '0 9 1 * *']);
      expect(() => scheduleDealReport(stores, 'monthly', 'nope')).toThrow(/Invalid cron/);
      void scheduleDealReport(stores, 'daily', undefined, () => undefined).stop();
      const defaults = scheduleDealReports(stores, {}, () => undefined);
      expect(defaults).toEqual({ daily: '30 7 * * *', weekly: '0 8 * * 1', monthly: '0 9 1 * *' });
      expect(scheduleDealReports(stores, { DAILY_REPORT_CRON: '0 6 * * *', MONTHLY_REPORT_CRON: '0 10 2 * *' }, () => undefined)).toEqual({ daily: '0 6 * * *', weekly: '0 8 * * 1', monthly: '0 10 2 * *' });
    });
  });

  it('keeps an old report when generating a new week', async () => {
    await seed();
    await generateWeeklyReport(stores, { now, pdf: false });
    await generateWeeklyReport(stores, { now: new Date(now.getTime() + 7 * DAY), pdf: false });
    expect((await stores.weeklyReports.list('weekly')).filter((f) => f.endsWith('.json'))).toEqual(['weekly-2026-07-18.json', 'weekly-2026-07-11.json']);
    expect(await readFile(join(dir, 'reports', 'weekly', 'weekly-2026-07-11.csv'), 'utf8')).toContain('route,provider');
  });
});
