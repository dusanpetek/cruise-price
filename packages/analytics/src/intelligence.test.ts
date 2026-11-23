import { describe, expect, it } from 'vitest';
import type { CruiseSnapshot } from '@cruise/domain';
import { analyzePortfolio, analyzeRoute, analyzeSeries, heatLevelOf, providerScorecards, type RouteRef } from './intelligence';
import { isBuyAction } from './recommendation';
import { buildWeeklyReport, weeklyDealsCsv, weeklyReportCsv } from './weeklyReport';
import { DAY, at, cabin, fare, fareSnapshot, opt, rng, snapshot } from './testing';

const route = (id: string, provider: RouteRef['provider'] = 'aida', name = `Route ${id}`): RouteRef => ({ id, name, provider, url: `https://example.com/${id}` });
const withRoute = (snaps: CruiseSnapshot[], routeId: string) => snaps.map((s) => ({ ...s, id: `${routeId}-${s.id}`, routeId }));

/** `days` snapshots: inside / balcony / suite follow the given price functions per person. */
const history = (days: number, f: { inside: (d: number) => number; balcony?: (d: number) => number }, departure: string | null = '2027-03-13') =>
  Array.from({ length: days }, (_, d) =>
    snapshot(d, [cabin('Innenkabine', f.inside(d)), cabin('Balkonkabine', (f.balcony ?? ((x) => f.inside(x) * 1.6))(d)), cabin('Suite', f.inside(d) * 3)], departure),
  );

describe('analyzeRoute', () => {
  it('gives every route a recommendation, even without data', () => {
    const r = analyzeRoute(route('a'), []);
    expect(r).toMatchObject({ snapshotCount: 0, latestAt: null, analytics: null, savings: null, forecast: null, groups: [], currency: 'EUR' });
    expect(r.recommendation).toMatchObject({ action: 'MONITOR', confidence: 0, reason: 'No price history yet.' });
    expect(r).toMatchObject({ upgrades: [], bestUpgrade: null, recommendedBookingWindow: null, ship: null, lastMinute: { available: false } });
    expect(r.insight).toContain('not enough price history');
    expect(r.recommendationTimeline).toEqual([]);
    expect(r.backtest.samples).toBe(0);
  });

  it('builds the full picture for a route near its low', () => {
    const r = analyzeRoute(route('a', 'aida', 'AIDA Nova'), history(60, { inside: (d) => 1500 - d + (d === 59 ? 0 : 5) }));
    expect(r.snapshotCount).toBe(60);
    expect(r.departure).toBe('2027-03-13');
    expect(r.recommendation.action).toBe('BUY_NOW');
    expect(r.forecast!.model).toBe('linear-regression');
    expect(r.expected30dChangePct).toBeLessThan(0);
    expect(r.cabinForecasts.map((c) => c.category)).toEqual(['Innenkabine', 'Balkonkabine', 'Suite']);
    expect(r.cabinForecasts.every((c) => c.forecast !== null)).toBe(true);
    expect(r.savings!.historicalLow).toBeLessThanOrEqual(r.savings!.current);
    expect(r.insight).toContain('AIDA Nova');
    expect(r.backtest.samples).toBeGreaterThan(5);
    expect(r.recommendationTimeline.length).toBeGreaterThan(5);
    expect(r.bookingWindow.coverageDays).not.toBeNull();
  });

  it('analyses each cabin group separately', () => {
    const r = analyzeRoute(route('a'), history(40, { inside: () => 1000, balcony: (d) => 1800 - 10 * d }));
    expect(r.groups.map((g) => g.group)).toEqual(['inside', 'balcony', 'suite']);
    const balcony = r.groups.find((g) => g.group === 'balcony')!;
    expect(balcony).toMatchObject({ label: 'Balcony', current: 2 * (1800 - 390) + 200, low: 2 * (1800 - 390) + 200, pctToMin: 0 }); // trip totals: cruise + flight
    expect(balcony.expected30dChangePct).toBeLessThan(0);
    expect(balcony.insight).toContain('Balcony cabins on Route a');
    expect(r.groups.find((g) => g.group === 'inside')!.recommendation.action).toBeDefined();
  });

  it('omits groups the newest snapshot no longer offers', () => {
    const snaps = [...history(20, { inside: () => 1000 }).slice(0, 19), snapshot(19, [cabin('Innenkabine', 1000)])];
    expect(analyzeRoute(route('a'), snaps).groups.map((g) => g.group)).toEqual(['inside']);
  });
});

