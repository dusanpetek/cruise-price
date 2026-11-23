import { describe, expect, it } from 'vitest';
import { dealFilterChoices, isBelowAverage, RANKING_MODES, searchDeals } from './dealSearch';
import { analyzeOptions } from './fares';
import { fare, fareSnapshot, opt } from './testing';

const FARES = [fare('CLASSIC', { includedServices: ['A'] }), fare('PREMIUM', { includedServices: ['A', 'B', 'C'], refundable: true })];
const build = (id: string, name: string, provider: 'aida' | 'mein-schiff', base: number, ship: string, departure: string, nights: number, trend = 0) => {
  const snaps = Array.from({ length: 30 }, (_, d) => {
    const s = fareSnapshot(d, FARES, [opt('Innenkabine', 'CLASSIC', base - 500 + trend * d), opt('Balkonkabine', 'CLASSIC', base + trend * d), opt('Balkonkabine', 'PREMIUM', base + 300 + trend * d), opt('Suite', 'PREMIUM', base + 1500 + trend * d)], departure);
    return { ...s, routeId: id, provider, id: `${id}-${s.id}`, cruise: { ...s.cruise, ship, durationNights: nights } };
  });
  return analyzeOptions({ id, name, provider }, snaps);
};
const all = [
  ...build('canaries', 'Canary Islands', 'aida', 2000, 'AIDA Nova', '2027-03-13', 7, -10), // falling
  ...build('norway', 'Norwegian Fjords', 'mein-schiff', 2600, 'Mein Schiff Relax', '2027-06-20', 14, 6), // rising
  ...build('med', 'Mediterranean', 'aida', 1800, 'AIDA Cosma', '2027-03-27', 10, 0),
];
const ids = (xs: typeof all) => xs.map((o) => `${o.routeId}/${o.cabinCategory}/${o.fare.fareCode}`);

describe('searchDeals filters', () => {
  it('returns everything without filters', () => {
    expect(searchDeals(all)).toHaveLength(all.length);
    expect(all).toHaveLength(12);
  });

  it('filters by provider, route, ship, cabin, cabin group and fare', () => {
    expect(new Set(searchDeals(all, { provider: 'mein-schiff' }).map((o) => o.routeId))).toEqual(new Set(['norway']));
    expect(new Set(searchDeals(all, { routeId: 'med' }).map((o) => o.routeId))).toEqual(new Set(['med']));
    expect(new Set(searchDeals(all, { ship: 'AIDA Nova' }).map((o) => o.routeId))).toEqual(new Set(['canaries']));
    expect(searchDeals(all, { cabinCategory: 'Suite' }).every((o) => o.cabinCategory === 'Suite')).toBe(true);
    expect(searchDeals(all, { cabinGroup: 'balcony' })).toHaveLength(6);
    expect(searchDeals(all, { fareCode: 'PREMIUM', cabinGroup: 'balcony' })).toHaveLength(3);
  });

  it('filters by departure month and duration', () => {
    expect(new Set(searchDeals(all, { departureMonth: '2027-03' }).map((o) => o.routeId))).toEqual(new Set(['canaries', 'med']));
    expect(new Set(searchDeals(all, { minNights: 8, maxNights: 14 }).map((o) => o.routeId))).toEqual(new Set(['norway', 'med']));
    expect(new Set(searchDeals(all, { maxNights: 7 }).map((o) => o.routeId))).toEqual(new Set(['canaries']));
  });

  it('answers "balcony cabins under 3.000 € including flights": the budget is the trip total', () => {
    const hits = searchDeals(all, { cabinGroup: 'balcony', maxBudget: 3000 + 1180 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((o) => o.option.totalPrice <= 4180 && o.cabinGroup === 'balcony')).toBe(true);
    expect(hits.length).toBeLessThan(searchDeals(all, { cabinGroup: 'balcony' }).length);
    expect(searchDeals(all, { maxBudget: 1 })).toEqual([]);
  });

  it('answers "suites under the historical average"', () => {
    const hits = searchDeals(all, { cabinGroup: 'suite', belowAverage: true });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(isBelowAverage)).toBe(true);
    expect(new Set(hits.map((o) => o.routeId))).toEqual(new Set(['canaries'])); // only the falling route is below its average now
  });

  it('answers "best deals for Canary Islands" with a text search over route, ship and fare', () => {
    expect(new Set(searchDeals(all, { text: 'canary' }).map((o) => o.routeId))).toEqual(new Set(['canaries']));
    expect(new Set(searchDeals(all, { text: ' RELAX ' }).map((o) => o.routeId))).toEqual(new Set(['norway']));
    expect(searchDeals(all, { text: 'premium' }).every((o) => o.fare.fareCode === 'PREMIUM')).toBe(true);
    expect(searchDeals(all, { text: 'nothing like this' })).toEqual([]);
    expect(searchDeals(all, { text: '   ' })).toHaveLength(all.length);
  });

  it('combines filters', () => {
    const hits = searchDeals(all, { provider: 'aida', cabinGroup: 'balcony', departureMonth: '2027-03', maxNights: 7 });
    expect(new Set(ids(hits).map((s) => s.split('/')[0]))).toEqual(new Set(['canaries']));
  });
});

