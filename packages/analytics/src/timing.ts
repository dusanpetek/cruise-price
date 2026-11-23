import { createT, type Locale } from '@cruise/i18n';
import type { PriceObservation } from './alerts';
import type { Forecast } from './forecast';
import { savingsMetrics } from './savings';

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Days before departure at which the price is tracked. */
export const LAST_MINUTE_MARKS = [180, 120, 90, 60, 30, 14, 7] as const;
export const MIN_TIMING_SAMPLES = 10;

interface Point {
  /** Days before departure (>= 0). */
  days: number;
  price: number;
}

function pointsOf(series: readonly PriceObservation[], departure: string | null): Point[] {
  if (!departure) return [];
  const dep = Date.parse(departure);
  return series
    .map((p) => ({ days: Math.round((dep - Date.parse(p.collectedAt)) / DAY_MS), price: p.price }))
    .filter((p) => p.days >= 0)
    .sort((a, b) => b.days - a.days);
}

export interface MarkStat {
  daysBefore: number;
  /** Mean price of the collections around this mark; null when none was collected there. */
  price: number | null;
  samples: number;
  /** price relative to the route's overall mean (1.00 = average). */
  priceIndex: number | null;
}

export interface DaysWindow {
  /** The smaller number of days before departure. */
  from: number;
  /** The larger number of days before departure. */
  to: number;
}

export interface LastMinuteIntelligence {
  available: boolean;
  note: string;
  marks: MarkStat[];
  lowestPrice: number | null;
  /** Days before departure at which the lowest prices (the cheapest tenth of all collections) occurred. */
  lowestWindow: DaysWindow | null;
  /** Mean size of the price drops / rises between two collections, in percent (both positive); null when there were none. */
  avgDropPct: number | null;
  avgRisePct: number | null;
  /** The booking window with the best prices (see `recommendBookingWindow`). */
  bestWindow: DaysWindow | null;
  volatilityPct: number;
  /** 0..100, 100 = perfectly steady. */
  stabilityScore: number;
}

/** Half the distance to the neighbouring marks, at most 15 days: the collections that count for a mark. */
const markTolerance = (mark: number) => {
  const gaps = LAST_MINUTE_MARKS.filter((m) => m !== mark).map((m) => Math.abs(m - mark));
  return Math.min(15, Math.ceil(Math.min(...gaps) / 2));
};

/**
 * When prices have been lowest relative to the departure, and how they move: the price around 180/120/90/60/30/14/7 days before
 * departure, where the lowest prices occurred, and the average drop and rise between collections. Needs a departure date and
 * at least 10 collections.
 */
export function lastMinuteIntelligence(series: readonly PriceObservation[], departure: string | null, forecast: Forecast | null = null, locale: Locale = 'en'): LastMinuteIntelligence {
  const t = createT(locale);
  const points = pointsOf(series, departure);
  const sv = savingsMetrics(series);
  const base = { volatilityPct: sv?.volatilityPct ?? 0, stabilityScore: sv?.stabilityScore ?? 100 };
  const empty: LastMinuteIntelligence = {
    available: false,
    note: departure ? t('Not enough history for last-minute analysis: at least {min} collections before departure are needed.', { min: MIN_TIMING_SAMPLES }) : t('No departure date known for this route.'),
    marks: LAST_MINUTE_MARKS.map((daysBefore) => ({ daysBefore, price: null, samples: 0, priceIndex: null })),
    lowestPrice: null,
    lowestWindow: null,
    avgDropPct: null,
    avgRisePct: null,
    bestWindow: null,
    ...base,
  };
  if (points.length < MIN_TIMING_SAMPLES) return empty;

  const mean = points.reduce((a, p) => a + p.price, 0) / points.length;
  const marks = LAST_MINUTE_MARKS.map((daysBefore): MarkStat => {
    const tol = markTolerance(daysBefore);
    const near = points.filter((p) => Math.abs(p.days - daysBefore) <= tol);
    if (near.length === 0) return { daysBefore, price: null, samples: 0, priceIndex: null };
    const price = near.reduce((a, p) => a + p.price, 0) / near.length;
    return { daysBefore, price: round2(price), samples: near.length, priceIndex: mean === 0 ? null : round2(price / mean) };
  });

  const lowestCount = Math.max(1, Math.ceil(points.length * 0.1));
  // The cheapest tenth of all collections, as far as they are really close to the lowest price (within 5%).
  const ranked = [...points].sort((a, b) => a.price - b.price || b.days - a.days);
  const lowest = ranked.slice(0, lowestCount).filter((p) => p.price <= ranked[0]!.price + Math.abs(ranked[0]!.price) * 0.05);
  const lowestWindow = { from: Math.min(...lowest.map((p) => p.days)), to: Math.max(...lowest.map((p) => p.days)) };

  const drops: number[] = [];
  const rises: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.price;
    if (prev === 0) continue;
    const change = ((points[i]!.price - prev) / prev) * 100;
    if (change < 0) drops.push(-change);
    else if (change > 0) rises.push(change);
  }
  const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const recommendation = recommendBookingWindow(series, departure, forecast, locale);

  return {
    available: true,
    note: t('Historical lowest prices occurred {from}-{to} days before departure.', { from: lowestWindow.from, to: lowestWindow.to }),
    marks,
    lowestPrice: lowest[0]!.price,
    lowestWindow,
    avgDropPct: avg(drops),
    avgRisePct: avg(rises),
    bestWindow: recommendation ? { from: recommendation.from, to: recommendation.to } : null,
    ...base,
  };
}