describe('route deal score', () => {
  it('is 0 without data and within 0..100 otherwise', () => {
    expect(analyzeRoute(route('a'), []).dealScore).toBe(0);
    const r = rng(4);
    for (let i = 0; i < 15; i++) {
      const s = analyzeRoute(route('a'), history(30 + i * 4, { inside: (d) => 1000 + (r() - 0.5) * 300 - i * d })).dealScore;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('scores a route at its lowest trip total above one at its highest', () => {
    const low = analyzeRoute(route('a'), history(40, { inside: (d) => 1500 - d }));
    const high = analyzeRoute(route('b'), history(40, { inside: (d) => 1000 + d }));
    expect(low.dealScore).toBeGreaterThan(high.dealScore);
  });

  it('is based on the trip total: a cheaper cruise with a dearer flight is not a better deal', () => {
    const flightUp = Array.from({ length: 30 }, (_, d) => snapshot(d, [cabin('Innenkabine', 1000 - d, 50 + 20 * d)])); // cruise falls, flight rises faster
    const flightFlat = Array.from({ length: 30 }, (_, d) => snapshot(d, [cabin('Innenkabine', 1000 - d, 50)]));
    expect(analyzeRoute(route('a'), flightFlat).dealScore).toBeGreaterThan(analyzeRoute(route('b'), flightUp).dealScore);
    expect(analyzeRoute(route('b'), flightUp).analytics!.trend).toBe('up');
  });
});

describe('analyzePortfolio', () => {
  const items = () => [
    { route: route('buy', 'aida', 'Near the low'), snapshots: withRoute(history(60, { inside: (d) => 1500 - d }), 'buy') },
    { route: route('wait', 'mein-schiff', 'Falling from high'), snapshots: withRoute(history(100, { inside: (d) => (d < 10 ? 350 : 800 - 4 * (d - 10)) }), 'wait') },
    { route: route('flat', 'mein-schiff', 'Flat'), snapshots: withRoute(history(40, { inside: (d) => 900 + (d % 2 ? 60 : 0) }), 'flat') },
    { route: route('empty', 'aida', 'No data yet'), snapshots: [] },
  ];

  it('ranks and groups the routes', () => {
    const p = analyzePortfolio(items(), '2026-06-01T00:00:00.000Z');
    expect(p.routes).toHaveLength(4);
    expect(p.routes.every((r) => r.recommendation.confidence >= 0)).toBe(true);
    expect(p.bestOpportunities.map((r) => r.routeId)).toContain('buy'); // a route a few percent above its low (LIKELY_GOOD) may follow
    expect(p.bestOpportunities.every((r) => isBuyAction(r.recommendation.action))).toBe(true);
    expect(p.bestOpportunities[0]!.routeId).toBe('buy');
    expect(p.highestSavings.map((r) => r.routeId)).not.toContain('empty');
    const savings = p.highestSavings.map((r) => r.savings!.potentialSavings);
    expect(savings).toEqual([...savings].sort((a, b) => b - a));
    expect(p.rankings.deals).toHaveLength(3);
    const vol = p.rankings.volatile.map((r) => r.savings!.volatilityPct);
    expect(vol).toEqual([...vol].sort((a, b) => b - a));
    expect(p.rankings.stable.map((r) => r.routeId)).toEqual([...p.rankings.volatile].reverse().map((r) => r.routeId));
    expect(p.routes.find((r) => r.routeId === 'empty')!.dealScore).toBe(0);
  });

  it('limits the deal ranking to ten routes', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ route: route(`r${i}`), snapshots: withRoute(history(20, { inside: () => 1000 + i }), `r${i}`) }));
    expect(analyzePortfolio(many, 'x').rankings.deals).toHaveLength(10);
  });

  it('is empty for no routes', () => {
    expect(analyzePortfolio([], 'x')).toMatchObject({ routes: [], bestOpportunities: [], providers: [] });
  });
});

