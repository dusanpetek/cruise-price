import { describe, expect, it } from 'vitest';
import { evaluateAlerts } from './alerts';
import {
  analyzeOptions,
  compareFares,
  compareServices,
  dealFinder,
  fareDashboard,
  fareHighlights,
  fareGroupSeries,
  fareMatrix,
  fareName,
  fareSaving,
  dealScoreOf,
  dealScoreBreakdown,
  dealScoreFrom,
  recentChange,
  fareValueScore,
  bestCabinOf,
  bestFareOf,
  forecastOpportunity,
  optionSeries,
  outlookOf,
  observationsToPoints,
  pricingOption,
  selectionSeries,
  tripTotal,
  fareScore,
} from './fares';
import { at, fare, fareSnapshot, opt, rng, rule } from './testing';
import { valueLabelOf } from './recommendation';

const CLASSIC = fare('CLASSIC', { includedServices: ['Wahl der Kabinenkategorie', 'Speisen im Buffet'], selectableCabin: false });
const PREMIUM = fare('PREMIUM', { includedServices: ['Wahl der Kabinenkategorie', 'Speisen im Buffet', 'Wunschkabine', 'Umbuchung'], selectableCabin: true });
const PREMIUM_AI = fare('PREMIUM_ALL_IN', { fareName: 'PREMIUM ALL IN', includedServices: ['Speisen im Buffet', 'Wunschkabine', 'Umbuchung', 'Getränkepaket ALL IN'], selectableCabin: true });
const FARES = [CLASSIC, PREMIUM, PREMIUM_AI];
const OPTIONS = [
  opt('Balkonkabine', 'CLASSIC', 2058),
  opt('Balkonkabine', 'PREMIUM', 2190),
  opt('Balkonkabine', 'PREMIUM_ALL_IN', 2590),
  opt('Innenkabine', 'CLASSIC', 1298),
  opt('Innenkabine', 'PREMIUM', 1450),
  opt('Suite', 'PREMIUM', 4920),
];
const SNAP = fareSnapshot(0, FARES, OPTIONS);

describe('trip total', () => {
  it('is cruise + flight + mandatory fees', () => {
    expect(tripTotal(2999, 399)).toBe(3398);
    expect(tripTotal(2998, 598, 100)).toBe(3696); // the specification's example
    expect(tripTotal(0.1, 0.2)).toBe(0.3);
  });

  it('prices an option with every value stored together, per person and in total', () => {
    const o = pricingOption({ cabinCategory: 'Balkonkabine', fareCode: 'PREMIUM', flightCode: 'FRA', passengers: 2, cruisePrice: 2998, flightPrice: 598, mandatoryFees: 100 });
    expect(o).toEqual({
      cabinCategory: 'Balkonkabine',
      fareCode: 'PREMIUM',
      flightCode: 'FRA',
      cruisePerPerson: 1499,
      cruisePrice: 2998,
      flightPerPerson: 299,
      flightPrice: 598,
      mandatoryFees: 100,
      tripPerPerson: 1848,
      totalPrice: 3696,
    });
    const free = pricingOption({ cabinCategory: 'X', fareCode: 'Y', flightCode: null, passengers: 2, cruisePrice: 1000, flightPrice: 0 });
    expect(free).toMatchObject({ flightPrice: 0, flightPerPerson: 0, mandatoryFees: 0, totalPrice: 1000, tripPerPerson: 500 });
  });
});

describe('compareFares', () => {
  it('lists a cabin\'s fares cheapest first with difference, percentage and savings', () => {
    const rows = compareFares(SNAP, 'Balkonkabine');
    expect(rows.map((r) => r.fare.fareCode)).toEqual(['CLASSIC', 'PREMIUM', 'PREMIUM_ALL_IN']);
    expect(rows.map((r) => r.option.totalPrice)).toEqual([3238, 3370, 3770]);
    expect(rows.map((r) => r.difference)).toEqual([0, 132, 532]);
    expect(rows[1]!.differencePct).toBe(4.08);
    expect(rows.map((r) => r.savingsVsMostExpensive)).toEqual([532, 400, 0]);
    expect(rows.every((r) => r.servicesKnown)).toBe(true);
  });

  it('is empty for a cabin without fare data', () => {
    expect(compareFares(SNAP, 'Penthouse')).toEqual([]);
  });

  it('shows an option whose fare has no description as an unknown fare', () => {
    const snap = fareSnapshot(0, [], [opt('Balkonkabine', 'MYSTERY', 2000), opt('Balkonkabine', 'OTHER', 2100)]);
    const rows = compareFares(snap, 'Balkonkabine');
    expect(rows[0]).toMatchObject({ fare: { fareCode: 'MYSTERY', fareName: 'MYSTERY', includedServices: [], refundable: null }, servicesKnown: false });
    expect(fareName(snap, 'MYSTERY')).toBe('MYSTERY');
    expect(fareName(SNAP, 'PREMIUM_ALL_IN')).toBe('PREMIUM ALL IN');
  });
});

