import { describe, expect, it } from 'vitest';
import { makePricing, type CollectionRun } from '@cruise/domain';
import {
  buildDailyReport,
  cabinBand,
  cabinCategories,
  cabinComparison,
  computeAnalytics,
  filterByRange,
  summarizeRuns,
  toSeries,
} from './index';
import { cabin, fare, fareSnapshot, opt, priced, snapshot } from './testing';

const DAY = 86_400_000;
const at = (day: number) => new Date(Date.UTC(2026, 0, 1) + day * DAY).toISOString();
const snap = (day: number, packagePrice: number, flightSurcharge = 0) => ({ collectedAt: at(day), packagePrice, flightSurcharge });

describe('computeAnalytics', () => {
  it('returns null without snapshots', () => {
    expect(computeAnalytics([])).toBeNull();
  });

  it('computes current, min, max and average', () => {
    const a = computeAnalytics([snap(1, 1000), snap(2, 1200), snap(3, 1100)])!;
    expect(a).toMatchObject({ count: 3, current: 1100, min: 1000, max: 1200, average: 1100 });
  });

  it('computes differences and percentages against min and max', () => {
    const a = computeAnalytics([snap(1, 1000), snap(2, 1250), snap(3, 1100)])!;
    expect(a.diffToMin).toBe(100);
    expect(a.diffToMax).toBe(-150);
    expect(a.pctToMin).toBe(10);
    expect(a.pctToMax).toBe(-12);
  });

  it('treats the latest snapshot by time as current regardless of input order', () => {
    const a = computeAnalytics([snap(3, 900), snap(1, 1000), snap(2, 950)])!;
    expect(a.current).toBe(900);
    expect(a.previous).toBe(950);
    expect(a.trend).toBe('down');
  });

  it('reports trend up, down and flat', () => {
    expect(computeAnalytics([snap(1, 100), snap(2, 110)])!.trend).toBe('up');
    expect(computeAnalytics([snap(1, 110), snap(2, 100)])!.trend).toBe('down');
    expect(computeAnalytics([snap(1, 100), snap(2, 100)])!.trend).toBe('flat');
  });

  it('handles a single snapshot', () => {
    const a = computeAnalytics([snap(1, 1000)])!;
    expect(a).toMatchObject({ previous: null, change: 0, trend: 'flat', diffToMin: 0, diffToMax: 0, pctToMin: 0, pctToMax: 0, daysSinceLowest: 0, change30d: null });
  });

  it('analyses the TRIP total (cruise + flight) and keeps its parts available', () => {
    const a = computeAnalytics([snap(1, 1000, 100), snap(2, 1000, 300)])!;
    expect(a).toMatchObject({ current: 1300, currentTotal: 1300, currentCruise: 1000, currentFlightSurcharge: 300, currentMandatoryFees: 0, min: 1100, max: 1300, trend: 'up', change: 200 });
  });

  it('ranks by trip total: a cheaper cruise with a dearer flight is not the low', () => {
    // cruise falls from 1000 to 900, but the flight rises from 100 to 400: the trip got dearer
    const a = computeAnalytics([snap(1, 1000, 100), snap(2, 900, 400)])!;
    expect(a).toMatchObject({ current: 1300, min: 1100, trend: 'up', pctToMin: 18.18 });
  });

  it('includes mandatory fees in the trip total', () => {
    expect(computeAnalytics([{ ...snap(1, 1000, 100), mandatoryFees: 100 }])).toMatchObject({ current: 1200, currentMandatoryFees: 100 });
  });

  it('does not divide by zero when the minimum is 0', () => {
    expect(computeAnalytics([snap(1, 0), snap(2, 50)])!.pctToMin).toBe(0);
  });

  describe('history metrics', () => {
    const series = [snap(0, 1000), snap(10, 800), snap(20, 900), snap(40, 850), snap(50, 950)];

    it('reports best and worst ever with when they happened', () => {
      const a = computeAnalytics(series)!;
      expect(a).toMatchObject({ min: 800, max: 1000, minAt: at(10), maxAt: at(0) });
    });

    it('counts whole days since the lowest price', () => {
      expect(computeAnalytics(series)!.daysSinceLowest).toBe(40);
      expect(computeAnalytics([snap(0, 900), snap(5, 800)])!.daysSinceLowest).toBe(0);
    });

    it('uses the most recent snapshot when the lowest price repeats', () => {
      const a = computeAnalytics([snap(0, 800), snap(5, 900), snap(9, 800), snap(12, 950)])!;
      expect(a.minAt).toBe(at(9));
      expect(a.daysSinceLowest).toBe(3);
    });

    it('computes the change since the first collection', () => {
      const a = computeAnalytics(series)!;
      expect(a.changeSinceFirst).toBe(-50);
      expect(a.changeSinceFirstPct).toBe(-5);
    });

    it('computes the 30-day change against the last snapshot at least 30 days older', () => {
      const a = computeAnalytics(series)!; // latest day 50 -> baseline is day 20 (900)
      expect(a.change30d).toBe(50);
      expect(a.change30dPct).toBe(5.56);
    });

    it('has no 30-day change without enough history', () => {
      const a = computeAnalytics([snap(30, 1000), snap(40, 900)])!;
      expect(a.change30d).toBeNull();
      expect(a.change30dPct).toBeNull();
    });
  });
});

