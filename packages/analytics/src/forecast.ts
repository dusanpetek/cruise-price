import type { CruiseSnapshot } from '@cruise/domain';
import { groupSeries, type PriceObservation } from './alerts';

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const HORIZONS = [7, 30, 60] as const;
export const MIN_FORECAST_POINTS = 5;
const WINDOW_DAYS = 60;

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
  residualStd: number;
  n: number;
  meanX: number;
  sxx: number;
}

/** Ordinary least squares. Returns null if x has no spread (fewer than 2 distinct x values). */
export function linearRegression(xs: readonly number[], ys: readonly number[]): Regression | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const sse = ys.reduce((a, y, i) => a + (y - (intercept + slope * xs[i]!)) ** 2, 0);
  return {
    slope,
    intercept,
    r2: syy === 0 ? 0 : clamp(1 - sse / syy, 0, 1),
    residualStd: n > 2 ? Math.sqrt(sse / (n - 2)) : 0,
    n,
    meanX,
    sxx,
  };
}

export interface ForecastPoint {
  days: number;
  price: number;
  low: number;
  high: number;
}

export interface Forecast {
  model: 'linear-regression';
  currentPrice: number;
  forecast7Day: number;
  forecast30Day: number;
  forecast60Day: number;
  /** The three horizons with their 95% prediction interval. */
  points: ForecastPoint[];
  /** Daily curve for days 0..60 (for the confidence-band chart). */
  curve: ForecastPoint[];
  /** 0..1: how much to trust the trend = data sufficiency (n / 30) x fit quality (R²). */
  confidence: number;
  slopePerDay: number;
  r2: number;
  samples: number;
  /** Recorded for model V2; V1 only uses price over time. */
  context: { cabin: string | null; provider: string | null; departure: string | null };
}

interface Fitted {
  at: (days: number) => ForecastPoint;
  fit: Regression;
}

/** Fits the last 60 days of observations (x = days relative to the latest observation). */
function fit(series: readonly PriceObservation[], minPoints: number): Fitted | null {
  if (series.length < minPoints) return null;
  const latestT = Date.parse(series[series.length - 1]!.collectedAt);
  const recent = series.filter((p) => Date.parse(p.collectedAt) >= latestT - WINDOW_DAYS * DAY_MS);
  if (recent.length < minPoints) return null;
  const xs = recent.map((p) => (Date.parse(p.collectedAt) - latestT) / DAY_MS);
  const reg = linearRegression(xs, recent.map((p) => p.price));
  if (!reg) return null;
  const at = (days: number): ForecastPoint => {
    const price = Math.max(0, reg.intercept + reg.slope * days);
    const margin = 1.96 * reg.residualStd * Math.sqrt(1 + 1 / reg.n + (days - reg.meanX) ** 2 / reg.sxx);
    return { days, price: round2(price), low: round2(Math.max(0, price - margin)), high: round2(price + margin) };
  };
  return { at, fit: reg };
}

/** Predicts the price `days` after the latest observation, or null without enough data. Used by the backtest. */
export function predictAt(series: readonly PriceObservation[], days: number, minPoints = MIN_FORECAST_POINTS): number | null {
  return fit(series, minPoints)?.at(days).price ?? null;
}

export function forecastSeries(
  series: readonly PriceObservation[],
  context: Forecast['context'] = { cabin: null, provider: null, departure: null },
  minPoints = MIN_FORECAST_POINTS,
): Forecast | null {
  const sorted = [...series].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const fitted = fit(sorted, minPoints);
  if (!fitted) return null;
  const { at, fit: reg } = fitted;
  const points = HORIZONS.map(at);
  return {
    model: 'linear-regression',
    currentPrice: sorted[sorted.length - 1]!.price,
    forecast7Day: points[0]!.price,
    forecast30Day: points[1]!.price,
    forecast60Day: points[2]!.price,
    points,
    curve: Array.from({ length: 61 }, (_, d) => at(d)),
    confidence: round2(Math.min(1, reg.n / 30) * reg.r2),
    slopePerDay: round2(reg.slope),
    r2: round2(reg.r2),
    samples: reg.n,
    context,
  };
}

export interface CabinForecast {
  category: string;
  forecast: Forecast | null;
}

/** One forecast for the headline price and one per cabin category seen in the history. */
export function forecastAllCabins(
  snapshots: readonly CruiseSnapshot[],
  context: { provider: string | null },
): { headline: Forecast | null; cabins: CabinForecast[] } {
  const departure = [...snapshots].reverse().find((s) => s.cruise.departure)?.cruise.departure ?? null;
  const headline = forecastSeries(
    groupSeries(snapshots, null),
    { cabin: null, provider: context.provider, departure },
  );
  const categories = [...new Set(snapshots.flatMap((s) => s.cabins.map((c) => c.category)))];
  const cabins = categories.map((category) => {
    const series = snapshots
      .flatMap((s) => {
        const c = s.cabins.find((x) => x.category === category);
        return c ? [{ snapshotId: s.id, collectedAt: s.collectedAt, price: c.tripTotal }] : [];
      })
      .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
    return { category, forecast: forecastSeries(series, { cabin: category, provider: context.provider, departure }) };
  });
  return { headline, cabins };
}

