import { describe, expect, it } from 'vitest';
import { groupSeries } from './alerts';
import { backtestForecast, forecastAllCabins, forecastDashboard, forecastSeries, linearRegression, predictAt } from './forecast';
import { at, cabin, priced, rng, series as makeSeries, snapshot } from './testing';

const obs = (days: number, price: (d: number) => number) => groupSeries(makeSeries(days, price), null);

describe('linearRegression', () => {
  it('recovers an exact line', () => {
    const r = linearRegression([0, 1, 2, 3], [1, 3, 5, 7])!;
    expect(r).toMatchObject({ slope: 2, intercept: 1, r2: 1, n: 4 });
    expect(r.residualStd).toBeCloseTo(0);
  });

  it('has no fit for a constant series and fewer than two distinct x values', () => {
    expect(linearRegression([0, 1, 2], [5, 5, 5])).toMatchObject({ slope: 0, r2: 0 });
    expect(linearRegression([1], [1])).toBeNull();
    expect(linearRegression([2, 2], [1, 3])).toBeNull();
  });

  it('has zero residual spread with only two points', () => {
    expect(linearRegression([0, 1], [1, 5])!.residualStd).toBe(0);
  });
});

describe('forecastSeries', () => {
  it('extrapolates a steady rise and is fully confident in it', () => {
    const f = forecastSeries(obs(31, (d) => 1000 + 10 * d))!; // current 1300, +10/day
    expect(f).toMatchObject({ model: 'linear-regression', currentPrice: 1300, slopePerDay: 10, r2: 1, samples: 31, confidence: 1 });
    expect(f.forecast7Day).toBeCloseTo(1370, 0);
    expect(f.forecast30Day).toBeCloseTo(1600, 0);
    expect(f.forecast60Day).toBeCloseTo(1900, 0);
    expect(f.points.map((p) => p.days)).toEqual([7, 30, 60]);
    expect(f.curve).toHaveLength(61);
    expect(f.curve[0]!.days).toBe(0);
  });

  it('extrapolates a steady fall, never below zero', () => {
    const f = forecastSeries(obs(30, (d) => 400 - 10 * d))!; // current 110
    expect(f.slopePerDay).toBe(-10);
    expect(f.forecast30Day).toBe(0);
    expect(f.forecast60Day).toBe(0);
  });

  it('widens the prediction band with the horizon and with noise', () => {
    const r = rng(7);
    const f = forecastSeries(obs(40, (d) => 1000 + 5 * d + (r() - 0.5) * 80))!;
    const widths = f.points.map((p) => p.high - p.low);
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths[2]).toBeGreaterThan(widths[0]!);
    expect(f.points[1]!.low).toBeLessThan(f.points[1]!.price);
    expect(f.points[1]!.high).toBeGreaterThan(f.points[1]!.price);
    expect(f.confidence).toBeGreaterThan(0.5);
  });

  it('has low confidence for a trendless noisy series and for little data', () => {
    const r = rng(3);
    expect(forecastSeries(obs(40, () => 1000 + (r() - 0.5) * 100))!.confidence).toBeLessThan(0.2);
    expect(forecastSeries(obs(6, (d) => 1000 + d))!.confidence).toBeCloseTo(0.2, 1); // 6/30 of a perfect fit
  });

  it('needs at least five observations with distinct times', () => {
    expect(forecastSeries(obs(4, (d) => 1000 + d))).toBeNull();
    expect(forecastSeries([])).toBeNull();
    const same = Array.from({ length: 6 }, (_, i) => ({ snapshotId: `s${i}`, collectedAt: at(1), price: 100 + i }));
    expect(forecastSeries(same)).toBeNull();
  });

  it('only fits the most recent 60 days', () => {
    const f = forecastSeries(obs(160, (d) => (d < 100 ? 5000 - 20 * d : 3000 + 10 * (d - 100))))!;
    expect(f.slopePerDay).toBeCloseTo(10, 0); // the old regime (-20/day) is ignored; the inclusive boundary adds one old point
  });

  it('returns null when the recent window is too thin', () => {
    const sparse = [...obs(5, (d) => 1000 + d), { snapshotId: 'late', collectedAt: at(400), price: 900 }];
    expect(forecastSeries(sparse)).toBeNull();
  });

  it('is independent of input order and passes the context through', () => {
    const shuffled = [...obs(20, (d) => 1000 + d)].reverse();
    const ctx = { cabin: 'Balcony', provider: 'aida', departure: '2027-03-13' };
    expect(forecastSeries(shuffled, ctx)).toMatchObject({ currentPrice: 1019, context: ctx });
  });

  it('predictAt matches the forecast curve', () => {
    const s = obs(30, (d) => 1000 + 3 * d);
    expect(predictAt(s, 30)).toBe(forecastSeries(s)!.forecast30Day);
    expect(predictAt(obs(3, () => 1), 30)).toBeNull();
  });
});