describe('fareSaving', () => {
  it('computes the saving and its share of the dearer option', () => {
    const s = fareSaving(opt('B', 'PREMIUM_ALL_IN', 2419, 1180), opt('B', 'VARIO', 1819, 1180)); // 3599 -> 2999
    expect(s).toMatchObject({ amount: 600 });
    expect(s.pct).toBe(16.67);
  });
  it('is negative when the alternative costs more, and safe at zero', () => {
    expect(fareSaving(opt('B', 'A', 1000), opt('B', 'B', 1100)).amount).toBe(-100);
    expect(fareSaving(opt('B', 'A', 0, 0), opt('B', 'B', 0, 0)).pct).toBe(0);
  });
});

describe('compareServices', () => {
  it('separates explicit extras from unknowns, and never treats an unlisted service as excluded', () => {
    const base = fare('CLASSIC', { includedServices: ['Speisen im Buffet', 'Kabinenkategorie wählbar'], excludedServices: ['Umbuchung'], selectableCabin: false });
    const upgrade = fare('PREMIUM', { includedServices: ['Speisen im Buffet', 'Umbuchung', 'Wunschkabine'], excludedServices: ['Kabinenkategorie wählbar'], selectableCabin: true, refundable: null });
    const c = compareServices(base, upgrade, 400);
    expect(c.extraCost).toBe(400);
    expect(c.extraBenefits).toEqual(['Umbuchung']); // base explicitly excludes it
    expect(c.unknownBenefits).toEqual(['Wunschkabine']); // base says nothing
    expect(c.lostBenefits).toEqual(['Kabinenkategorie wählbar']);
    expect(c.unknownLosses).toEqual([]);
    expect(c.terms).toEqual([
      { label: 'Specific cabin selectable', base: false, upgrade: true },
      { label: 'Refundable', base: null, upgrade: null },
    ]);
  });

  it('ignores case and punctuation when matching services, and reports services only the base lists', () => {
    const base = fare('A', { includedServices: ['Freie Kabinen-Umbuchung', 'Rail&Fly kostenlos'] });
    const upgrade = fare('B', { includedServices: ['freie kabinen umbuchung'] });
    const c = compareServices(base, upgrade, null);
    expect(c.extraCost).toBeNull();
    expect(c.extraBenefits).toEqual([]);
    expect(c.unknownBenefits).toEqual([]);
    expect(c.unknownLosses).toEqual(['Rail&Fly kostenlos']);
  });
});

describe('fareScore (best fare selection)', () => {
  const rows = compareFares(SNAP, 'Balkonkabine'); // CLASSIC 3238, PREMIUM 3370, PREMIUM ALL IN 3770

  it('weighs trip total 50%, forecast 20%, services 20% and flexibility 10%', () => {
    // CLASSIC: price 100, forecast 50, services 2/4, flexibility (refundable ? 50, cabin choice no 0) = 25
    expect(fareScore(rows[0]!, rows)).toBe(Math.round(0.5 * 100 + 0.2 * 50 + 0.2 * 50 + 0.1 * 25));
    // PREMIUM: price 3238/3370, services 4/4, flexibility (50 + 100) / 2
    expect(fareScore(rows[1]!, rows)).toBe(Math.round(0.5 * ((3238 / 3370) * 100) + 0.2 * 50 + 0.2 * 100 + 0.1 * 75));
  });

  it('lets a slightly dearer fare with much more included win, and a much dearer one lose', () => {
    expect(fareScore(rows[1]!, rows)).toBeGreaterThan(fareScore(rows[0]!, rows));
    expect(fareScore(rows[2]!, rows)).toBeLessThan(fareScore(rows[1]!, rows));
    expect(rows.map((r) => fareScore(r, rows)).every((s) => s >= 0 && s <= 100)).toBe(true);
  });

  it('puts the lowest trip total first: a cheap fare is not beaten by services alone', () => {
    const snap = fareSnapshot(0, [fare('LOW', { includedServices: ['a'] }), fare('RICH', { includedServices: ['a', 'b', 'c', 'd'] })], [opt('B', 'LOW', 1000), opt('B', 'RICH', 2500)]);
    const r = compareFares(snap, 'B');
    expect(fareScore(r[0]!, r)).toBeGreaterThan(fareScore(r[1]!, r));
  });

  it('counts an unknown fare property as neutral, not as missing', () => {
    const snap = fareSnapshot(0, [], [opt('B', 'X', 1000), opt('B', 'Y', 1000)]);
    const r = compareFares(snap, 'B');
    expect(fareScore(r[0]!, r)).toBe(75); // 50 price + 10 forecast + 10 services + 5 flexibility, all unknowns at 50
  });

  it('rewards flexibility that the site states, and punishes stated inflexibility', () => {
    const flexible = fare('FLEX', { refundable: true, selectableCabin: true });
    const rigid = fare('RIGID', { refundable: false, selectableCabin: false });
    const snap = fareSnapshot(0, [flexible, rigid], [opt('B', 'FLEX', 1000), opt('B', 'RIGID', 1000)]);
    const r = compareFares(snap, 'B');
    const [f, g] = [r.find((x) => x.fare.fareCode === 'FLEX')!, r.find((x) => x.fare.fareCode === 'RIGID')!];
    expect(fareScore(f, r) - fareScore(g, r)).toBe(10);
  });

  it('favours a fare whose trip total is expected to rise, only as far as the forecast is confident', () => {
    const rising = { expected30dChangePct: 10, confidence: 1 };
    expect(fareScore(rows[0]!, rows, rising) - fareScore(rows[0]!, rows)).toBe(10);
    expect(fareScore(rows[0]!, rows, { expected30dChangePct: 10, confidence: 0 })).toBe(fareScore(rows[0]!, rows));
    expect(fareScore(rows[0]!, rows, { expected30dChangePct: -10, confidence: 1 })).toBeLessThan(fareScore(rows[0]!, rows));
  });

  it('copes with free options', () => {
    const snap = fareSnapshot(0, [], [opt('B', 'X', 0, 0)]);
    const r = compareFares(snap, 'B');
    expect(fareScore(r[0]!, r)).toBe(75);
  });
});