export interface BacktestPoint {
  cutoffAt: string;
  targetAt: string;
  current: number;
  predicted: number;
  actual: number;
  directionCorrect: boolean;
  absPctError: number;
}

export interface BacktestResult {
  horizonDays: number;
  samples: number;
  /** Share of forecasts that called the direction (up / down / flat) correctly. null without samples. */
  directionalAccuracy: number | null;
  /** Mean absolute percentage error. */
  mape: number | null;
  points: BacktestPoint[];
}

const FLAT_PCT = 0.5;
const direction = (from: number, to: number) => {
  const pct = from === 0 ? 0 : ((to - from) / from) * 100;
  return Math.abs(pct) < FLAT_PCT ? 0 : Math.sign(pct);
};

/**
 * Walk-forward validation: at each cutoff, forecast from the history up to then and compare with the first
 * observation at least `horizonDays` later (within a tolerance). Evaluates at most `maxEvaluations` cutoffs.
 */
export function backtestForecast(
  series: readonly PriceObservation[],
  horizonDays: number,
  options: { minPoints?: number; maxEvaluations?: number } = {},
): BacktestResult {
  const { minPoints = 10, maxEvaluations = 60 } = options;
  const sorted = [...series].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const tolerance = Math.max(2, horizonDays * 0.25) * DAY_MS;
  const candidates = sorted.map((_, i) => i).filter((i) => i + 1 >= minPoints);
  const step = Math.max(1, Math.ceil(candidates.length / maxEvaluations));
  const points: BacktestPoint[] = [];

  for (const i of candidates.filter((_, k) => k % step === 0)) {
    const cutoff = sorted[i]!;
    const cutoffT = Date.parse(cutoff.collectedAt);
    const target = sorted.slice(i + 1).find((p) => Date.parse(p.collectedAt) >= cutoffT + horizonDays * DAY_MS);
    if (!target || Date.parse(target.collectedAt) > cutoffT + horizonDays * DAY_MS + tolerance) continue;
    const predicted = predictAt(sorted.slice(0, i + 1), horizonDays);
    if (predicted === null) continue;
    points.push({
      cutoffAt: cutoff.collectedAt,
      targetAt: target.collectedAt,
      current: cutoff.price,
      predicted,
      actual: target.price,
      directionCorrect: direction(cutoff.price, predicted) === direction(cutoff.price, target.price),
      absPctError: target.price === 0 ? 0 : (Math.abs(predicted - target.price) / target.price) * 100,
    });
  }

  const n = points.length;
  return {
    horizonDays,
    samples: n,
    directionalAccuracy: n ? round2(points.filter((p) => p.directionCorrect).length / n) : null,
    mape: n ? round2(points.reduce((a, p) => a + p.absPctError, 0) / n) : null,
    points,
  };
}

export interface ProjectionPoint {
  label: string;
  days: number;
  price: number;
  /** current price - projected price: positive means waiting would have saved that much. */
  savings: number;
}

/** What waiting would be worth: projected price and the saving (or extra cost) versus buying now, per horizon. */
export function savingsProjection(forecast: Forecast | null): ProjectionPoint[] {
  if (!forecast) return [];
  return [
    { label: 'Now', days: 0, price: forecast.currentPrice, savings: 0 },
    ...forecast.points.map((p) => ({ label: `+${p.days} days`, days: p.days, price: p.price, savings: round2(forecast.currentPrice - p.price) })),
  ];
}

export interface HorizonOutlook {
  days: number;
  price: number;
  /** 95% prediction interval. */
  low: number;
  high: number;
  /** Current price minus the expected price: positive = waiting is expected to save that much. */
  expectedSaving: number;
  /**
   * 0..1: the model confidence, scaled down by how wide the prediction interval is relative to the price
   * (a band as wide as the price itself means no confidence). Falls with the horizon because the band widens.
   */
  confidence: number;
}

export interface ForecastDashboard {
  current: number;
  forecast30Day: number;
  /** current - 30-day forecast: the "potential saving" by waiting a month (negative = expected extra cost). */
  potentialSaving: number;
  potentialSavingPct: number;
  /** Model confidence overall, 0..1. */
  confidence: number;
  horizons: HorizonOutlook[];
}

/** The numbers behind the advanced forecast dashboard: expected price range, expected savings and confidence per horizon. */
export function forecastDashboard(forecast: Forecast | null): ForecastDashboard | null {
  if (!forecast) return null;
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const potentialSaving = round2(forecast.currentPrice - forecast.forecast30Day);
  return {
    current: forecast.currentPrice,
    forecast30Day: forecast.forecast30Day,
    potentialSaving,
    potentialSavingPct: forecast.currentPrice === 0 ? 0 : round2((potentialSaving / forecast.currentPrice) * 100),
    confidence: forecast.confidence,
    horizons: forecast.points.map((p) => ({
      days: p.days,
      price: p.price,
      low: p.low,
      high: p.high,
      expectedSaving: round2(forecast.currentPrice - p.price),
      confidence: round2(clamp01(forecast.confidence * (1 - (p.high - p.low) / (2 * Math.max(p.price, 1))))),
    })),
  };
}