describe('providerScorecards', () => {
  it('benchmarks the providers', () => {
    const p = analyzePortfolio(
      [
        { route: route('a', 'aida'), snapshots: withRoute(history(100, { inside: (d) => 2000 - d }), 'a') },
        { route: route('b', 'mein-schiff'), snapshots: withRoute(history(100, { inside: (d) => 1000 + d }), 'b') },
      ],
      'x',
    );
    const [aida, ms] = [p.providers.find((x) => x.provider === 'aida')!, p.providers.find((x) => x.provider === 'mein-schiff')!];
    expect(aida.routes).toBe(1);
    expect(aida.averagePrice).toBeGreaterThan(0);
    expect(aida.averageDiscountPct).toBeGreaterThan(ms.averageDiscountPct); // aida sits at its low, ms at its high
    expect(aida.score).toBeGreaterThan(ms.score);
    expect(aida.forecastAccuracy).not.toBeNull();
    expect(aida.stabilityScore).toBeGreaterThan(0);
  });

  it('leaves forecast accuracy unknown (and the score neutral) without backtest samples', () => {
    const [card] = providerScorecards([analyzeRoute(route('a'), history(8, { inside: () => 1000 }))]);
    expect(card!.forecastAccuracy).toBeNull();
    expect(providerScorecards([analyzeRoute(route('a'), [])])).toEqual([]);
  });
});

describe('fare data in the analysis', () => {
  const FARES = [fare('CLASSIC', { includedServices: ['A'] }), fare('PREMIUM', { includedServices: ['A', 'B'] })];
  const withFares = (days: number, base: number) => Array.from({ length: days }, (_, d) => fareSnapshot(d, FARES, [opt('Balkonkabine', 'CLASSIC', base - d), opt('Balkonkabine', 'PREMIUM', base + 200 - d), opt('Suite', 'PREMIUM', base * 2 - d)]));

  it('adds per-option intelligence to a route and to the portfolio', () => {
    const r = analyzeRoute(route('a'), withFares(30, 2000));
    expect(r.options).toHaveLength(3);
    const p = analyzePortfolio([{ route: route('a'), snapshots: withRoute(withFares(30, 2000), 'a') }, { route: route('b'), snapshots: withRoute(withFares(30, 2500), 'b') }, { route: route('none'), snapshots: [] }], 'x');
    expect(p.options).toHaveLength(6);
    expect(p.deals.topDeals.length).toBeGreaterThan(0);
    expect(p.deals.bestSuite.every((o) => o.cabinGroup === 'suite')).toBe(true);
    expect(p.fareHighlights.cheapest!.routeId).toBe('a');
    expect(p.fareHighlights.largestSaving!.saving.amount).toBe(200);
  });

  it('has no options for snapshots that predate fares', () => {
    expect(analyzeRoute(route('a'), history(10, { inside: () => 1000 })).options).toEqual([]);
    expect(analyzePortfolio([{ route: route('a'), snapshots: history(10, { inside: () => 1000 }) }], 'x').fareHighlights.cheapest).toBeNull();
  });
});

