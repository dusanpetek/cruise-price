import type { Locale } from '@cruise/i18n';
import { CABIN_GROUPS, CABIN_GROUP_LABELS, cabinGroupOf, type CabinGroup, type CruiseSnapshot, type ProviderId } from '@cruise/domain';
import { categoryLabel, groupSeries, type PriceObservation } from './alerts';
import { analyzeOptions, bestCabinOf, observationsToPoints, bestFareOf, dealFinder, dealScoreBreakdown, dealScoreFrom, dealScoreOf, fareHighlights, selectionSeries, type DealFinder, type FareHighlights, type OptionIntelligence } from './fares';
import { backtestForecast, forecastAllCabins, forecastSeries, type BacktestResult, type CabinForecast, type Forecast } from './forecast';
import { generateInsight } from './insights';
import { computeAnalytics, type PriceAnalytics } from './prices';
import {
  isBuyAction,
  recommend,
  recommendationAccuracy,
  recommendationTimeline,
  type Recommendation,
  type RecommendationAccuracy,
  type TimelinePoint,
} from './recommendation';
import { bookingWindow, savingsMetrics, type BookingWindow, type SavingsMetrics } from './savings';
import { lastMinuteIntelligence, recommendBookingWindow, type BookingWindowRecommendation, type LastMinuteIntelligence } from './timing';
import { analyzeUpgrades, bestUpgradeOf, type UpgradeOpportunity } from './upgrades';

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface RouteRef {
  id: string;
  name: string;
  provider: ProviderId;
  url: string;
  /** The fare and cabin the user chose as favorite for this route; the route's headline numbers follow it. */
  favorite?: { fareCode: string | null; cabin: string | null } | null;
}

export interface GroupIntelligence {
  group: CabinGroup;
  label: string;
  current: number;
  low: number;
  pctToMin: number;
  expected30dChangePct: number | null;
  recommendation: Recommendation;
  insight: string;
  /** Unified deal score of the group's cheapest trip total (history, forecast, trend, fare value, upgrade value). */
  dealScore: number;
  /** Mean fare value score of the group's options; null without fare data. */
  valueScore: number | null;
  /** Best upgrade score for moving up into this group; null when there is no upgrade into it. */
  upgradeScore: number | null;
  /** Heatmap cell: strong deal (green), neutral (yellow), poor deal (red). */
  heat: { score: number; level: HeatLevel };
}

export type HeatLevel = 'strong' | 'neutral' | 'poor';
export const STRONG_HEAT_FROM = 65;
export const POOR_HEAT_BELOW = 45;
export const heatLevelOf = (score: number): HeatLevel => (score >= STRONG_HEAT_FROM ? 'strong' : score < POOR_HEAT_BELOW ? 'poor' : 'neutral');

export interface RouteIntelligence {
  routeId: string;
  routeName: string;
  provider: ProviderId;
  url: string;
  currency: string;
  snapshotCount: number;
  latestAt: string | null;
  departure: string | null;
  analytics: PriceAnalytics | null;
  recommendation: Recommendation;
  forecast: Forecast | null;
  /** Expected change of the headline price over 30 days in percent (negative = expected to fall). */
  expected30dChangePct: number | null;
  cabinForecasts: CabinForecast[];
  groups: GroupIntelligence[];
  savings: SavingsMetrics | null;
  bookingWindow: BookingWindow;
  insight: string;
  /** Walk-forward validation of the 30-day forecast, and of past BUY / WAIT calls. */
  backtest: BacktestResult;
  recommendationTimeline: TimelinePoint[];
  recommendationAccuracy: RecommendationAccuracy;
  /** Every cabin x fare of the latest snapshot with history, outlook and scores. Empty for snapshots without fare data. */
  options: OptionIntelligence[];
  /** Deal score 0..100 of the headline trip total: (historical position + forecast opportunity + current discount) / 3. */
  dealScore: number;
  /** Highest-scoring fare and cabin of the latest snapshot (null without fare data). */
  bestFare: OptionIntelligence | null;
  bestCabin: OptionIntelligence | null;
  /** Set when the headline numbers (price, trend, forecast, recommendation, insight, score) are those of the favorite fare / cabin instead of the cheapest cabin. */
  focus: { fareCode: string | null; fareName: string | null; cabin: string | null } | null;
  ship: string | null;
  durationNights: number | null;
  /** Is moving up one cabin group worth it? Every neighbouring pair of groups at every fare, best first. */
  upgrades: UpgradeOpportunity[];
  bestUpgrade: UpgradeOpportunity | null;
  /** Prices around 180/120/90/60/30/14/7 days before departure, where the lowest prices occurred, average drops and rises. */
  lastMinute: LastMinuteIntelligence;
  /** When to book, in days before departure; null without a departure date or enough history. */
  recommendedBookingWindow: BookingWindowRecommendation | null;
}