export interface BookingWindowRecommendation {
  /** Recommended booking window in days before departure (from <= to). */
  from: number;
  to: number;
  /** 0..1 */
  confidence: number;
  /** Days before departure today; the window is "open" when today is inside it. */
  currentDaysBefore: number;
  insideWindow: boolean;
  basis: { samples: number; historicalLowDaysBefore: number; volatilityPct: number; forecast: 'drop' | 'rise' | 'flat' | 'unknown' };
  note: string;
}

/**
 * When to book: the stretch of "days before departure" in which the price came within a tolerance of its historical low
 * (tolerance = half the route's volatility, between 2% and 10%), rounded outwards to 5 days and at least 10 days wide.
 * The forecast does not move the window; it is reported so the user can see whether it agrees. Null without a departure
 * date or with fewer than 10 collections.
 */
export function recommendBookingWindow(series: readonly PriceObservation[], departure: string | null, forecast: Forecast | null = null, locale: Locale = 'en'): BookingWindowRecommendation | null {
  const t = createT(locale);
  const points = pointsOf(series, departure);
  if (points.length < MIN_TIMING_SAMPLES) return null;
  const sv = savingsMetrics(series)!;
  const low = Math.min(...points.map((p) => p.price));
  const tolerance = clamp(sv.volatilityPct / 2, 2, 10) / 100;
  const near = points.filter((p) => p.price <= low + Math.abs(low) * tolerance);
  let from = Math.max(0, Math.floor(Math.min(...near.map((p) => p.days)) / 5) * 5);
  let to = Math.ceil(Math.max(...near.map((p) => p.days)) / 5) * 5;
  if (to - from < 10) {
    from = Math.max(0, from - Math.ceil((10 - (to - from)) / 10) * 5);
    to = Math.max(to, from + 10);
  }
  const lowestPoint = points.reduce((a, b) => (b.price < a.price ? b : a));
  const currentDaysBefore = points[points.length - 1]!.days;
  const expected = forecast && forecast.currentPrice > 0 ? ((forecast.forecast30Day - forecast.currentPrice) / forecast.currentPrice) * 100 : null;
  const forecastBasis = expected === null || forecast!.confidence < 0.5 ? 'unknown' : expected <= -3 ? 'drop' : expected >= 3 ? 'rise' : 'flat';
  const confidence = round2(clamp(0.25 + 0.5 * Math.min(1, points.length / 60) + (near.length >= 3 ? 0.15 : 0) - (sv.volatilityPct > 10 ? 0.1 : 0), 0.1, 0.95));
  return {
    from,
    to,
    confidence,
    currentDaysBefore,
    insideWindow: currentDaysBefore >= from && currentDaysBefore <= to,
    basis: { samples: points.length, historicalLowDaysBefore: lowestPoint.days, volatilityPct: sv.volatilityPct, forecast: forecastBasis },
    note: t('Recommended booking window: {from}-{to} days before departure.', { from, to }),
  };
}