describe('favorite fare and cabin', () => {
  const FARES = [fare('CLASSIC', { includedServices: ['A'] }), fare('PREMIUM', { includedServices: ['A', 'B'] })];
  const snaps = Array.from({ length: 30 }, (_, d) => fareSnapshot(d, FARES, [opt('Balkonkabine', 'CLASSIC', 2000 - d), opt('Balkonkabine', 'PREMIUM', 2400 - 2 * d), opt('Suite', 'PREMIUM', 5000)]));
  const fav = (fareCode: string | null, cabin: string | null): RouteRef => ({ ...route('a'), favorite: { fareCode, cabin } });

  it('has no focus without a favorite, and the headline is the cheapest cabin', () => {
    const r = analyzeRoute(route('a'), snaps);
    expect(r.focus).toBeNull();
    expect(r.analytics!.current).toBe(r.analytics!.currentCruise + r.analytics!.currentFlightSurcharge);
  });

  it('makes the favorite fare + cabin the headline: price, trend, recommendation and insight follow it', () => {
    const plain = analyzeRoute(route('a'), snaps);
    const r = analyzeRoute(fav('PREMIUM', 'Balkonkabine'), snaps);
    expect(r.focus).toEqual({ fareCode: 'PREMIUM', fareName: 'PREMIUM', cabin: 'Balkonkabine' });
    expect(r.analytics!.current).toBeGreaterThan(plain.analytics!.current);
    expect(r.analytics!.current).toBe(r.analytics!.currentCruise + r.analytics!.currentFlightSurcharge);
    expect(r.insight).toContain('PREMIUM');
    expect(r.insight).toContain('Balkonkabine');
    expect(r.forecast).not.toBeNull();
    expect(r.options).toEqual(plain.options); // the fare comparison itself always covers every fare
    expect(r.dealScore).toBeGreaterThanOrEqual(0);
  });

  it('works with only a fare or only a cabin', () => {
    expect(analyzeRoute(fav('PREMIUM', null), snaps).focus).toMatchObject({ fareCode: 'PREMIUM', cabin: null });
    expect(analyzeRoute(fav(null, 'Suite'), snaps).analytics!.current).toBeGreaterThan(analyzeRoute(route('a'), snaps).analytics!.current);
  });

  it('falls back to the cheapest cabin when the favorite is no longer offered', () => {
    const plain = analyzeRoute(route('a'), snaps);
    for (const f of [fav('GONE', null), fav('CLASSIC', 'Suite'), fav(null, null)]) {
      const r = analyzeRoute(f, snaps);
      expect(r.focus).toBeNull();
      expect(r.analytics).toEqual(plain.analytics);
    }
  });
});

describe('weekly report', () => {
  const now = new Date(Date.UTC(2026, 0, 1) + 59 * DAY);
  const data = [
    { route: route('buy', 'aida', 'Fjords, "Norway"'), snapshots: withRoute(history(60, { inside: (d) => 1500 - 2 * d }), 'buy') },
    { route: route('up', 'mein-schiff', 'Canaries'), snapshots: withRoute(history(60, { inside: (d) => 800 + 5 * d }), 'up') },
    { route: route('new', 'aida', 'Brand new'), snapshots: withRoute([57, 58, 59].map((d) => snapshot(d, [cabin('Innenkabine', 900)])), 'new') },
  ];
  const portfolio = analyzePortfolio(data, now.toISOString());
  const report = buildWeeklyReport(portfolio, new Map(data.map((d) => [d.route.id, d.snapshots])), now);

  it('covers the last seven days', () => {
    expect(report.periodEnd).toBe(now.toISOString());
    expect(Date.parse(report.periodEnd) - Date.parse(report.periodStart)).toBe(7 * DAY);
    expect(report.routes).toHaveLength(3);
  });

  it('reports week-on-week change, drops, opportunities and provider comparison', () => {
    const fjords = report.routes.find((r) => r.route.startsWith('Fjords'))!;
    expect(fjords.weekChangePct).toBeLessThan(0);
    expect(report.routes.find((r) => r.route === 'Canaries')!.weekChangePct).toBeGreaterThan(0);
    expect(report.routes.find((r) => r.route === 'Brand new')!.weekChangePct).toBeNull();
    expect(report.biggestDrops.map((r) => r.route)).toEqual([fjords.route]);
    expect(report.bestOpportunities.every((r) => isBuyAction(r.recommendation))).toBe(true);
    expect(report.providerComparison).toHaveLength(2);
    expect(report.forecastAccuracy.overall).not.toBeNull();
    expect(Object.keys(report.forecastAccuracy.byProvider).sort()).toEqual(['aida', 'mein-schiff']);
  });

  it('has an unknown accuracy before any backtest exists', () => {
    const tiny = analyzePortfolio([{ route: route('t'), snapshots: withRoute(history(3, { inside: () => 900 }), 't') }], now.toISOString());
    expect(buildWeeklyReport(tiny, new Map(), now).forecastAccuracy.overall).toBeNull();
  });

  it('exports one CSV row per route with escaping', () => {
    const csv = weeklyReportCsv(report);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('route,provider,current,currentCruise,currentFlight,historicalLow,historicalHigh,potentialSavings,weekChangePct,expected30dChangePct,recommendation,confidence,dealScore,reason');
    expect(csv).toContain('"Fjords, ""Norway"""');
    expect(csv.split('\n').filter((l) => l.startsWith('Canaries')).length).toBe(1);
    expect(at(0)).toBeTruthy();
  });
});