const full = snapshot;

describe('series helpers', () => {
  const snaps = [
    full(0, [cabin('Inside', 600), cabin('Balcony', 900)]),
    full(40, [cabin('Inside', 550), cabin('Balcony', 950), cabin('Suite', 2000)]),
    full(80, [cabin('Inside', 580), cabin('Balcony', 920), cabin('Suite', 1900)]),
  ];

  it('filters by range relative to the latest snapshot', () => {
    expect(filterByRange(snaps, '30d').map((s) => s.id)).toEqual(['s80']);
    expect(filterByRange(snaps, '90d')).toHaveLength(3);
    expect(filterByRange(snaps, 'all')).toHaveLength(3);
    expect(filterByRange([], '30d')).toEqual([]);
  });

  it('lists cabin categories in first-seen order', () => {
    expect(cabinCategories(snaps)).toEqual(['Inside', 'Balcony', 'Suite']);
  });

  it('builds the headline series by default and a per-cabin series on request', () => {
    expect(toSeries(snaps).map((p) => p.packagePrice)).toEqual([1200, 1100, 1160]);
    expect(toSeries(snaps, 'Suite')).toEqual([
      { collectedAt: at(40), packagePrice: 4000, flightSurcharge: 200, mandatoryFees: 0 },
      { collectedAt: at(80), packagePrice: 3800, flightSurcharge: 200, mandatoryFees: 0 },
    ]);
    expect(toSeries(snaps, 'Nope')).toEqual([]);
  });

  it('builds the cabin comparison rows as trip totals (cruise + flight)', () => {
    expect(cabinComparison(snaps)[1]).toEqual({ t: Date.parse(at(40)), Inside: 1300, Balcony: 2100, Suite: 4200 });
    expect(cabinComparison([{ ...snaps[0]!, cabins: [] }])).toEqual([]);
  });

  it('can limit the cabin comparison and the band to one fare', () => {
    const fares = [fare('CLASSIC'), fare('PREMIUM')];
    const withFares = [
      fareSnapshot(0, fares, [opt('Inside', 'CLASSIC', 1000), opt('Balcony', 'CLASSIC', 1500), opt('Balcony', 'PREMIUM', 1700)]),
      fareSnapshot(1, fares, [opt('Inside', 'CLASSIC', 900)]), // PREMIUM not offered
    ];
    expect(cabinComparison(withFares, 'PREMIUM')).toEqual([{ t: Date.parse(at(0)), Balcony: 2880 }]);
    expect(cabinComparison(withFares, 'CLASSIC')[1]).toEqual({ t: Date.parse(at(1)), Inside: 2080 });
    expect(cabinBand(withFares, 'CLASSIC')[0]).toEqual({ t: Date.parse(at(0)), min: 2180, max: 2680 });
    expect(cabinBand(withFares, 'PREMIUM')).toHaveLength(1);
    expect(cabinBand(withFares)).toHaveLength(2); // without a fare: every snapshot
  });

  it('builds the min/max band of trip totals, falling back to the headline trip total without cabins', () => {
    expect(cabinBand(snaps)[0]).toEqual({ t: Date.parse(at(0)), min: 1400, max: 2000 });
    const bare = { ...snaps[0]!, cabins: [], packagePrice: 777, flightSurcharge: 100, pricing: makePricing({ passengers: 2, cruiseTotal: 777, flightTotal: 100 }) };
    expect(cabinBand([bare])[0]).toMatchObject({ min: 877, max: 877 });
  });
});