const expectedChange = (f: Forecast | null) => (f && f.currentPrice > 0 ? round2(((f.forecast30Day - f.currentPrice) / f.currentPrice) * 100) : null);

/** Everything the dashboard, forecast page and reports need for one route. */
export function analyzeRoute(route: RouteRef, snapshots: readonly CruiseSnapshot[], locale: Locale = 'en'): RouteIntelligence {
  const sorted = [...snapshots].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const cheapest = groupSeries(sorted, null);
  const latest = sorted.at(-1);
  const departure = [...sorted].reverse().find((s) => s.cruise.departure)?.cruise.departure ?? null;
  const all = forecastAllCabins(sorted, { provider: route.provider });
  const cabins = all.cabins;

  // A favorite fare / cabin replaces the cheapest cabin as the route's headline, as long as it is still offered.
  const fav = route.favorite && (route.favorite.fareCode || route.favorite.cabin) ? route.favorite : null;
  const favSeries = fav ? selectionSeries(sorted, { cabin: fav.cabin, fareCode: fav.fareCode }) : [];
  const favorite = fav && favSeries.length > 0 && favSeries.at(-1)?.snapshotId === latest?.id ? fav : null;
  const fareName = favorite?.fareCode ? (latest?.fares.find((f) => f.fareCode === favorite.fareCode)?.fareName ?? favorite.fareCode) : null;
  const headline = favorite ? favSeries : cheapest;

  // Fare value and upgrades first: the deal score and the recommendation take them into account.
  const upgrades = analyzeUpgrades(route, sorted).sort((a, b) => b.upgradeScore - a.upgradeScore || a.costDifference - b.costDifference);
  const options = analyzeOptions(route, sorted, locale).map((o) => {
    const up = upgrades.find((u) => u.fareCode === o.fare.fareCode && u.to.cabinCategory === o.cabinCategory);
    if (!up) return o;
    const dealComponents = { ...o.dealComponents, upgradeValue: up.upgradeScore };
    return { ...o, dealComponents, dealScore: dealScoreFrom(dealComponents) };
  });
  const favOption = favorite?.fareCode && favorite.cabin ? options.find((o) => o.fare.fareCode === favorite.fareCode && o.cabinCategory === favorite.cabin) : undefined;
  const favGroup = favorite?.cabin ? cabinGroupOf(favorite.cabin) : null;
  const favUpgrade = favGroup ? upgrades.find((u) => u.to.group === favGroup && (!favorite?.fareCode || u.fareCode === favorite.fareCode)) : undefined;
  const focus = favorite
    ? analyzeSeries({ series: favSeries, routeName: route.name, label: favorite.cabin ?? 'Cheapest cabin', fareName, provider: route.provider, locale, fareValue: favOption?.valueScore ?? null, upgradeValue: favUpgrade?.upgradeScore ?? null })
    : null;
  const forecast = focus ? focus.forecast : all.headline;
  const recommendation = focus ? focus.recommendation : recommend(headline, forecast, locale);
  const savings = focus ? focus.savings : savingsMetrics(headline);

  const groups = CABIN_GROUPS.flatMap((group): GroupIntelligence[] => {
    const series = groupSeries(sorted, group);
    const last = series.at(-1);
    if (!last || last.snapshotId !== latest?.id) return [];
    const f = forecastSeries(series, { cabin: group, provider: route.provider, departure });
    const inGroup = options.filter((o) => o.cabinGroup === group);
    const valueScore = inGroup.length ? Math.round(inGroup.reduce((a, o) => a + o.valueScore, 0) / inGroup.length) : null;
    const upgradeScore = upgrades.filter((u) => u.to.group === group).reduce<number | null>((best, u) => (best === null || u.upgradeScore > best ? u.upgradeScore : best), null);
    const rec = recommend(series, f, locale, { fareValue: valueScore, upgradeScore });
    const s = savingsMetrics(series)!;
    const outlook = { expected30dChangePct: expectedChange(f), confidence: f?.confidence ?? 0 };
    const deal = dealScoreBreakdown(series, outlook, { fareValue: valueScore, upgradeValue: upgradeScore });
    return [
      {
        group,
        label: CABIN_GROUP_LABELS[group],
        current: last.price,
        low: s.historicalLow,
        pctToMin: s.historicalLow === 0 ? 0 : round2(((last.price - s.historicalLow) / s.historicalLow) * 100),
        expected30dChangePct: expectedChange(f),
        recommendation: rec,
        insight: generateInsight({ routeName: route.name, category: categoryLabel(group), series, recommendation: rec, forecast: f, savings: s, locale }),
        dealScore: deal.score,
        valueScore,
        upgradeScore,
        heat: { score: deal.score, level: heatLevelOf(deal.score) },
      },
    ];
  });

  return {
    routeId: route.id,
    routeName: route.name,
    provider: route.provider,
    url: route.url,
    currency: latest?.currency ?? 'EUR',
    snapshotCount: sorted.length,
    latestAt: latest?.collectedAt ?? null,
    departure,
    analytics: focus ? focus.analytics : computeAnalytics(sorted),
    recommendation,
    forecast,
    expected30dChangePct: expectedChange(forecast),
    cabinForecasts: cabins,
    groups,
    savings,
    bookingWindow: bookingWindow(headline, departure, 30, locale),
    insight: focus ? focus.insight : generateInsight({ routeName: route.name, category: 'Cheapest cabin', series: headline, recommendation, forecast, savings, locale }),
    backtest: backtestForecast(headline, 30),
    recommendationTimeline: recommendationTimeline(headline),
    recommendationAccuracy: recommendationAccuracy(headline),
    options,
    dealScore: focus ? focus.dealScore : headline.length === 0 ? 0 : dealScoreOf(headline, { expected30dChangePct: expectedChange(forecast), confidence: forecast?.confidence ?? 0 }),
    bestFare: bestFareOf(options),
    bestCabin: bestCabinOf(options),
    focus: favorite ? { fareCode: favorite.fareCode, fareName, cabin: favorite.cabin } : null,
    ship: latest?.cruise.ship ?? null,
    durationNights: latest?.cruise.durationNights ?? null,
    upgrades,
    bestUpgrade: bestUpgradeOf(upgrades),
    lastMinute: lastMinuteIntelligence(headline, departure, forecast, locale),
    recommendedBookingWindow: recommendBookingWindow(headline, departure, forecast, locale),
  };
}