describe('weekly executive deal report', () => {
  const now = new Date(Date.UTC(2026, 0, 1) + 29 * DAY);
  const FARES = [fare('CLASSIC', { includedServices: ['A'] }), fare('PREMIUM', { includedServices: ['A', 'B', 'C'] })];
  const hist = (id: string, scale: number) =>
    withRoute(
      Array.from({ length: 30 }, (_, d) => fareSnapshot(d, FARES, [opt('Balkonkabine', 'CLASSIC', 2000 * scale - 10 * d), opt('Balkonkabine', 'PREMIUM', 2300 * scale), opt('Suite', 'PREMIUM', 5000 * scale), opt('Innenkabine', 'CLASSIC', 1200 * scale + 5 * d)])),
      id,
    );
  const data = [{ route: route('a', 'aida', 'Canaries'), snapshots: hist('a', 1) }, { route: route('b', 'mein-schiff', 'Fjords'), snapshots: hist('b', 1.2) }];
  const report = buildWeeklyReport(analyzePortfolio(data, now.toISOString()), new Map(data.map((d) => [d.route.id, d.snapshots])), now);

  it('names the best deal, balcony, suite, biggest drop and best fare, each with cruise + flight = total', () => {
    const { bestDeal, bestBalcony, bestSuite, biggestDrop, bestFare } = report.deals;
    for (const d of [bestDeal, bestBalcony, bestSuite, biggestDrop, bestFare]) {
      expect(d).not.toBeNull();
      expect(d!.cruisePrice + d!.flightPrice).toBe(d!.totalPrice);
    }
    expect(bestBalcony!.cabin).toBe('Balkonkabine');
    expect(bestSuite!.cabin).toBe('Suite');
    expect(biggestDrop!.weekChangePct).toBeLessThan(0);
    expect(biggestDrop!.fare).toBe('CLASSIC'); // the only balcony option whose price fell
    expect(bestFare!.fareScore).toBeGreaterThan(0);
  });

  it('is empty (not invented) for routes without fare data', () => {
    const plain = [{ route: route('p'), snapshots: withRoute(history(30, { inside: () => 1000 }), 'p') }];
    const r = buildWeeklyReport(analyzePortfolio(plain, now.toISOString()), new Map(plain.map((d) => [d.route.id, d.snapshots])), now);
    expect(r.deals).toEqual({ bestDeal: null, bestBalcony: null, bestSuite: null, biggestDrop: null, bestFare: null });
    expect(weeklyDealsCsv(r)).toBe('headline,route,provider,cabin,fare,cruisePrice,flightPrice,totalPrice,dealScore,fareScore,weekChangePct\n');
  });

  it('exports one CSV row per headline', () => {
    const lines = weeklyDealsCsv(report).trimEnd().split('\n');
    expect(lines[0]).toBe('headline,route,provider,cabin,fare,cruisePrice,flightPrice,totalPrice,dealScore,fareScore,weekChangePct');
    expect(lines.map((l) => l.split(',')[0]).slice(1)).toEqual(['Best deal', 'Best balcony', 'Best suite', 'Biggest drop', 'Best fare']);
    expect(weeklyReportCsv(report)).toContain('route,provider');
  });
});