describe('best fare and best cabin', () => {
  const route = { id: 'r', name: 'R', provider: 'aida' as const };
  const hist = Array.from({ length: 20 }, (_, d) => fareSnapshot(d, FARES, OPTIONS));
  const options = analyzeOptions(route, hist);

  it('picks the highest-scoring fare, ties to the cheaper trip', () => {
    const best = bestFareOf(options)!;
    expect(best.fareScore).toBe(Math.max(...options.map((o) => o.fareScore)));
    expect(bestFareOf([])).toBeNull();
  });

  it('picks the cabin whose best option has the highest deal score', () => {
    const best = bestCabinOf(options)!;
    expect(best.dealScore).toBe(Math.max(...options.map((o) => o.dealScore)));
    expect(bestCabinOf([])).toBeNull();
  });

  it('breaks ties between cabins and options by the lower trip total', () => {
    const a = { ...options[0]!, cabinCategory: 'A', dealScore: 70, fareScore: 70, option: { ...options[0]!.option, totalPrice: 3000 } };
    const b = { ...options[0]!, cabinCategory: 'B', dealScore: 70, fareScore: 70, option: { ...options[0]!.option, totalPrice: 2000 } };
    const c = { ...options[0]!, cabinCategory: 'B', dealScore: 70, fareScore: 70, option: { ...options[0]!.option, totalPrice: 2500 } };
    expect(bestCabinOf([a, b, c])!.option.totalPrice).toBe(2000);
    expect(bestFareOf([a, b, c])!.option.totalPrice).toBe(2000);
  });
});

describe('outlookOf', () => {
  const series = (days: number, price: (d: number) => number) => Array.from({ length: days }, (_, d) => ({ snapshotId: `s${d}`, collectedAt: at(d), price: price(d) }));

  it('describes a falling price as "likely drops N%"', () => {
    const o = outlookOf('PREMIUM', series(40, (d) => 4000 - 20 * d), 'aida'); // -600 over 30 days from 3220
    expect(o.outlook).toBe('drops');
    expect(o.expected30dChangePct).toBeLessThan(-8);
    expect(o.text).toMatch(/^PREMIUM likely drops \d+%$/);
  });

  it('describes a rising price as "likely rises N%"', () => {
    const o = outlookOf('PLUS', series(40, (d) => 2000 + 15 * d), null);
    expect(o.outlook).toBe('rises');
    expect(o.text).toMatch(/^PLUS likely rises \d+%$/);
  });

  it('calls a flat or noisy price stable', () => {
    expect(outlookOf('VARIO', series(40, () => 3000), null)).toMatchObject({ outlook: 'stable', text: 'VARIO likely stable' });
    const r = rng(1);
    expect(outlookOf('PUR', series(40, () => 3000 + (r() - 0.5) * 300), null).outlook).toBe('stable');
  });

  it('says so when there is not enough history', () => {
    expect(outlookOf('PRO', series(3, () => 1), null)).toEqual({ outlook: 'unclear', expected30dChangePct: null, confidence: 0, text: 'PRO: not enough history for an outlook' });
    expect(outlookOf('PRO', series(10, () => 0), null).outlook).toBe('unclear');
  });
});