describe('collection analytics', () => {
  const result = (routeId: string, status: 'success' | 'failed', provider: 'aida' | 'mein-schiff' | null, durationMs = 1000) => ({
    routeId,
    routeName: `Route ${routeId}`,
    provider,
    status,
    durationMs,
    snapshotId: status === 'success' ? `snap-${routeId}` : null,
    error: status === 'failed' ? 'boom' : null,
    failureId: status === 'failed' ? `fail-${routeId}` : null,
  });
  const run = (id: string, startedAt: string, results: ReturnType<typeof result>[]): CollectionRun => ({
    id,
    trigger: 'scheduled',
    startedAt,
    finishedAt: startedAt.replace(':00.000Z', ':05.000Z'),
    results,
  });
  const runs = [
    run('a', '2026-11-16T10:00:00.000Z', [result('1', 'success', 'aida', 2000)]),
    run('b', '2026-11-17T06:00:00.000Z', [result('1', 'failed', 'aida', 500), result('2', 'success', 'mein-schiff', 1500)]),
    run('c', '2026-11-17T12:00:00.000Z', [result('1', 'success', 'aida', 1000), result('2', 'failed', 'mein-schiff', 3000), result('3', 'failed', null, 100)]),
  ];

  it('builds the daily report for one UTC day with a provider breakdown', () => {
    const r = buildDailyReport(runs, '2026-11-17', '2026-11-17T23:00:00.000Z');
    expect(r).toMatchObject({ date: '2026-11-17', runs: 2, collections: 5, successes: 2, failures: 3, successRate: 0.4, averageDurationMs: 1220 });
    expect(r.providers.aida).toEqual({ collections: 2, successes: 1, failures: 1, averageDurationMs: 750 });
    expect(r.providers['mein-schiff']).toMatchObject({ collections: 2, successes: 1, failures: 1 });
    expect(r.providers.unknown).toMatchObject({ collections: 1, failures: 1 });
  });

  it('reports a perfect rate for a day without collections', () => {
    expect(buildDailyReport(runs, '2026-01-01', 'x')).toMatchObject({ collections: 0, successRate: 1, averageDurationMs: 0, providers: {} });
  });

  it('summarises runs for the dashboard widgets', () => {
    const s = summarizeRuns(runs);
    expect(s.lastRun?.id).toBe('c');
    expect(s.routesProcessed).toBe(3);
    expect(s.successRate).toBeCloseTo(3 / 6);
    expect(s.failedRoutes.map((f) => f.routeId).sort()).toEqual(['2', '3']);
    expect(s.lastFailure).toMatchObject({ routeName: 'Route 2', failureId: 'fail-2' });
  });

  it('applies the provider filter', () => {
    const s = summarizeRuns(runs, 'aida');
    expect(s.routesProcessed).toBe(1);
    expect(s.successRate).toBeCloseTo(2 / 3);
    expect(s.failedRoutes).toEqual([]);
  });

  it('handles no runs', () => {
    expect(summarizeRuns([])).toMatchObject({ lastRun: null, routesProcessed: 0, successRate: null, failedRoutes: [], lastFailure: null });
  });
});
