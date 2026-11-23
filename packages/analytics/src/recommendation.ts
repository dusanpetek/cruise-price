import { createT, type Locale } from '@cruise/i18n';
import type { PriceObservation } from './alerts';
import { euro } from './alerts';
import { computeAnalytics } from './prices';
import { forecastSeries, type Forecast } from './forecast';
import { savingsMetrics } from './savings';

export type RecommendationAction = 'BUY_NOW' | 'LIKELY_GOOD' | 'WAIT' | 'WAIT_FOR_DROP' | 'MONITOR' | 'AVOID';
export const RECOMMENDATION_ACTIONS: readonly RecommendationAction[] = ['BUY_NOW', 'LIKELY_GOOD', 'WAIT', 'WAIT_FOR_DROP', 'MONITOR', 'AVOID'];
/** Actions that say "book (soon)". */
export const isBuyAction = (a: RecommendationAction) => a === 'BUY_NOW' || a === 'LIKELY_GOOD';
/** Actions that say "do not book now". MONITOR makes no claim. */
export const isWaitAction = (a: RecommendationAction) => a === 'WAIT' || a === 'WAIT_FOR_DROP' || a === 'AVOID';

/** Optional context from the fare / cabin level, 0..100 each. */
export interface RecommendationContext {
  fareValue?: number | null;
  upgradeScore?: number | null;
}

/** The numbers a recommendation is based on (shown as supporting metrics). */
export interface RecommendationFactors {
  samples: number;
  /** Current trip total above the historical minimum, percent. */
  pctAboveLow: number | null;
  /** Expected change over 30 days, percent (negative = drop); null without a forecast. */
  expectedChange30dPct: number | null;
  forecastConfidence: number | null;
  volatilityPct: number | null;
  stabilityScore: number | null;
  fareValue: number | null;
  upgradeScore: number | null;
}

export interface Recommendation {
  action: RecommendationAction;
  /** 0..1 */
  confidence: number;
  /** The main sentence(s) of the explanation. */
  reason: string;
  /** Every recommendation is explained: the reason first, then the factors that went into it. */
  explanation: string[];
  factors: RecommendationFactors;
}

/** BUY_NOW when the price is within this share above the historical minimum. */
export const BUY_WITHIN_PCT = 3;
/** LIKELY_GOOD up to this share above the minimum (when no confident drop is expected). */
export const GOOD_WITHIN_PCT = 8;
/** WAIT when above the minimum by more than this share; AVOID above AVOID_ABOVE_PCT. */
export const WAIT_ABOVE_PCT = 15;
export const AVOID_ABOVE_PCT = 25;
/** WAIT_FOR_DROP when the 30-day forecast is at least this much below the current price. */
export const WAIT_DROP_PCT = 3;
/** A fare value score below this counts as poor value. */
export const POOR_VALUE_BELOW = 60;
export const AVOID_VALUE_BELOW = 40;
export const MIN_RECOMMENDATION_SAMPLES = 14;
export const MIN_FORECAST_CONFIDENCE = 0.5;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const asPoints = (series: readonly PriceObservation[]) =>
  series.map((s) => ({ collectedAt: s.collectedAt, packagePrice: s.price, flightSurcharge: 0 }));

const NO_FACTORS: RecommendationFactors = { samples: 0, pctAboveLow: null, expectedChange30dPct: null, forecastConfidence: null, volatilityPct: null, stabilityScore: null, fareValue: null, upgradeScore: null };

const withExplanation = (action: RecommendationAction, confidence: number, reason: string, lines: string[], factors: RecommendationFactors): Recommendation => ({
  action,
  confidence: round2(clamp01(confidence)),
  reason,
  explanation: [reason, ...lines],
  factors,
});

/**
 * Recommendation for one trip-total series, always with an explanation:
 *  - fewer than 14 snapshots: MONITOR (not enough history to say anything)
 *  - within 3% of the historical minimum: BUY_NOW (less confident if a confident forecast expects a further drop;
 *    LIKELY_GOOD when the fare is poor value)
 *  - a confident trend forecast of a >=3% drop within 30 days: WAIT_FOR_DROP
 *  - up to 8% above the minimum without an expected drop: LIKELY_GOOD
 *  - more than 25% above the minimum, or a poor fare (value < 40) well above its low: AVOID
 *  - more than 15% above the minimum: WAIT (the price is elevated)
 *  - otherwise MONITOR
 * `context` adds the fare value and upgrade score when the series belongs to a fare / cabin.
 */
