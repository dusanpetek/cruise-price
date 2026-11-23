import { createT, type Locale } from '@cruise/i18n';
import type { PriceObservation } from './alerts';
import { euro } from './alerts';
import type { Forecast } from './forecast';
import { computeAnalytics } from './prices';
import type { Recommendation } from './recommendation';
import type { SavingsMetrics } from './savings';

const DAY_MS = 86_400_000;
const INSIGHT_WINDOW_DAYS = 21;
const HIGH_VOLATILITY_PCT = 8;

/**
 * Human-readable analysis assembled from templates over the computed numbers: no language model,
 * so it is deterministic and nothing leaves the machine.
 */
export function generateInsight(args: {
  routeName: string;
  category: string;
  series: readonly PriceObservation[];
  recommendation: Recommendation;
  forecast: Forecast | null;
  savings: SavingsMetrics | null;
  /** The fare the series is for, when the user looks at one fare. */
  fareName?: string | null;
  locale?: Locale;
}): string {
  const { routeName, category, series, recommendation, forecast, savings, fareName = null, locale = 'en' } = args;
  const t = createT(locale);
  const cheapest = category === 'Cheapest cabin';
  const subject = fareName
    ? cheapest
      ? t('Prices for the {fare} fare (cheapest cabin) on {route}', { fare: fareName, route: routeName })
      : t('Prices for {category} cabins with the {fare} fare on {route}', { category: t(category), fare: fareName, route: routeName })
    : cheapest
      ? t('Prices for the cheapest cabin on {route}', { route: routeName })
      : t('Prices for {category} cabins on {route}', { category: t(category), route: routeName });
  if (series.length < 2 || !savings) return t('{subject}: not enough price history yet to say anything useful. Keep collecting.', { subject });

  const sorted = [...series].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const latest = sorted[sorted.length - 1]!;
  const windowStart = Date.parse(latest.collectedAt) - INSIGHT_WINDOW_DAYS * DAY_MS;
  const baseline = sorted.findLast((p) => Date.parse(p.collectedAt) <= windowStart) ?? sorted[0]!;
  const days = Math.max(1, Math.round((Date.parse(latest.collectedAt) - Date.parse(baseline.collectedAt)) / DAY_MS));
  const changePct = baseline.price === 0 ? 0 : ((latest.price - baseline.price) / baseline.price) * 100;
  const a = computeAnalytics(sorted.map((p) => ({ collectedAt: p.collectedAt, packagePrice: p.price, flightSurcharge: 0 })))!;

  const sentences: string[] = [];
  sentences.push(
    Math.abs(changePct) < 0.5
      ? t('{subject} have been stable over the last {days} days.', { subject, days })
      : changePct < 0
        ? t('{subject} have fallen {pct}% over the last {days} days.', { subject, pct: Math.abs(changePct).toFixed(0), days })
        : t('{subject} have risen {pct}% over the last {days} days.', { subject, pct: Math.abs(changePct).toFixed(0), days }),
  );
  sentences.push(
    a.pctToMin === 0
      ? t('Prices are currently at their historical minimum.')
      : t('Prices are currently {pct}% above their historical minimum ({min}).', { pct: a.pctToMin.toFixed(0), min: euro(a.min) }),
  );
  if (forecast && forecast.confidence >= 0.5) {
    const move = ((forecast.forecast30Day - latest.price) / latest.price) * 100;
    if (Math.abs(move) >= 1) {
      sentences.push(t(move < 0 ? 'The 30-day trend forecast points to lower prices ({f30} versus {now} now).' : 'The 30-day trend forecast points to higher prices ({f30} versus {now} now).', { f30: euro(forecast.forecast30Day), now: euro(latest.price) }));
    }
  }
  if (savings.volatilityPct >= HIGH_VOLATILITY_PCT) {
    sentences.push(t('Prices on this route are volatile (about {pct}% variation), so timing matters.', { pct: savings.volatilityPct.toFixed(0) }));
  }

  return `${sentences.join(' ')}\n\n${t('Recommendation: {action}', { action: t(recommendation.action) })}\n${t('Confidence: {pct}%', { pct: Math.round(recommendation.confidence * 100) })}`;
}