describe('series of one option', () => {
  const snaps = [
    fareSnapshot(2, FARES, [opt('Balkonkabine', 'PREMIUM', 2100), opt('Suite', 'PREMIUM', 4900)]),
    fareSnapshot(0, FARES, [opt('Balkonkabine', 'PREMIUM', 2190), opt('Balkonkabine', 'CLASSIC', 2058)]),
    fareSnapshot(1, FARES, []),
  ];

  it('tracks the total of one cabin x fare, oldest first, skipping snapshots without it', () => {
    expect(optionSeries(snaps, 'Balkonkabine', 'PREMIUM').map((p) => [p.collectedAt, p.price, p.cruise, p.flight])).toEqual([[at(0), 3370, 2190, 1180], [at(2), 3280, 2100, 1180]]);
    expect(optionSeries(snaps, 'Balkonkabine', 'CLASSIC')).toHaveLength(1);
    expect(optionSeries(snaps, 'Penthouse', 'PREMIUM')).toEqual([]);
  });

  it('tracks the cheapest total of a cabin group for one fare', () => {
    const s = [fareSnapshot(0, FARES, [opt('Balkonkabine', 'PREMIUM', 2190), opt('Verandakabine Deluxe', 'PREMIUM', 2000), opt('Innenkabine', 'PREMIUM', 1000)])];
    expect(fareGroupSeries(s, 'balcony', 'PREMIUM')[0]).toMatchObject({ price: 3180, cruise: 2000 });
    expect(fareGroupSeries(s, null, 'PREMIUM')[0]!.price).toBe(2180);
    expect(fareGroupSeries(s, 'suite', 'PREMIUM')).toEqual([]);
    expect(fareGroupSeries(s, 'balcony', 'CLASSIC')).toEqual([]);
  });
});