describe('searchDeals ranking modes', () => {
  it('lists the four modes', () => {
    expect([...RANKING_MODES]).toEqual(['cheapest', 'bestValue', 'bestForecast', 'biggestDrop']);
  });

  it('cheapest: by trip total', () => {
    const r = searchDeals(all, {}, 'cheapest');
    expect(r.map((o) => o.option.totalPrice)).toEqual([...r.map((o) => o.option.totalPrice)].sort((a, b) => a - b));
  });

  it('bestValue: by fare value score, the cheaper trip first on a tie', () => {
    const r = searchDeals(all, {}, 'bestValue');
    expect(r.map((o) => o.valueScore)).toEqual([...r.map((o) => o.valueScore)].sort((a, b) => b - a));
  });

  it('bestForecast: by the expected saving by waiting, largest first', () => {
    const r = searchDeals(all, {}, 'bestForecast');
    const s = r.map((o) => o.expectedSavings ?? -Infinity);
    expect(s).toEqual([...s].sort((a, b) => b - a));
    expect(r[0]!.routeId).toBe('canaries'); // the falling route: waiting saves the most
    expect(r[0]!.expectedSavings!).toBeGreaterThan(0);
  });

  it('biggestDrop: by the fall over the last week, largest fall first', () => {
    const r = searchDeals(all, {}, 'biggestDrop');
    expect(r[0]!.routeId).toBe('canaries');
    expect(r[0]!.recentChange!.amount).toBeLessThan(0);
    expect(r.at(-1)!.routeId).toBe('norway');
  });

  it('limits the result and does not touch the input', () => {
    const before = ids(all);
    expect(searchDeals(all, {}, 'cheapest', 3)).toHaveLength(3);
    expect(ids(all)).toEqual(before);
  });

  it('puts options without a forecast or history last', () => {
    const lonely = { ...all[0]!, expectedSavings: null, recentChange: null, routeId: 'lonely' };
    expect(searchDeals([lonely, ...all], {}, 'bestForecast').at(-1)!.routeId).toBe('lonely');
    expect(searchDeals([lonely, ...all], {}, 'biggestDrop').at(-1)!.routeId).toBe('lonely');
  });
});

describe('searchDeals speed', () => {
  it('searches thousands of options well within the 3 seconds the brief allows', () => {
    const many = Array.from({ length: 200 }, (_, i) => all.map((o) => ({ ...o, routeId: `${o.routeId}-${i}` }))).flat(); // 2400 options
    const t0 = performance.now();
    for (const mode of RANKING_MODES) searchDeals(many, { cabinGroup: 'balcony', maxBudget: 5000, text: 'a' }, mode, 20);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('dealFilterChoices', () => {
  it('offers only values that exist, sorted', () => {
    const c = dealFilterChoices(all);
    expect(c.providers).toEqual(['aida', 'mein-schiff']);
    expect(c.routes.map((r) => r.name)).toEqual(['Canary Islands', 'Mediterranean', 'Norwegian Fjords']);
    expect(c.ships).toEqual(['AIDA Cosma', 'AIDA Nova', 'Mein Schiff Relax']);
    expect(c.cabinCategories).toEqual(['Balkonkabine', 'Innenkabine', 'Suite']);
    expect(c.fares.map((f) => f.name)).toEqual(['CLASSIC', 'PREMIUM']);
    expect(c.months).toEqual(['2027-03', '2027-06']);
    expect(c.nights).toEqual([7, 10, 14]);
    expect(dealFilterChoices([])).toEqual({ providers: [], routes: [], ships: [], cabinCategories: [], fares: [], months: [], nights: [] });
  });
});