describe('forecastAllCabins', () => {
  const snaps = Array.from({ length: 30 }, (_, d) =>
    snapshot(d, [cabin('Innenkabine', 500 + 2 * d), cabin('Balkonkabine', 900 - d)], '2027-03-13'),
  );

  it('forecasts the headline and every cabin category', () => {
    const { headline, cabins } = forecastAllCabins(snaps, { provider: 'aida' });
    expect(headline!.slopePerDay).toBe(4); // cheapest cabin is Innenkabine: total 1000 + 4d
    expect(headline!.context).toEqual({ cabin: null, provider: 'aida', departure: '2027-03-13' });
    expect(cabins.map((c) => c.category)).toEqual(['Innenkabine', 'Balkonkabine']);
    expect(cabins[1]!.forecast!.slopePerDay).toBe(-2);
    expect(cabins[0]!.forecast!.context.cabin).toBe('Innenkabine');
  });

  it('copes with no snapshots and with cabins that appear late', () => {
    expect(forecastAllCabins([], { provider: null })).toEqual({ headline: null, cabins: [] });
    const late = [...snaps.slice(0, 29), snapshot(29, [cabin('Innenkabine', 560), cabin('Suite', 2000)])];
    expect(forecastAllCabins(late, { provider: null }).cabins.find((c) => c.category === 'Suite')!.forecast).toBeNull();
  });
});

describe('backtestForecast (forecast validation)', () => {
  it('is perfectly accurate on a noiseless trend', () => {
    const b = backtestForecast(obs(120, (d) => 1000 + 8 * d), 30);
    expect(b.horizonDays).toBe(30);
    expect(b.samples).toBeGreaterThan(20);
    expect(b.directionalAccuracy).toBe(1);
    expect(b.mape).toBeLessThan(0.1);
    const p = b.points[0]!;
    expect(Date.parse(p.targetAt)).toBeGreaterThanOrEqual(Date.parse(p.cutoffAt) + 30 * 86_400_000);
    expect(p.directionCorrect).toBe(true);
  });

  it('beats the 70% accuracy target on a noisy trend', () => {
    const r = rng(11);
    const b = backtestForecast(obs(200, (d) => 2000 - 4 * d + (r() - 0.5) * 120), 30);
    expect(b.samples).toBeGreaterThan(30);
    expect(b.directionalAccuracy!).toBeGreaterThan(0.7);
    expect(b.mape!).toBeLessThan(10);
  });

  it('scores a flat market as correct when it predicts "no change"', () => {
    const b = backtestForecast(obs(100, () => 1500), 7);
    expect(b.directionalAccuracy).toBe(1);
    expect(b.mape).toBe(0);
  });

  it('counts a wrong call as wrong and reports the error', () => {
    // Trend reverses after 60 days, so forecasts made on the way up miss the way down.
    const b = backtestForecast(obs(120, (d) => (d < 60 ? 1000 + 10 * d : 1600 - 10 * (d - 60))), 30);
    expect(b.points.some((p) => !p.directionCorrect)).toBe(true);
    expect(b.directionalAccuracy!).toBeLessThan(1);
    expect(b.mape!).toBeGreaterThan(1);
  });

  it('limits the number of evaluations', () => {
    const b = backtestForecast(obs(300, (d) => 1000 + d), 7, { maxEvaluations: 20 });
    expect(b.samples).toBeLessThanOrEqual(20);
    expect(b.samples).toBeGreaterThan(10);
  });

  it('has no result without enough history or without a later observation', () => {
    expect(backtestForecast(obs(8, (d) => 1000 + d), 30)).toMatchObject({ samples: 0, directionalAccuracy: null, mape: null });
    // gaps larger than the tolerance: nothing to compare against
    const sparse = [...obs(12, (d) => 1000 + d), { snapshotId: 'x', collectedAt: at(300), price: 900 }];
    expect(backtestForecast(sparse, 30).samples).toBe(0);
  });

  it('handles zero prices', () => {
    expect(backtestForecast(obs(40, () => 0), 7).mape).toBe(0);
    expect(priced(0, 0).packagePrice).toBe(0);
  });
});