export interface ProviderScorecard {
  provider: ProviderId;
  routes: number;
  averagePrice: number;
  /** Mean discount of the current price versus each route's historical high, in percent. */
  averageDiscountPct: number;
  volatilityPct: number;
  stabilityScore: number;
  /** Mean directional accuracy of the 30-day forecasts; null until a backtest has samples. */
  forecastAccuracy: number | null;
  /** 0..100: 35% discount (20% = full marks), 35% stability, 30% forecast accuracy (50 while unknown). Prices are trip totals. */
  score: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function providerScorecards(routes: readonly RouteIntelligence[]): ProviderScorecard[] {
  const by = new Map<ProviderId, RouteIntelligence[]>();
  for (const r of routes) if (r.savings) by.set(r.provider, [...(by.get(r.provider) ?? []), r]);
  return [...by].map(([provider, rs]) => {
    const discounts = rs.map((r) => (r.savings!.historicalHigh === 0 ? 0 : ((r.savings!.historicalHigh - r.savings!.current) / r.savings!.historicalHigh) * 100));
    const accuracies = rs.flatMap((r) => (r.backtest.directionalAccuracy === null ? [] : [r.backtest.directionalAccuracy]));
    const averageDiscountPct = mean(discounts);
    const stability = mean(rs.map((r) => r.savings!.stabilityScore));
    const accuracy = accuracies.length ? mean(accuracies) : null;
    return {
      provider,
      routes: rs.length,
      averagePrice: Math.round(mean(rs.map((r) => r.savings!.current))),
      averageDiscountPct: round2(averageDiscountPct),
      volatilityPct: round2(mean(rs.map((r) => r.savings!.volatilityPct))),
      stabilityScore: Math.round(stability),
      forecastAccuracy: accuracy === null ? null : round2(accuracy),
      score: Math.round(0.35 * clamp((averageDiscountPct / 20) * 100, 0, 100) + 0.35 * stability + 0.3 * (accuracy === null ? 50 : accuracy * 100)),
    };
  });
}

/** A route with its deal score (already part of the analysis). */
export type RankedRoute = RouteIntelligence;

export interface Portfolio {
  generatedAt: string;
  routes: RankedRoute[];
  /** BUY recommendations, most confident first. */
  bestOpportunities: RankedRoute[];
  /** Largest current-minus-historical-low first. */
  highestSavings: RankedRoute[];
  rankings: { deals: RankedRoute[]; volatile: RankedRoute[]; stable: RankedRoute[] };
  providers: ProviderScorecard[];
  /** Every cabin x fare of every route. */
  options: OptionIntelligence[];
  deals: DealFinder;
  fareHighlights: FareHighlights;
  /** Every upgrade opportunity of every route, best score first. */
  upgrades: UpgradeOpportunity[];
  /** The "Best Upgrade Opportunity" widget. */
  bestUpgrade: UpgradeOpportunity | null;
}

export function analyzePortfolio(items: readonly { route: RouteRef; snapshots: readonly CruiseSnapshot[] }[], generatedAt: string, locale: Locale = 'en'): Portfolio {
  const analyzed = items.map((i) => analyzeRoute(i.route, i.snapshots, locale));
  const providers = providerScorecards(analyzed);
  const routes: RankedRoute[] = analyzed;
  const withData = routes.filter((r) => r.savings);

  return {
    generatedAt,
    routes,
    bestOpportunities: routes
      .filter((r) => isBuyAction(r.recommendation.action))
      .sort((a, b) => b.recommendation.confidence - a.recommendation.confidence),
    highestSavings: [...withData].sort((a, b) => b.savings!.potentialSavings - a.savings!.potentialSavings),
    rankings: {
      deals: [...withData].sort((a, b) => b.dealScore - a.dealScore).slice(0, 10),
      volatile: [...withData].sort((a, b) => b.savings!.volatilityPct - a.savings!.volatilityPct),
      stable: [...withData].sort((a, b) => a.savings!.volatilityPct - b.savings!.volatilityPct),
    },
    providers,
    options: analyzed.flatMap((r) => r.options),
    deals: dealFinder(analyzed.flatMap((r) => r.options)),
    fareHighlights: fareHighlights(analyzed.flatMap((r) => r.options)),
    upgrades: analyzed.flatMap((r) => r.upgrades).sort((a, b) => b.upgradeScore - a.upgradeScore || a.costDifference - b.costDifference),
    bestUpgrade: bestUpgradeOf(analyzed.flatMap((r) => r.upgrades)),
  };
}

export interface SeriesAnalysis {
  analytics: PriceAnalytics | null;
  forecast: Forecast | null;
  recommendation: Recommendation;
  savings: SavingsMetrics | null;
  insight: string;
  /** Deal score 0..100 of the series' trip total. */
  dealScore: number;
}

/**
 * Statistics, forecast, recommendation, savings and insight for any trip-total series: the headline, one cabin, one fare, or
 * a cabin + fare. The route page uses it when the user switches fare or cabin.
 */
export function analyzeSeries(args: { series: readonly PriceObservation[]; routeName: string; label: string; fareName?: string | null; provider: ProviderId; locale?: Locale; fareValue?: number | null; upgradeValue?: number | null }): SeriesAnalysis {
  const { series, routeName, label, fareName = null, provider, locale = 'en', fareValue = null, upgradeValue = null } = args;
  const forecast = forecastSeries(series, { cabin: null, provider, departure: null });
  const recommendation = recommend(series, forecast, locale, { fareValue, upgradeScore: upgradeValue });
  const savings = savingsMetrics(series);
  return {
    analytics: computeAnalytics(observationsToPoints(series)),
    forecast,
    recommendation,
    savings,
    insight: generateInsight({ routeName, category: label, series, recommendation, forecast, savings, fareName, locale }),
    dealScore: series.length === 0 ? 0 : dealScoreOf(series, { expected30dChangePct: expectedChange(forecast), confidence: forecast?.confidence ?? 0 }, { fareValue, upgradeValue }),
  };
}