export function recommend(series: readonly PriceObservation[], forecast: Forecast | null = forecastSeries(series), locale: Locale = 'en', context: RecommendationContext = {}): Recommendation {
  const t = createT(locale);
  const n = series.length;
  if (n === 0) return withExplanation('MONITOR', 0, t('No price history yet.'), [], NO_FACTORS);
  if (n < MIN_RECOMMENDATION_SAMPLES) {
    const reason = t('Only {n} price snapshots so far; at least {min} are needed for a reliable recommendation.', { n, min: MIN_RECOMMENDATION_SAMPLES });
    return withExplanation('MONITOR', (0.3 * n) / MIN_RECOMMENDATION_SAMPLES, reason, [], { ...NO_FACTORS, samples: n });
  }

  const a = computeAnalytics(asPoints(series))!;
  const sv = savingsMetrics(series)!;
  const fareValue = context.fareValue ?? null;
  const upgradeScore = context.upgradeScore ?? null;
  const dataFactor = Math.min(1, n / 30);
  const expectedChange = forecast && a.current > 0 ? ((forecast.forecast30Day - a.current) / a.current) * 100 : null;
  const expectedDrop = forecast ? ((a.current - forecast.forecast30Day) / a.current) * 100 : 0;
  const confidentDrop = !!forecast && forecast.confidence >= MIN_FORECAST_CONFIDENCE && expectedDrop >= WAIT_DROP_PCT;
  const confidentRise = !!forecast && forecast.confidence >= MIN_FORECAST_CONFIDENCE && expectedDrop <= -WAIT_DROP_PCT;
  const aboveLow = t('{pct}% above the historical minimum of {min}', { pct: a.pctToMin.toFixed(1), min: euro(a.min) });
  const poorValue = fareValue !== null && fareValue < POOR_VALUE_BELOW;
  const factors: RecommendationFactors = {
    samples: n,
    pctAboveLow: a.pctToMin,
    expectedChange30dPct: expectedChange === null ? null : round2(expectedChange),
    forecastConfidence: forecast ? round2(forecast.confidence) : null,
    volatilityPct: sv.volatilityPct,
    stabilityScore: sv.stabilityScore,
    fareValue,
    upgradeScore,
  };

  // The factors that went into the call, in the same order for every action.
  const lines: string[] = [t('Price position: current {price} is {above}.', { price: euro(a.current), above: aboveLow })];
  if (forecast && expectedChange !== null && forecast.confidence >= MIN_FORECAST_CONFIDENCE && Math.abs(expectedChange) >= 1) {
    lines.push(t(expectedChange < 0 ? 'Forecast: the trend model expects {f30} in 30 days ({pct}% lower), confidence {conf}%.' : 'Forecast: the trend model expects {f30} in 30 days ({pct}% higher), confidence {conf}%.', { f30: euro(forecast.forecast30Day), pct: Math.abs(expectedChange).toFixed(1), conf: Math.round(forecast.confidence * 100) }));
  } else {
    lines.push(t('Forecast: no confident trend signal.'));
  }
  lines.push(t('Volatility: prices move about {pct}% around their average (stability {score}/100).', { pct: sv.volatilityPct.toFixed(1), score: sv.stabilityScore }));
  if (fareValue !== null) lines.push(t('Fare value score: {score}/100 ({label}).', { score: Math.round(fareValue), label: t(valueLabelOf(fareValue)) }));
  if (upgradeScore !== null) lines.push(t('Upgrade score: {score}/100.', { score: Math.round(upgradeScore) }));
  lines.push(t('Based on {n} price snapshots.', { n }));

  if (a.pctToMin <= BUY_WITHIN_PCT) {
    const closeness = 1 - a.pctToMin / (2 * BUY_WITHIN_PCT);
    let confidence = closeness * (0.6 + 0.4 * dataFactor);
    let note = '';
    if (confidentDrop && forecast) {
      confidence -= 0.25 * forecast.confidence;
      note = ' ' + t('The trend forecast expects a further {pct}% drop, which lowers confidence.', { pct: expectedDrop.toFixed(1) });
    }
    const reason = t('Current price {price} is {above}.', { price: euro(a.current), above: aboveLow }) + note;
    if (poorValue) {
      return withExplanation('LIKELY_GOOD', confidence * 0.8, reason + ' ' + t('The fare itself is only poor value for the surcharge, so this is not a clear buy.'), lines, factors);
    }
    return withExplanation('BUY_NOW', confidence, reason, lines, factors);
  }

  if (confidentDrop && forecast) {
    const reason = t('Prices are trending down: the 30-day forecast is {f30} (-{drop}%) versus {now} now. The current price is {above}.', { f30: euro(forecast.forecast30Day), drop: expectedDrop.toFixed(1), now: euro(a.current), above: aboveLow });
    return withExplanation('WAIT_FOR_DROP', Math.min(0.95, forecast.confidence), reason, lines, factors);
  }

  if (a.pctToMin > AVOID_ABOVE_PCT || (fareValue !== null && fareValue < AVOID_VALUE_BELOW && a.pctToMin > GOOD_WITHIN_PCT)) {
    const reason = a.pctToMin > AVOID_ABOVE_PCT
      ? t('The current price is {above}, far above its historical range, so booking now is not advised.', { above: aboveLow })
      : t('The fare is poor value for the surcharge (score {score}/100) and the price is {above}, so booking now is not advised.', { score: Math.round(fareValue!), above: aboveLow });
    return withExplanation('AVOID', 0.5 + 0.3 * dataFactor - (confidentRise ? 0.2 : 0), reason, lines, factors);
  }

  if (a.pctToMin <= GOOD_WITHIN_PCT && !poorValue) {
    const reason = t('The current price is {above} and no further drop is expected, so booking soon looks good.', { above: aboveLow });
    const confidence = 0.45 + 0.25 * dataFactor - 0.02 * (a.pctToMin - BUY_WITHIN_PCT) + (confidentRise ? 0.1 : 0);
    return withExplanation('LIKELY_GOOD', confidence, reason, lines, factors);
  }

  if (a.pctToMin > WAIT_ABOVE_PCT && !confidentRise) {
    const reason = t('The current price is {above}, well above the usual level. Waiting is likely to pay off.', { above: aboveLow });
    return withExplanation('WAIT', 0.4 + 0.2 * dataFactor, reason, lines, factors);
  }

  const reason = t('The current price is {above} and the trend forecast gives no confident signal.', { above: aboveLow });
  return withExplanation('MONITOR', Math.min(0.6, 0.3 + 0.3 * dataFactor), reason, lines, factors);
}