describe('analyzeSeries (any trip-total series)', () => {
  const series = (n: number, price: (d: number) => number) => Array.from({ length: n }, (_, d) => ({ snapshotId: `s${d}`, collectedAt: at(d), price: price(d), cruise: price(d) - 200, flight: 200 }));

  it('analyses a series like a route: statistics, forecast, recommendation, insight, deal score', () => {
    const a = analyzeSeries({ series: series(40, (d) => 3000 - 10 * d), routeName: 'Canaries', label: 'PREMIUM', provider: 'aida' });
    expect(a.analytics).toMatchObject({ count: 40, current: 2610, min: 2610, currentCruise: 2410, currentFlightSurcharge: 200 });
    expect(a.forecast!.model).toBe('linear-regression');
    expect(a.recommendation.action).toBe('BUY_NOW');
    expect(a.insight).toContain('Canaries');
    expect(a.dealScore).toBeGreaterThan(0);
    expect(a.savings!.historicalLow).toBe(2610);
  });

  it('copes with an empty series and with a German locale', () => {
    const empty = analyzeSeries({ series: [], routeName: 'R', label: 'x', provider: 'aida' });
    expect(empty).toMatchObject({ analytics: null, forecast: null, savings: null, dealScore: 0 });
    expect(empty.recommendation.confidence).toBe(0);
    const de = analyzeSeries({ series: series(40, (d) => 3000 - 10 * d), routeName: 'Kanaren', label: 'PREMIUM', provider: 'aida', locale: 'de' });
    expect(de.recommendation.reason).not.toBe(analyzeSeries({ series: series(40, (d) => 3000 - 10 * d), routeName: 'Kanaren', label: 'PREMIUM', provider: 'aida' }).recommendation.reason);
    expect(de.insight).toContain('Empfehlung');
  });
});

