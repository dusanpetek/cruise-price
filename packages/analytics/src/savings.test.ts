import { describe, expect, it } from 'vitest';
import { groupSeries } from './alerts';
import { forecastSeries } from './forecast';
import { generateInsight } from './insights';
import { recommend } from './recommendation';
import { bookingWindow, savingsMetrics } from './savings';
import { at, rng, series as makeSeries } from './testing';

const obs = (days: number, price: (d: number) => number) => groupSeries(makeSeries(days, price), null);

describe('savingsMetrics', () => {
  it('computes potential savings against the historical low', () => {
    const m = savingsMetrics(obs(5, (d) => [3000, 2800, 2500, 2700, 2999][d]!))!;
    expect(m).toMatchObject({ current: 2999, historicalLow: 2500, historicalHigh: 3000, potentialSavings: 499 });
    expect(m.potentialSavingsPct).toBeCloseTo(16.64, 1);
  });

  it('finds the largest peak-to-trough decline with its dates', () => {
    const m = savingsMetrics(obs(7, (d) => [1000, 1200, 900, 1100, 1300, 1000, 1250][d]!))!;
    // 1200 -> 900 and 1300 -> 1000 both lose 300; the first is the larger share of its peak (25% vs 23%)
    expect(m.largestDrop).toEqual({ amount: 300, pct: 25, peakAt: at(1), troughAt: at(2) });
    expect(savingsMetrics(obs(4, (d) => [1000, 600, 1100, 700][d]!))!.largestDrop).toMatchObject({ amount: 400 }); // 1000->600 vs 1100->700, equal amount
    expect(savingsMetrics(obs(4, (d) => [1000, 600, 1100, 700][d]!))!.largestDrop!.pct).toBe(40);
  });

  it('has no drop when the price only ever rose', () => {
    expect(savingsMetrics(obs(5, (d) => 1000 + d))!.largestDrop).toBeNull();
  });

  it('measures volatility and a stability score', () => {
    const steady = savingsMetrics(obs(30, () => 1000))!;
    expect(steady).toMatchObject({ volatilityPct: 0, stabilityScore: 100, potentialSavings: 0 });
    const r = rng(1);
    const wild = savingsMetrics(obs(60, () => 1000 + (r() - 0.5) * 800))!;
    expect(wild.volatilityPct).toBeGreaterThan(10);
    expect(wild.stabilityScore).toBeLessThan(50);
    expect(savingsMetrics(obs(30, () => 100000 * 0))!.stabilityScore).toBe(100);
  });

  it('floors the stability score at zero and handles an empty series', () => {
    expect(savingsMetrics(obs(40, (d) => (d % 2 ? 100 : 5000)))!.stabilityScore).toBe(0);
    expect(savingsMetrics([])).toBeNull();
  });
});

describe('bookingWindow', () => {
  const departure = at(200).slice(0, 10);
  /** Collected from 150 to 1 days before departure; prices rise as departure nears. */
  const rising = (days: number) => obs(days, (d) => 1000 + d * 2);

  it('finds the cheapest booking window once the history spans several buckets', () => {
    const w = bookingWindow(rising(199).filter((p) => Date.parse(p.collectedAt) >= Date.parse(at(50))), departure);
    expect(w.best).toMatchObject({ fromDays: 120, toDays: 150 });
    expect(w.best!.savingsVsAveragePct).toBeGreaterThan(0);
    expect(w.coverageDays).toEqual({ from: 2, to: 150 });
    expect(w.buckets[0]!.fromDays).toBeGreaterThan(w.buckets.at(-1)!.fromDays); // earliest (furthest out) first
    expect(w.note).toContain('120-150 days before departure');
  });

  it('does not guess from a single bucket', () => {
    const w = bookingWindow(rising(30), at(29).slice(0, 10)); // 29..0 days before departure: one bucket
    expect(w.best).toBeNull();
    expect(w.note).toContain('collect over a longer period');
  });

  it('explains missing information', () => {
    expect(bookingWindow(rising(10), null).note).toContain('No departure date');
    expect(bookingWindow(rising(10), '2025-01-01')).toMatchObject({ buckets: [], best: null, coverageDays: null });
    expect(bookingWindow(rising(10), '2025-01-01').note).toContain('after the departure');
  });
});

describe('generateInsight', () => {
  const build = (price: (d: number) => number, days = 40) => {
    const s = obs(days, price);
    const f = forecastSeries(s);
    const rec = recommend(s, f);
    return generateInsight({ routeName: 'AIDA Nova', category: 'Balcony', series: s, recommendation: rec, forecast: f, savings: savingsMetrics(s) });
  };

  it('describes a fall, the distance to the low, and ends with the recommendation', () => {
    const text = build((d) => 3000 - 10 * d + (d === 35 ? -200 : 0)); // a dip at day 35, so the end is above the low
    expect(text).toContain('Balcony cabins on AIDA Nova have fallen');
    expect(text).toContain('over the last 21 days');
    expect(text).toMatch(/currently \d+% above their historical minimum/);
    expect(text).toMatch(/\n\nRecommendation: (BUY NOW|LIKELY GOOD|WAIT|WAIT FOR DROP|MONITOR|AVOID)\nConfidence: \d+%$/);
  });

  it('describes a rise, mentions a confident forecast, and flags volatility', () => {
    const text = build((d) => 1000 + 40 * d);
    expect(text).toContain('have risen');
    expect(text).toContain('30-day trend forecast points to higher prices');
    const r = rng(2);
    expect(build(() => 1000 + (r() - 0.5) * 900, 60)).toContain('volatile');
  });

  it('says so when the price is stable or at its minimum', () => {
    expect(build(() => 1000)).toContain('have been stable over the last');
    expect(build((d) => 2000 - 10 * d)).toContain('at their historical minimum');
  });

  it('names the cheapest cabin when there is no category', () => {
    const s = obs(30, () => 1000);
    const text = generateInsight({ routeName: 'R', category: 'Cheapest cabin', series: s, recommendation: recommend(s), forecast: null, savings: savingsMetrics(s) });
    expect(text.startsWith('Prices for the cheapest cabin on R')).toBe(true);
  });

  it('does not over-claim without history', () => {
    const s = obs(1, () => 1000);
    const text = generateInsight({ routeName: 'R', category: 'Balcony', series: s, recommendation: recommend(s), forecast: null, savings: savingsMetrics(s) });
    expect(text).toContain('not enough price history');
  });
});