/** Fare value 0..100 -> label key (shared by the recommendation and the fare value score). */
export function valueLabelOf(score: number): 'Excellent value' | 'Good value' | 'Neutral value' | 'Poor value' {
  return score >= 90 ? 'Excellent value' : score >= 75 ? 'Good value' : score >= 60 ? 'Neutral value' : 'Poor value';
}

export interface TimelinePoint {
  t: number;
  price: number;
  action: RecommendationAction;
  confidence: number;
}

/** What the recommendation would have been at each past collection (walk-forward, evaluating at most `maxPoints`). */
function walk(series: readonly PriceObservation[], maxPoints: number) {
  const sorted = [...series].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const indexes = sorted.map((_, i) => i).filter((i) => i + 1 >= MIN_RECOMMENDATION_SAMPLES);
  const step = Math.max(1, Math.ceil(indexes.length / maxPoints));
  return indexes
    .filter((_, k) => k % step === 0)
    .map((i) => ({ i, sorted, recommendation: recommend(sorted.slice(0, i + 1)) }));
}

export function recommendationTimeline(series: readonly PriceObservation[], maxPoints = 40): TimelinePoint[] {
  return walk(series, maxPoints).map(({ i, sorted, recommendation }) => ({
    t: Date.parse(sorted[i]!.collectedAt),
    price: sorted[i]!.price,
    action: recommendation.action,
    confidence: recommendation.confidence,
  }));
}

export interface RecommendationAccuracy {
  samples: number;
  /** null when no recommendation has a completed 30-day outcome yet. */
  accuracy: number | null;
}

const DAY_MS = 86_400_000;

/**
 * Hindsight check of buy / wait calls whose 30-day outcome is known (MONITOR makes no claim and is skipped):
 * BUY_NOW and LIKELY_GOOD were right if no price at least 3% lower showed up within 30 days; WAIT, WAIT_FOR_DROP and AVOID
 * were right if the price fell by at least 2%.
 */
export function recommendationAccuracy(series: readonly PriceObservation[], maxPoints = 40): RecommendationAccuracy {
  let correct = 0;
  let samples = 0;
  for (const { i, sorted, recommendation } of walk(series, maxPoints)) {
    if (recommendation.action === 'MONITOR') continue;
    const t0 = Date.parse(sorted[i]!.collectedAt);
    const future = sorted.slice(i + 1).filter((p) => Date.parse(p.collectedAt) <= t0 + 30 * DAY_MS);
    if (!sorted.slice(i + 1).some((p) => Date.parse(p.collectedAt) >= t0 + 30 * DAY_MS)) continue; // outcome not known yet
    const lowest = Math.min(...future.map((p) => p.price));
    const current = sorted[i]!.price;
    samples++;
    if (isBuyAction(recommendation.action) ? lowest >= current * 0.97 : lowest <= current * 0.98) correct++;
  }
  return { samples, accuracy: samples ? round2(correct / samples) : null };
}
