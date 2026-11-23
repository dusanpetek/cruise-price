import { describe, expect, it } from 'vitest';
import { buildHistoricalDataset } from './historical';
import { fare, fareSnapshot, opt, snapshot, cabin } from './testing';

const FARES = [fare('CLASSIC', { includedServices: ['A'] }), fare('PREMIUM', { includedServices: ['A', 'B'] })];
const route = { id: 'r1', name: 'Canaries', provider: 'aida' as const };
const history = (days: number) =>
  Array.from({ length: days }, (_, d) => fareSnapshot(d, FARES, [opt('Balkonkabine', 'CLASSIC', 2000 - d * 5 + (d === 20 ? -600 : 0)), opt('Balkonkabine', 'PREMIUM', 2400 - d * 5), opt('Innenkabine', 'CLASSIC', 1300 + (d % 10) * 20)], '2026-06-01'));

describe('buildHistoricalDataset', () => {
  const ds = buildHistoricalDataset(route, history(70), '2026-03-12T00:00:00.000Z');

  it('identifies the route and the period', () => {
    expect(ds).toMatchObject({ routeId: 'r1', routeName: 'Canaries', provider: 'aida', generatedAt: '2026-03-12T00:00:00.000Z', snapshotCount: 70 });
    expect(ds.firstAt).toBe('2026-01-01T00:00:00.000Z');
    expect(ds.lastAt).toBe('2026-03-11T00:00:00.000Z');
  });

  it('keeps historical lows and highs for the route and for every cabin x fare', () => {
    expect(ds.lows.route!.price).toBeLessThan(ds.lows.highest!.price);
    expect(ds.lows.route!.at < ds.lows.highest!.at || ds.lows.route!.at > ds.lows.highest!.at).toBe(true);
    expect(ds.lows.byOption).toHaveLength(3);
    const classic = ds.lows.byOption.find((o) => o.cabinCategory === 'Balkonkabine' && o.fareCode === 'CLASSIC')!;
    expect(classic).toMatchObject({ fareName: 'CLASSIC', samples: 70 });
    expect(classic.low.at).toBe('2026-01-21T00:00:00.000Z'); // the dip on day 20
    expect(classic.low.price).toBeLessThan(classic.average);
    expect(classic.high.price).toBeGreaterThan(classic.average);
  });

  it('has booking window statistics: buckets, the 180/120/90/60/30/14/7 day marks, the lowest window and the recommended one', () => {
    const w = ds.bookingWindowStats;
    expect(w.buckets.length).toBeGreaterThan(0);
    expect(w.marks.map((m) => m.daysBefore)).toEqual([180, 120, 90, 60, 30, 14, 7]);
    expect(w.lowestWindow).not.toBeNull();
    expect(w.recommended!.from).toBeLessThan(w.recommended!.to);
  });

  it('has fare statistics: surcharge over the cheapest fare, totals and value', () => {
    expect(ds.fareStats.map((f) => f.fareCode).sort()).toEqual(['CLASSIC', 'PREMIUM']);
    const classic = ds.fareStats.find((f) => f.fareCode === 'CLASSIC')!;
    const premium = ds.fareStats.find((f) => f.fareCode === 'PREMIUM')!;
    expect(classic).toMatchObject({ cabins: 2, averagePremiumPct: 0 });
    expect(premium.cabins).toBe(1);
    expect(premium.averagePremiumPct).toBeGreaterThan(0);
    expect(premium.lowestTotal).toBeGreaterThan(0);
    expect(classic.averageValueScore).toBeGreaterThan(premium.averageValueScore);
  });

  it('records the deal score and the recommendation over time', () => {
    expect(ds.dealScoreHistory.length).toBeGreaterThan(10);
    expect(ds.dealScoreHistory.length).toBeLessThanOrEqual(60);
    expect(ds.dealScoreHistory.every((p) => p.score >= 0 && p.score <= 100)).toBe(true);
    expect(ds.dealScoreHistory.at(-1)!.at).toBe(ds.lastAt);
    expect(ds.recommendationHistory.length).toBeGreaterThan(5);
    expect(ds.recommendationHistory[0]!.at).toBe(new Date(ds.recommendationHistory[0]!.t).toISOString());
  });

  it('survives routes without data, without fares and without a departure', () => {
    const empty = buildHistoricalDataset(route, [], 'x');
    expect(empty).toMatchObject({ snapshotCount: 0, firstAt: null, lastAt: null, fareStats: [], dealScoreHistory: [], recommendationHistory: [] });
    expect(empty.lows).toEqual({ route: null, highest: null, byOption: [] });
    const plain = buildHistoricalDataset(route, Array.from({ length: 20 }, (_, d) => snapshot(d, [cabin('Innenkabine', 800 + d)])), 'x');
    expect(plain.fareStats).toEqual([]);
    expect(plain.bookingWindowStats.recommended).toBeNull();
    expect(plain.lows.route!.price).toBeGreaterThan(0);
  });

  it('is plain JSON (it is stored on disk)', () => {
    expect(JSON.parse(JSON.stringify(ds))).toEqual(ds);
  });
});
