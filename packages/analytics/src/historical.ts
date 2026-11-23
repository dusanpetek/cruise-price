import type { CruiseSnapshot, ProviderId } from '@cruise/domain';
import type { Locale } from '@cruise/i18n';
import { groupSeries } from './alerts';
import { analyzeOptions, dealScoreBreakdown, optionSeries } from './fares';
import { forecastSeries } from './forecast';
import { recommendationTimeline, type TimelinePoint } from './recommendation';
import { bookingWindow, type BookingBucket } from './savings';
import { lastMinuteIntelligence, recommendBookingWindow, type BookingWindowRecommendation, type MarkStat } from './timing';

const round2 = (n: number) => Math.round(n * 100) / 100;
const MAX_POINTS = 60;

interface Extreme {
  price: number;
  at: string;
}

export interface OptionStatistics {
  cabinCategory: string;
  fareCode: string;
  fareName: string;
  samples: number;
  low: Extreme;
  high: Extreme;
  average: number;
}

export interface FareStatistics {
  fareCode: string;
  fareName: string;
  /** In how many cabins the latest snapshot offers the fare. */
  cabins: number;
  /** Mean surcharge in percent over the cheapest fare of the same cabin (0 for the cheapest). */
  averagePremiumPct: number;
  averageTotal: number;
  lowestTotal: number;
  /** Mean fare value score over its cabins. */
  averageValueScore: number;
}

/**
 * What the platform has learned about one route, derived from its snapshots: historical lows and highs, booking window
 * statistics, fare statistics, and the history of the deal score and of the recommendation. It is a derived aggregate
 * (snapshots stay the source of truth) that can be rebuilt at any time.
 */
export interface HistoricalDataset {
  routeId: string;
  routeName: string;
  provider: ProviderId;
  generatedAt: string;
  snapshotCount: number;
  firstAt: string | null;
  lastAt: string | null;
  lows: { route: Extreme | null; highest: Extreme | null; byOption: OptionStatistics[] };
  bookingWindowStats: {
    buckets: BookingBucket[];
    marks: MarkStat[];
    lowestWindow: { from: number; to: number } | null;
    recommended: BookingWindowRecommendation | null;
  };
  fareStats: FareStatistics[];
  /** Deal score of the headline trip total at past collections (walk-forward, at most 60 points). */
  dealScoreHistory: { at: string; score: number }[];
  recommendationHistory: (TimelinePoint & { at: string })[];
}

export function buildHistoricalDataset(route: { id: string; name: string; provider: ProviderId }, snapshots: readonly CruiseSnapshot[], generatedAt: string, locale: Locale = 'en'): HistoricalDataset {
  const sorted = [...snapshots].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const headline = groupSeries(sorted, null);
  const latest = sorted.at(-1);
  const departure = [...sorted].reverse().find((s) => s.cruise.departure)?.cruise.departure ?? null;
  const extreme = (pick: (a: number, b: number) => boolean): Extreme | null => {
    let best: Extreme | null = null;
    for (const p of headline) if (!best || pick(p.price, best.price)) best = { price: p.price, at: p.collectedAt };
    return best;
  };

  // per cabin x fare of the latest snapshot
  const byOption: OptionStatistics[] = (latest?.options ?? []).map((o) => {
    const series = optionSeries(sorted, o.cabinCategory, o.fareCode);
    const prices = series.map((p) => p.price);
    const at = (price: number) => series.find((p) => p.price === price)!.collectedAt;
    return {
      cabinCategory: o.cabinCategory,
      fareCode: o.fareCode,
      fareName: latest!.fares.find((f) => f.fareCode === o.fareCode)?.fareName ?? o.fareCode,
      samples: series.length,
      low: { price: Math.min(...prices), at: at(Math.min(...prices)) },
      high: { price: Math.max(...prices), at: at(Math.max(...prices)) },
      average: round2(prices.reduce((a, b) => a + b, 0) / prices.length),
    };
  });

  const options = analyzeOptions(route, sorted, locale);
  const fareStats: FareStatistics[] = [...new Set(options.map((o) => o.fare.fareCode))].map((fareCode) => {
    const mine = options.filter((o) => o.fare.fareCode === fareCode);
    const premiums = mine.map((o) => {
      const cheapest = Math.min(...options.filter((x) => x.cabinCategory === o.cabinCategory).map((x) => x.option.totalPrice));
      return cheapest === 0 ? 0 : ((o.option.totalPrice - cheapest) / cheapest) * 100;
    });
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
      fareCode,
      fareName: mine[0]!.fareName,
      cabins: new Set(mine.map((o) => o.cabinCategory)).size,
      averagePremiumPct: round2(mean(premiums)),
      averageTotal: round2(mean(mine.map((o) => o.option.totalPrice))),
      lowestTotal: Math.min(...mine.map((o) => o.option.totalPrice)),
      averageValueScore: Math.round(mean(mine.map((o) => o.valueScore))),
    };
  });

  // walk-forward deal score
  const step = Math.max(1, Math.ceil(headline.length / MAX_POINTS));
  const dealScoreHistory = headline.flatMap((p, i) => {
    if (i % step !== 0 && i !== headline.length - 1) return [];
    const prefix = headline.slice(0, i + 1);
    const f = forecastSeries(prefix, { cabin: null, provider: route.provider, departure: null });
    const change = f && f.currentPrice > 0 ? ((f.forecast30Day - f.currentPrice) / f.currentPrice) * 100 : null;
    return [{ at: p.collectedAt, score: dealScoreBreakdown(prefix, { expected30dChangePct: change, confidence: f?.confidence ?? 0 }).score }];
  });

  const lastMinute = lastMinuteIntelligence(headline, departure, null, locale);
  return {
    routeId: route.id,
    routeName: route.name,
    provider: route.provider,
    generatedAt,
    snapshotCount: sorted.length,
    firstAt: sorted[0]?.collectedAt ?? null,
    lastAt: latest?.collectedAt ?? null,
    lows: { route: extreme((a, b) => a < b), highest: extreme((a, b) => a > b), byOption },
    bookingWindowStats: {
      buckets: bookingWindow(headline, departure, 30, locale).buckets,
      marks: lastMinute.marks,
      lowestWindow: lastMinute.lowestWindow,
      recommended: recommendBookingWindow(headline, departure, null, locale),
    },
    fareStats,
    dealScoreHistory,
    recommendationHistory: recommendationTimeline(headline, MAX_POINTS).map((p) => ({ ...p, at: new Date(p.t).toISOString() })),
  };
}