describe('dealScoreOf: mean of historical position, forecast opportunity, trend (+ fare value, upgrade value)', () => {
  const obs = (prices: number[]) => prices.map((price, d) => ({ snapshotId: `s${d}`, collectedAt: at(d), price }));
  const flat = { expected30dChangePct: 0, confidence: 0 };

  it('follows the formula', () => {
    // at the historical low: position 100; the price fell 20% since the start -> trend 100; forecast neutral 50
    expect(dealScoreOf(obs([3000, 2800, 2600, 2400]), flat)).toBe(Math.round((100 + 50 + 100) / 3));
    // at the historical high: position 0; the price rose 25% -> trend 0
    expect(dealScoreOf(obs([2400, 2600, 2800, 3000]), flat)).toBe(Math.round((0 + 50 + 0) / 3));
  });

  it('scores a price at its low above one at its high, always within 0..100', () => {
    const atLow = dealScoreOf(obs([3000, 2800, 2600, 2400]), flat);
    const atHigh = dealScoreOf(obs([2400, 2600, 2800, 3000]), flat);
    expect(atLow).toBeGreaterThan(atHigh);
    for (const s of [atLow, atHigh, dealScoreOf(obs([1, 1000000]), { expected30dChangePct: 500, confidence: 1 }), dealScoreOf(obs([1000000, 1]), { expected30dChangePct: -500, confidence: 1 })]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('favours a trip total expected to rise (book now), only as far as the forecast is confident', () => {
    const series = obs([2500, 2500, 2500]);
    const rising = dealScoreOf(series, { expected30dChangePct: 10, confidence: 1 });
    expect(rising).toBeGreaterThan(dealScoreOf(series, flat));
    expect(dealScoreOf(series, { expected30dChangePct: 10, confidence: 0 })).toBe(dealScoreOf(series, flat));
    expect(dealScoreOf(series, { expected30dChangePct: -10, confidence: 1 })).toBeLessThan(dealScoreOf(series, flat));
    expect(dealScoreOf(series, { expected30dChangePct: null, confidence: 1 })).toBe(dealScoreOf(series, flat));
    expect(forecastOpportunity({ expected30dChangePct: 10, confidence: 1 })).toBe(100);
    expect(forecastOpportunity({ expected30dChangePct: 0, confidence: 1 })).toBe(50);
  });

  it('is neutral on position with a single collection, and full marks for position on a flat history', () => {
    expect(dealScoreOf(obs([100]), flat)).toBe(50);
    expect(dealScoreOf(obs([100, 100, 100]), flat)).toBe(Math.round((100 + 50 + 50) / 3));
    expect(dealScoreOf(obs([0, 0]), flat)).toBe(Math.round((100 + 50 + 50) / 3)); // zero prices do not divide by zero
  });
});

describe('deal score engine', () => {
  const obs = (prices: number[]) => prices.map((price, d) => ({ snapshotId: `s${d}`, collectedAt: at(d), price }));
  const flat = { expected30dChangePct: 0, confidence: 0 };

  it('returns every component and averages the ones that exist', () => {
    const b = dealScoreBreakdown(obs([3000, 2800, 2600, 2400]), flat);
    expect(b).toMatchObject({ historicalPosition: 100, forecastOpportunity: 50, trend: 100, fareValue: null, upgradeValue: null, score: 83 });
    const withValue = dealScoreBreakdown(obs([3000, 2800, 2600, 2400]), flat, { fareValue: 80, upgradeValue: 60 });
    expect(withValue.score).toBe(Math.round((100 + 50 + 100 + 80 + 60) / 5));
    expect(dealScoreFrom({ historicalPosition: 40, forecastOpportunity: 60, trend: 50, fareValue: 90, upgradeValue: null })).toBe(60);
  });

  it('measures the trend as the change over the last week, 10% lower = 100, 10% higher = 0', () => {
    expect(recentChange(obs([100]))).toBeNull();
    expect(recentChange(obs([100, 110]))).toEqual({ amount: 10, pct: 10 });
    expect(recentChange([{ snapshotId: 'a', collectedAt: at(0), price: 0 }, { snapshotId: 'b', collectedAt: at(1), price: 5 }])).toBeNull();
    const week = (first: number, last: number) => [...obs(Array(10).fill(first)), { snapshotId: 'z', collectedAt: at(10), price: last }];
    expect(dealScoreBreakdown(week(1000, 900), flat).trend).toBe(100);
    expect(dealScoreBreakdown(week(1000, 1100), flat).trend).toBe(0);
    expect(dealScoreBreakdown(week(1000, 1000), flat).trend).toBe(50);
  });
});

describe('fare value score', () => {
  const rowsOf = (list: ReturnType<typeof compareFares>) => list;
  const rows = rowsOf(compareFares(fareSnapshot(0, FARES, [opt('Balkonkabine', 'CLASSIC', 3099), opt('Balkonkabine', 'PREMIUM', 3699)]), 'Balkonkabine'));
  const ctx = (pctAboveLow = 0) => ({ pctAboveLow, samples: 10, totalSnapshots: 10 });

  it('rates the cheaper fare as better value than a premium fare whose extras do not justify the surcharge', () => {
    const vario = fareValueScore(rows[0]!, rows, ctx());
    const premium = fareValueScore(rows[1]!, rows, ctx());
    expect(vario.score).toBeGreaterThan(premium.score);
    expect(vario.score).toBeGreaterThanOrEqual(75);
    expect(premium.score).toBeLessThan(vario.score);
    expect(Object.keys(vario.factors)).toEqual(['price', 'benefits', 'history', 'forecast', 'flexibility', 'availability']);
  });

  it('maps the score onto the four value bands', () => {
    expect([95, 90, 89, 75, 74, 60, 59, 0].map(valueLabelOf)).toEqual(['Excellent value', 'Excellent value', 'Good value', 'Good value', 'Neutral value', 'Neutral value', 'Poor value', 'Poor value']);
  });

  it('is lowered by a price above the fare\'s own low, a forecast drop, and rarely offered fares', () => {
    const base = fareValueScore(rows[0]!, rows, ctx()).score;
    expect(fareValueScore(rows[0]!, rows, ctx(20)).score).toBeLessThan(base);
    expect(fareValueScore(rows[0]!, rows, { ...ctx(), outlook: { expected30dChangePct: -10, confidence: 1 } }).score).toBeLessThan(base);
    expect(fareValueScore(rows[0]!, rows, { pctAboveLow: 0, samples: 2, totalSnapshots: 10 }).score).toBeLessThan(base);
  });

  it('stays within 0..100 for extreme inputs', () => {
    for (const row of rows) {
      const v = fareValueScore(row, rows, { pctAboveLow: 500, samples: 0, totalSnapshots: 0, outlook: { expected30dChangePct: -500, confidence: 1 } }).score;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('analyzeOptions', () => {
  const history = Array.from({ length: 40 }, (_, d) =>
    fareSnapshot(d, FARES, [
      opt('Balkonkabine', 'CLASSIC', 2300 - 6 * d),
      opt('Balkonkabine', 'PREMIUM', 2400),
      opt('Balkonkabine', 'PREMIUM_ALL_IN', 2800 + (d % 2 ? 40 : 0)),
      opt('Suite', 'PREMIUM', 5000 - 10 * d),
    ]),
  );
  const route = { id: 'r1', name: 'Canaries', provider: 'aida' as const };

  it('analyses every cabin x fare of the latest snapshot', () => {
    const all = analyzeOptions(route, history);
    expect(all).toHaveLength(4);
    const classic = all.find((o) => o.cabinCategory === 'Balkonkabine' && o.fareName === 'CLASSIC')!;
    expect(classic).toMatchObject({ routeName: 'Canaries', cabinGroup: 'balcony', samples: 40, historicalLow: classic.option.totalPrice, pctAboveLow: 0, servicesKnown: true });
    expect(classic.outlook.outlook).toBe('drops');
    expect(all.every((o) => o.dealScore >= 0 && o.dealScore <= 100 && o.fareScore >= 0 && o.fareScore <= 100)).toBe(true);
    const premium = all.find((o) => o.fareName === 'PREMIUM' && o.cabinCategory === 'Balkonkabine')!;
    expect(premium.outlook.outlook).toBe('stable');
    expect(premium.servicesCount).toBe(4);
    expect(all.find((o) => o.cabinCategory === 'Suite')!.cabinGroup).toBe('suite');
  });

  it('is empty without snapshots or without fare data (older snapshots)', () => {
    expect(analyzeOptions(route, [])).toEqual([]);
    expect(analyzeOptions(route, [fareSnapshot(0, [], [])])).toEqual([]);
  });

  it('measures how far above its low an option currently is', () => {
    const rising = Array.from({ length: 10 }, (_, d) => fareSnapshot(d, FARES, [opt('Balkonkabine', 'PREMIUM', 2000 + 10 * d)]));
    expect(analyzeOptions(route, rising)[0]).toMatchObject({ historicalLow: 3180, historicalHigh: 3270, pctAboveLow: 2.83 });
  });
});

describe('fareDashboard', () => {
  it('finds the cheapest, most expensive and best value fare, and the largest saving', () => {
    const d = fareDashboard(SNAP, 'Balkonkabine')!;
    expect(d.cheapest.fare.fareCode).toBe('CLASSIC');
    expect(d.mostExpensive.fare.fareCode).toBe('PREMIUM_ALL_IN');
    expect(d.bestValue.row.fare.fareCode).toBe('PREMIUM');
    expect(d.largestSaving).toMatchObject({ amount: 532 });
    expect(d.largestSaving!.from.fareCode).toBe('PREMIUM_ALL_IN');
    expect(d.largestSaving!.to.fareCode).toBe('CLASSIC');
    expect(d.largestSaving!.pct).toBe(14.11);
  });

  it('has no saving for a single-fare cabin and nothing for an unknown cabin', () => {
    expect(fareDashboard(SNAP, 'Suite')!.largestSaving).toBeNull();
    expect(fareDashboard(SNAP, 'Penthouse')).toBeNull();
  });

  it('prefers the cheaper fare when value scores tie', () => {
    const snap = fareSnapshot(0, [], [opt('B', 'X', 1000), opt('B', 'Y', 1000)]);
    expect(fareDashboard(snap, 'B')!.bestValue.row.fare.fareCode).toBe('X');
  });
});

describe('fareMatrix', () => {
  it('lays out cabins against fares with total prices and savings', () => {
    const m = fareMatrix(SNAP);
    expect(m.rows.map((r) => r.cabinCategory)).toEqual(['Balkonkabine', 'Innenkabine', 'Suite']);
    expect(m.fares.map((f) => f.fareCode)).toEqual(['CLASSIC', 'PREMIUM', 'PREMIUM_ALL_IN']); // by average total
    const balcony = m.rows[0]!;
    expect(balcony.cells.PREMIUM!.option!.totalPrice).toBe(3370);
    expect(balcony.cells.PREMIUM!.savings).toBe(400);
    expect(m.rows[2]!.cells.CLASSIC).toEqual({ option: null, savings: null });
    expect(balcony.maxSavings).toBe(532);
  });

  it('sorts rows by total price or by savings, and fares by name', () => {
    expect(fareMatrix(SNAP, 'total').rows.map((r) => r.cabinCategory)).toEqual(['Innenkabine', 'Balkonkabine', 'Suite']);
    expect(fareMatrix(SNAP, 'savings').rows[0]!.cabinCategory).toBe('Balkonkabine');
    expect(fareMatrix(SNAP, 'fare').fares.map((f) => f.fareName)).toEqual(['CLASSIC', 'PREMIUM', 'PREMIUM ALL IN']);
  });

  it('handles options whose fare is not described', () => {
    const m = fareMatrix(fareSnapshot(0, [], [opt('B', 'ZED', 1000), opt('B', 'ALPHA', 900)]));
    expect(m.fares.map((f) => f.fareCode)).toEqual(['ALPHA', 'ZED']);
  });
});

describe('dealFinder', () => {
  const route = (id: string, provider: 'aida' | 'mein-schiff' = 'aida') => ({ id, name: `Route ${id}`, provider });
  const hist = (flight: number, scale: number) =>
    Array.from({ length: 20 }, (_, d) => fareSnapshot(d, FARES, OPTIONS.map((o) => ({ ...o, cruisePrice: Math.round(o.cruisePrice * scale) - d, flightPrice: flight, totalPrice: Math.round(o.cruisePrice * scale) - d + flight }))));
  const all = [...analyzeOptions(route('cheap'), hist(1000, 0.8)), ...analyzeOptions(route('dear', 'mein-schiff'), hist(1500, 1.2))];
  const f = dealFinder(all);

  it('ranks the six lists', () => {
    expect(f.lowestTotal[0]!.option.totalPrice).toBe(Math.min(...all.map((o) => o.option.totalPrice)));
    const totals = f.lowestTotal.map((o) => o.option.totalPrice);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(f.lowestFlight.every((o) => o.option.flightPrice === 1000 || f.lowestFlight[0]!.option.flightPrice <= o.option.flightPrice)).toBe(true);
    expect(f.lowestFlight[0]!.routeId).toBe('cheap');
    const deals = f.topDeals.map((o) => o.dealScore);
    expect(deals).toEqual([...deals].sort((a, b) => b - a));
    const values = f.bestValue.map((o) => o.fareScore);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('keeps balcony and suite offers separate and applies the limit', () => {
    expect(f.bestBalcony.length).toBeGreaterThan(0);
    expect(f.bestBalcony.every((o) => o.cabinGroup === 'balcony')).toBe(true);
    expect(f.bestSuite.every((o) => o.cabinGroup === 'suite')).toBe(true);
    expect(dealFinder(all, 3).topDeals).toHaveLength(3);
    expect(dealFinder([])).toEqual({ topDeals: [], bestValue: [], lowestTotal: [], lowestFlight: [], bestBalcony: [], bestSuite: [] });
  });

  it('puts the total, cruise and flight on every entry', () => {
    for (const e of f.topDeals) expect(e.option.cruisePrice + e.option.flightPrice).toBe(e.option.totalPrice);
  });
});

describe('fare-specific alerts', () => {
  const snaps = (prices: number[], fares = FARES) => prices.map((p, d) => fareSnapshot(d, fares, [opt('Balkonkabine', 'PREMIUM', p), opt('Balkonkabine', 'CLASSIC', p - 300), opt('Innenkabine', 'PREMIUM', p - 900)]));

  it('alerts on a new low of one fare, with the cruise + flight breakdown', () => {
    const [a] = evaluateAlerts({ routeId: 'r1', rules: [rule({ type: 'NEW_LOW', fare: 'PREMIUM_ALL_IN' })], snapshots: [...snaps([2000, 2000]), fareSnapshot(2, FARES, [opt('Balkonkabine', 'PREMIUM_ALL_IN', 1900)])] });
    expect(a).toBeUndefined(); // no earlier PREMIUM_ALL_IN history: nothing to beat
    const withHistory = [0, 1, 2].map((d) => fareSnapshot(d, FARES, [opt('Balkonkabine', 'PREMIUM_ALL_IN', d === 2 ? 2300 : 2500)]));
    const [low] = evaluateAlerts({ routeId: 'r1', rules: [rule({ type: 'NEW_LOW', fare: 'PREMIUM_ALL_IN' })], snapshots: withHistory });
    expect(low).toMatchObject({ type: 'NEW_LOW', category: 'Cheapest cabin · PREMIUM ALL IN', currentPrice: 3480 });
    expect(low!.message).toContain('New historical low detected');
    expect(low!.message).toContain('Trip total: 3.480 € (cruise 2.300 € + flight 1.180 €).');
    expect(low).toMatchObject({ cruisePrice: 2300, flightPrice: 1180, totalPrice: 3480 });
  });

  it('alerts when a cabin group + fare falls below a target total', () => {
    const rules = [rule({ type: 'TARGET_PRICE', cabin: 'balcony', fare: 'PREMIUM', targetPrice: 3300 })];
    const [a] = evaluateAlerts({ routeId: 'r1', rules, snapshots: snaps([2300, 2100]) }); // 3480 -> 3280
    expect(a).toMatchObject({ type: 'TARGET_PRICE', category: 'Balcony · PREMIUM', currentPrice: 3280, referencePrice: 3300 });
    expect(a!.message).toContain('cruise 2.100 € + flight 1.180 €');
    expect(evaluateAlerts({ routeId: 'r1', rules, snapshots: snaps([2300, 2200]) })).toEqual([]); // 3380 still above
  });

  it('alerts on a percentage drop of one fare', () => {
    const [a] = evaluateAlerts({ routeId: 'r1', rules: [rule({ type: 'PERCENT_DROP', percent: 10, fare: 'CLASSIC' })], snapshots: snaps([3000, 2000]) });
    expect(a).toMatchObject({ type: 'PERCENT_DROP', category: 'Cheapest cabin · CLASSIC' });
  });

  it('is skipped when the newest snapshot has no option for that fare', () => {
    const rules = [rule({ type: 'NEW_LOW', fare: 'PREMIUM_ALL_IN' })];
    expect(evaluateAlerts({ routeId: 'r1', rules, snapshots: snaps([2000, 1000]) })).toEqual([]);
  });

  it('puts the trip total behind rules that do not name a fare either', () => {
    const [a] = evaluateAlerts({ routeId: 'r1', rules: [rule({ type: 'NEW_LOW' })], snapshots: [fareSnapshot(0, FARES, [opt('Innenkabine', 'PREMIUM', 1500)]), fareSnapshot(1, FARES, [opt('Innenkabine', 'PREMIUM', 1400)])] });
    expect(a!.category).toBe('Cheapest cabin');
    // every rule compares the trip total (cruise 1.400 + flight 1.180), and the message shows all three
    expect(a).toMatchObject({ currentPrice: 2580, referencePrice: 2680, cruisePrice: 1400, flightPrice: 1180, totalPrice: 2580 });
    expect(a!.message).toContain('Trip total: 2.580 € (cruise 1.400 € + flight 1.180 €).');
  });
});

describe('fareHighlights', () => {
  const route = (id: string) => ({ id, name: `Route ${id}`, provider: 'aida' as const });
  const hist = (offset: number) => Array.from({ length: 12 }, (_, d) => fareSnapshot(d, FARES, OPTIONS.map((o) => ({ ...o, cruisePrice: o.cruisePrice + offset, totalPrice: o.cruisePrice + offset + o.flightPrice }))));
  const all = [...analyzeOptions(route('a'), hist(0)), ...analyzeOptions(route('b'), hist(500))];

  it('finds the cheapest, most expensive and best value options and the largest saving', () => {
    const h = fareHighlights(all);
    expect(h.cheapest).toMatchObject({ routeId: 'a', cabinCategory: 'Innenkabine', fareName: 'CLASSIC' });
    expect(h.cheapest!.option.totalPrice).toBe(2478);
    expect(h.mostExpensive).toMatchObject({ routeId: 'b', cabinCategory: 'Suite' });
    expect(h.bestValue!.fareScore).toBe(Math.max(...all.map((o) => o.fareScore)));
    // balcony PREMIUM ALL IN (2590) vs CLASSIC (2058): 532, the biggest swing within one cabin
    expect(h.largestSaving).toMatchObject({ cabinCategory: 'Balkonkabine', fromFare: 'PREMIUM ALL IN', toFare: 'CLASSIC' });
    expect(h.largestSaving!.saving.amount).toBe(532);
  });

  it('can be limited to one cabin', () => {
    const h = fareHighlights(all.filter((o) => o.routeId === 'a' && o.cabinCategory === 'Innenkabine'));
    expect(h.cheapest!.fareName).toBe('CLASSIC');
    expect(h.mostExpensive!.fareName).toBe('PREMIUM');
    expect(h.largestSaving!.saving.amount).toBe(152);
  });

  it('has no saving when no cabin has two fares, and is empty without options', () => {
    expect(fareHighlights(all.filter((o) => o.cabinCategory === 'Suite' && o.routeId === 'a')).largestSaving).toBeNull();
    expect(fareHighlights([])).toEqual({ cheapest: null, mostExpensive: null, bestValue: null, largestSaving: null });
  });
});

describe('selecting a cabin and/or a fare', () => {
  const snaps = [
    fareSnapshot(0, FARES, [opt('Balkonkabine', 'CLASSIC', 2000), opt('Balkonkabine', 'PREMIUM', 2300), opt('Innenkabine', 'PREMIUM', 1500), opt('Innenkabine', 'CLASSIC', 1400)]),
    fareSnapshot(1, FARES, [opt('Balkonkabine', 'CLASSIC', 1900), opt('Innenkabine', 'CLASSIC', 1300)]), // PREMIUM not offered that day
    fareSnapshot(2, FARES, [opt('Balkonkabine', 'CLASSIC', 1950), opt('Balkonkabine', 'PREMIUM', 2200), opt('Innenkabine', 'PREMIUM', 1450)]),
  ];

  it('is the headline (cheapest trip) with nothing selected', () => {
    expect(selectionSeries(snaps, { cabin: null, fareCode: null }).map((p) => p.price)).toEqual([2580, 2480, 2630]);
  });

  it('is one cabin at its cheapest fare', () => {
    expect(selectionSeries(snaps, { cabin: 'Balkonkabine', fareCode: null }).map((p) => p.price)).toEqual([3180, 3080, 3130]);
  });

  it('is one fare in its cheapest cabin, skipping days it was not offered', () => {
    const premium = selectionSeries(snaps, { cabin: null, fareCode: 'PREMIUM' });
    expect(premium.map((p) => [p.collectedAt, p.price])).toEqual([[at(0), 2680], [at(2), 2630]]);
  });

  it('is exactly one cabin + fare, with its cruise and flight parts', () => {
    const s = selectionSeries(snaps, { cabin: 'Balkonkabine', fareCode: 'PREMIUM' });
    expect(s.map((p) => [p.price, p.cruise, p.flight])).toEqual([[3480, 2300, 1180], [3380, 2200, 1180]]);
    expect(selectionSeries(snaps, { cabin: 'Suite', fareCode: 'PREMIUM' })).toEqual([]);
    expect(selectionSeries(snaps, { cabin: 'Suite', fareCode: null })).toEqual([]);
  });

  it('turns observations back into cruise + flight points', () => {
    expect(observationsToPoints([{ snapshotId: 's', collectedAt: at(0), price: 3480, cruise: 2300, flight: 1180 }, { snapshotId: 't', collectedAt: at(1), price: 500 }])).toEqual([
      { collectedAt: at(0), packagePrice: 2300, flightSurcharge: 1180 },
      { collectedAt: at(1), packagePrice: 500, flightSurcharge: 0 },
    ]);
  });
});
