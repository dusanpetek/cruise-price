import { createT, type Locale } from '@cruise/i18n';
import type { PriceObservation } from './alerts';

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LargestDrop {
  amount: number;
  pct: number;
  peakAt: string;
  troughAt: string;
}

export interface SavingsMetrics {
  current: number;
  historicalLow: number;
  historicalHigh: number;
  /** current - historical minimum */
  potentialSavings: number;
  /** potentialSavings as a share of the current price */
  potentialSavingsPct: number;
  /** Maximum peak-to-trough decline in the history; null if the price never fell. */
  largestDrop: LargestDrop | null;
  /** Coefficient of variation (std / mean) in percent: how much the price moves around. */
  volatilityPct: number;
  /** 0..100, 100 = perfectly steady. 100 - 5 x volatility%, floored at 0. */
  stabilityScore: number;
}

export function savingsMetrics(series: readonly PriceObservation[]): SavingsMetrics | null {
  if (series.length === 0) return null;
  const sorted = [...series].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const prices = sorted.map((p) => p.price);
  const current = prices[prices.length - 1]!;
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const std = Math.sqrt(prices.reduce((a, p) => a + (p - mean) ** 2, 0) / prices.length);
  const volatilityPct = mean === 0 ? 0 : (std / mean) * 100;

  let peak = sorted[0]!;
  let best: LargestDrop | null = null;
  for (const p of sorted) {
    if (p.price > peak.price) peak = p;
    const amount = peak.price - p.price;
    const pct = round2((amount / peak.price) * 100);
    // Largest absolute decline; between equal amounts the one that is bigger relative to its peak.
    if (amount > 0 && (!best || amount > best.amount || (round2(amount) === best.amount && pct > best.pct))) {
      best = { amount: round2(amount), pct, peakAt: peak.collectedAt, troughAt: p.collectedAt };
    }
  }

  return {
    current,
    historicalLow: low,
    historicalHigh: high,
    potentialSavings: round2(current - low),
    potentialSavingsPct: current === 0 ? 0 : round2(((current - low) / current) * 100),
    largestDrop: best,
    volatilityPct: round2(volatilityPct),
    stabilityScore: Math.round(Math.max(0, 100 - volatilityPct * 5)),
  };
}

export interface BookingBucket {
  fromDays: number;
  toDays: number;
  count: number;
  /** Mean price in the bucket relative to the overall mean (1.00 = average). */
  priceIndex: number;
}

export interface BookingWindow {
  buckets: BookingBucket[];
  /** The cheapest bucket, only when at least two buckets have enough data to compare. */
  best: (BookingBucket & { savingsVsAveragePct: number }) | null;
  /** Range of days-before-departure covered by the history. */
  coverageDays: { from: number; to: number } | null;
  note: string;
}

const MIN_BUCKET_SAMPLES = 5;

/**
 * Which stretch of "days before departure" has had the lowest prices. Prices are compared in 30-day buckets
 * relative to the route's own average. Needs history spanning more than one bucket to say anything.
 */
export function bookingWindow(series: readonly PriceObservation[], departure: string | null, bucketDays = 30, locale: Locale = 'en'): BookingWindow {
  const t = createT(locale);
  if (!departure) return { buckets: [], best: null, coverageDays: null, note: t('No departure date known for this route.') };
  const dep = Date.parse(departure);
  const rows = series
    .map((p) => ({ days: Math.floor((dep - Date.parse(p.collectedAt)) / DAY_MS), price: p.price }))
    .filter((r) => r.days >= 0);
  if (rows.length === 0) return { buckets: [], best: null, coverageDays: null, note: t('All snapshots are after the departure date.') };

  const mean = rows.reduce((a, r) => a + r.price, 0) / rows.length;
  const byBucket = new Map<number, number[]>();
  for (const r of rows) byBucket.set(Math.floor(r.days / bucketDays), [...(byBucket.get(Math.floor(r.days / bucketDays)) ?? []), r.price]);

  const buckets = [...byBucket]
    .sort(([a], [b]) => b - a)
    .map(([k, prices]): BookingBucket => ({
      fromDays: k * bucketDays,
      toDays: (k + 1) * bucketDays,
      count: prices.length,
      priceIndex: round2(prices.reduce((a, b) => a + b, 0) / prices.length / mean),
    }));
  const days = rows.map((r) => r.days);
  const coverageDays = { from: Math.min(...days), to: Math.max(...days) };
  const comparable = buckets.filter((b) => b.count >= MIN_BUCKET_SAMPLES);

  if (comparable.length < 2) {
    return { buckets, best: null, coverageDays, note: t('History only covers {from}-{to} days before departure; collect over a longer period to compare booking windows.', { from: coverageDays.from, to: coverageDays.to }) };
  }
  const best = comparable.reduce((a, b) => (b.priceIndex < a.priceIndex ? b : a));
  return {
    buckets,
    best: { ...best, savingsVsAveragePct: round2((1 - best.priceIndex) * 100) },
    coverageDays,
    note: t("Best so far: {from}-{to} days before departure ({pct}% below this route's average).", { from: best.fromDays, to: best.toDays, pct: round2((1 - best.priceIndex) * 100) }),
  };
}