describe('forecastDashboard (advanced forecast dashboard)', () => {
  it('says what waiting a month is worth: 3.199 € now, 2.999 € in 30 days = 200 € potential saving', () => {
    const f = forecastSeries(obs(40, (d) => 3199 + (200 / 30) * (39 - d)))!;
    const d = forecastDashboard(f)!;
    expect(d.current).toBe(f.currentPrice);
    expect(d.forecast30Day).toBe(f.forecast30Day);
    expect(d.potentialSaving).toBeCloseTo(f.currentPrice - f.forecast30Day, 1);
    expect(d.potentialSaving).toBeGreaterThan(150);
    expect(d.potentialSavingPct).toBeCloseTo((d.potentialSaving / d.current) * 100, 1);
  });

  it('gives the expected price range and saving for 7, 30 and 60 days', () => {
    const f = forecastSeries(obs(40, (d) => 2000 - 5 * d + (d % 3) * 8))!;
    const d = forecastDashboard(f)!;
    expect(d.horizons.map((h) => h.days)).toEqual([7, 30, 60]);
    for (const h of d.horizons) {
      expect(h.low).toBeLessThanOrEqual(h.price);
      expect(h.high).toBeGreaterThanOrEqual(h.price);
      expect(h.expectedSaving).toBeCloseTo(f.currentPrice - h.price, 1);
    }
    expect(d.horizons[2]!.expectedSaving).toBeGreaterThan(d.horizons[0]!.expectedSaving);
  });

  it('is less confident the further ahead it looks, never above the model confidence, and between 0 and 1', () => {
    const noise = rng(3);
    const f = forecastSeries(obs(50, (d) => 1500 - 4 * d + noise() * 60))!;
    const [h7, h30, h60] = forecastDashboard(f)!.horizons;
    expect(h7!.confidence).toBeGreaterThanOrEqual(h30!.confidence);
    expect(h30!.confidence).toBeGreaterThanOrEqual(h60!.confidence);
    for (const h of [h7!, h30!, h60!]) {
      expect(h.confidence).toBeGreaterThanOrEqual(0);
      expect(h.confidence).toBeLessThanOrEqual(f.confidence);
    }
    expect(forecastDashboard(forecastSeries(obs(40, (d) => 1000 + 10 * d))!)!.horizons[0]!.confidence).toBe(1); // a perfect line has a zero-width band
  });

  it('reports a rising price as an expected extra cost (negative saving), and is null without a forecast', () => {
    const d = forecastDashboard(forecastSeries(obs(40, (d) => 1000 + 10 * d))!)!;
    expect(d.potentialSaving).toBeLessThan(0);
    expect(d.potentialSavingPct).toBeLessThan(0);
    expect(forecastDashboard(null)).toBeNull();
  });

  it('copes with a zero price', () => {
    const f = { ...forecastSeries(obs(40, (d) => 100 + d))!, currentPrice: 0 };
    expect(forecastDashboard(f)!.potentialSavingPct).toBe(0);
  });
});

describe('savingsProjection', () => {
  it('shows what waiting would save (or cost) at each horizon', async () => {
    const { savingsProjection } = await import('./forecast');
    const falling = forecastSeries(obs(30, (d) => 2000 - 10 * d))!; // current 1710, -10/day
    expect(savingsProjection(falling).map((p) => [p.label, p.savings])).toEqual([['Now', 0], ['+7 days', 70], ['+30 days', 300], ['+60 days', 600]]);
    const rising = forecastSeries(obs(30, (d) => 1000 + 10 * d))!;
    expect(savingsProjection(rising)[2]!.savings).toBe(-300);
    expect(savingsProjection(null)).toEqual([]);
  });
});