describe('deal intelligence in the route analysis (0.6)', () => {
  const FARES = [fare('VARIO', { includedServices: ['A'] }), fare('PREMIUM', { includedServices: ['A', 'B', 'C'], refundable: true })];
  const departure = '2026-05-01';
  const snaps = Array.from({ length: 60 }, (_, d) =>
    fareSnapshot(d, FARES, [opt('Meerblickkabine', 'VARIO', 2000 - d), opt('Balkonkabine', 'VARIO', 2300 - d), opt('Balkonkabine', 'PREMIUM', 3200 - d), opt('Suite', 'VARIO', 4500 - d)], departure),
  );
  const r = analyzeRoute(route('a', 'aida', 'AIDA Nova'), snaps);

  it('gives every option a fare value score, a value label and a recommended fare per cabin', () => {
    expect(r.options.every((o) => o.valueScore >= 0 && o.valueScore <= 100 && o.valueLabel.endsWith('value'))).toBe(true);
    const balcony = r.options.filter((o) => o.cabinCategory === 'Balkonkabine');
    expect(balcony.filter((o) => o.recommendedFare)).toHaveLength(1);
    expect(balcony.find((o) => o.recommendedFare)!.fare.fareCode).toBe('VARIO');
    expect(r.options.filter((o) => o.recommendedFare)).toHaveLength(3); // one per cabin
  });

  it('describes the trip on every option, for the deal finder', () => {
    const o = r.options[0]!;
    expect(o).toMatchObject({ ship: 'Ship', departure, durationNights: 7 });
    expect(o.historicalAverage).toBeGreaterThan(o.historicalLow);
    expect(o.recentChange!.amount).toBeLessThan(0); // prices fall one euro a day
    expect(o.expectedSavings).not.toBeNull();
    expect(o.dealComponents).toMatchObject({ historicalPosition: expect.any(Number), forecastOpportunity: expect.any(Number), trend: expect.any(Number), fareValue: expect.any(Number) });
  });

  it('adds the upgrade opportunities of the route and the best one', () => {
    expect(r.upgrades.length).toBeGreaterThan(0);
    expect(r.upgrades.map((u) => u.upgradeScore)).toEqual([...r.upgrades.map((u) => u.upgradeScore)].sort((a, b) => b - a));
    expect(r.bestUpgrade).toEqual(r.upgrades[0]);
    // the deal score of an upgrade target includes the upgrade value
    const target = r.options.find((o) => o.fare.fareCode === 'VARIO' && o.cabinCategory === 'Balkonkabine')!;
    expect(target.dealComponents.upgradeValue).not.toBeNull();
  });

  it('adds last-minute intelligence and the recommended booking window to every route', () => {
    expect(r.lastMinute.available).toBe(true);
    expect(r.recommendedBookingWindow!.from).toBeLessThan(r.recommendedBookingWindow!.to);
    expect(analyzeRoute(route('b'), []).lastMinute.available).toBe(false);
    expect(analyzeRoute(route('c'), history(30, { inside: () => 1000 }, null)).recommendedBookingWindow).toBeNull(); // no departure date
  });

  it('colours every cabin group for the heatmap: strong, neutral or poor', () => {
    const rising = analyzeRoute(route('d'), history(60, { inside: (d) => 1000 + d * 8 }));
    const falling = analyzeRoute(route('e'), history(60, { inside: (d) => 2000 - d * 8 }));
    for (const g of [...r.groups, ...rising.groups, ...falling.groups]) {
      expect(g.heat.score).toBe(g.dealScore);
      expect(['strong', 'neutral', 'poor']).toContain(g.heat.level);
      expect(g.heat.level).toBe(heatLevelOf(g.heat.score));
    }
    expect(heatLevelOf(65)).toBe('strong');
    expect(heatLevelOf(64)).toBe('neutral');
    expect(heatLevelOf(45)).toBe('neutral');
    expect(heatLevelOf(44)).toBe('poor');
    expect(falling.groups[0]!.heat.score).toBeGreaterThan(rising.groups[0]!.heat.score);
    const balcony = r.groups.find((g) => g.group === 'balcony')!;
    expect(balcony.valueScore).not.toBeNull();
    expect(balcony.upgradeScore).not.toBeNull();
    expect(falling.groups[0]).toMatchObject({ group: 'inside', valueScore: null, upgradeScore: null }); // no fare data: no value score; nothing to upgrade into the lowest group
  });

  it('feeds the fare value and upgrade score into the recommendation of a favorite fare + cabin', () => {
    const fav = analyzeRoute({ ...route('a'), favorite: { fareCode: 'PREMIUM', cabin: 'Balkonkabine' } }, snaps);
    expect(fav.recommendation.factors.fareValue).not.toBeNull();
    expect(fav.recommendation.explanation.join('\n')).toContain('Fare value score');
  });

  it('puts the best upgrade and the ranked upgrades into the portfolio', () => {
    const p = analyzePortfolio([{ route: route('a'), snapshots: withRoute(snaps, 'a') }, { route: route('b'), snapshots: withRoute(snaps, 'b') }], 'x');
    expect(p.upgrades.length).toBe(2 * r.upgrades.length);
    expect(p.bestUpgrade!.upgradeScore).toBe(Math.max(...p.upgrades.map((u) => u.upgradeScore)));
    expect(analyzePortfolio([], 'x')).toMatchObject({ upgrades: [], bestUpgrade: null });
  });
});
