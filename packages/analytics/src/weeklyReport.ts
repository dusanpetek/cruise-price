import type { CruiseSnapshot } from '@cruise/domain';
import type { Locale } from '@cruise/i18n';
import { groupSeries } from './alerts';
import { analyzeOptions, dealFinder, optionSeries, type OptionIntelligence } from './fares';
import type { Portfolio, ProviderScorecard } from './intelligence';
import type { UpgradeOpportunity, UpgradeVerdict } from './upgrades';
import { isBuyAction, type RecommendationAction } from './recommendation';

const DAY_MS = 86_400_000;

/** The deal reports: what happened over the last day, week or month. */
export type ReportKind = 'daily' | 'weekly' | 'monthly';
export const REPORT_KINDS: readonly ReportKind[] = ['daily', 'weekly', 'monthly'];
export const REPORT_DAYS: Record<ReportKind, number> = { daily: 1, weekly: 7, monthly: 30 };
export const isReportKind = (v: unknown): v is ReportKind => v === 'daily' || v === 'weekly' || v === 'monthly';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface WeeklyRouteRow {
  route: string;
  provider: string;
  /** Current trip total, with its parts. All price columns of a route row are trip totals. */
  current: number | null;
  currentCruise: number | null;
  currentFlight: number | null;
  historicalLow: number | null;
  historicalHigh: number | null;
  potentialSavings: number | null;
  weekChangePct: number | null;
  expected30dChangePct: number | null;
  recommendation: RecommendationAction;
  confidence: number;
  dealScore: number;
  reason: string;
}

export interface ReportUpgrade {
  route: string;
  fare: string | null;
  from: string;
  to: string;
  cruiseTotal: number;
  flightTotal: number;
  costDifference: number;
  pctDifference: number;
  upgradeScore: number;
  verdict: UpgradeVerdict;
}

export interface ReportForecast {
  route: string;
  current: number;
  forecast30Day: number | null;
  expected30dChangePct: number | null;
  confidence: number | null;
  recommendation: RecommendationAction;
}

export interface WeeklyDeal {
  route: string;
  provider: string;
  cabin: string;
  fare: string;
  cruisePrice: number;
  flightPrice: number;
  totalPrice: number;
  dealScore: number;
  fareScore: number;
  /** Change of this option's total over the period; null if it had no earlier price. */
  weekChangePct: number | null;
}

export interface WeeklyDeals {
  bestDeal: WeeklyDeal | null;
  bestBalcony: WeeklyDeal | null;
  bestSuite: WeeklyDeal | null;
  biggestDrop: WeeklyDeal | null;
  /** The fare with the best value for its price (price and included services). */
  bestFare: WeeklyDeal | null;
}

export interface WeeklyReport {
  /** Which period the report covers; the fields named "week" hold the change over that period. */
  kind: ReportKind;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  routes: WeeklyRouteRow[];
  bestOpportunities: WeeklyRouteRow[];
  /** Largest price falls over the period, most negative first (only routes that fell). */
  biggestDrops: WeeklyRouteRow[];
  providerComparison: ProviderScorecard[];
  forecastAccuracy: { overall: number | null; byProvider: Record<string, number | null> };
  /** Fare-level executive summary. All null for routes without fare data. */
  deals: WeeklyDeals;
  /** The upgrades most worth taking, best first. */
  bestUpgrades: ReportUpgrade[];
  /** The 30-day outlook of every route. */
  forecastSummary: ReportForecast[];
}

/** Executive summary of a portfolio. `snapshots` maps route id to its history (used for the week-on-week change). */
export function buildWeeklyReport(portfolio: Portfolio, snapshots: ReadonlyMap<string, readonly CruiseSnapshot[]>, now: Date, locale: Locale = 'en', kind: ReportKind = 'weekly'): WeeklyReport {
  const periodStart = new Date(now.getTime() - REPORT_DAYS[kind] * DAY_MS);

  const routes = portfolio.routes.map((r): WeeklyRouteRow => {
    const series = groupSeries(snapshots.get(r.routeId) ?? [], null);
    const current = series.at(-1);
    const before = series.findLast((p) => Date.parse(p.collectedAt) <= periodStart.getTime());
    return {
      route: r.routeName,
      provider: r.provider,
      current: r.savings?.current ?? null,
      currentCruise: r.analytics?.currentCruise ?? null,
      currentFlight: r.analytics?.currentFlightSurcharge ?? null,
      historicalLow: r.savings?.historicalLow ?? null,
      historicalHigh: r.savings?.historicalHigh ?? null,
      potentialSavings: r.savings?.potentialSavings ?? null,
      weekChangePct: current && before && before.price > 0 ? round2(((current.price - before.price) / before.price) * 100) : null,
      expected30dChangePct: r.expected30dChangePct,
      recommendation: r.recommendation.action,
      confidence: r.recommendation.confidence,
      dealScore: r.dealScore,
      reason: r.recommendation.reason,
    };
  });

  const options = portfolio.routes.flatMap((r) => analyzeOptions({ id: r.routeId, name: r.routeName, provider: r.provider }, snapshots.get(r.routeId) ?? [], locale));
  const toDeal = (o: OptionIntelligence): WeeklyDeal => {
    const series = optionSeries(snapshots.get(o.routeId) ?? [], o.cabinCategory, o.fare.fareCode);
    const before = series.findLast((p) => Date.parse(p.collectedAt) <= periodStart.getTime());
    return {
      route: o.routeName,
      provider: o.provider,
      cabin: o.cabinCategory,
      fare: o.fareName,
      cruisePrice: o.option.cruisePrice,
      flightPrice: o.option.flightPrice,
      totalPrice: o.option.totalPrice,
      dealScore: o.dealScore,
      fareScore: o.fareScore,
      weekChangePct: before && before.price > 0 ? round2(((o.option.totalPrice - before.price) / before.price) * 100) : null,
    };
  };
  const finder = dealFinder(options, 1);
  const drops = options.map(toDeal).filter((d) => d.weekChangePct !== null && d.weekChangePct < 0).sort((a, b) => a.weekChangePct! - b.weekChangePct!);
  const first = (o: OptionIntelligence[]) => (o[0] ? toDeal(o[0]) : null);
  const deals: WeeklyDeals = { bestDeal: first(finder.topDeals), bestBalcony: first(finder.bestBalcony), bestSuite: first(finder.bestSuite), biggestDrop: drops[0] ?? null, bestFare: first(finder.bestValue) };

  const accuracies = portfolio.routes.flatMap((r) => (r.backtest.directionalAccuracy === null ? [] : [r.backtest.directionalAccuracy]));
  const upgradeRow = (u: UpgradeOpportunity): ReportUpgrade => ({ route: u.routeName, fare: u.fareName, from: u.from.cabinCategory, to: u.to.cabinCategory, cruiseTotal: u.to.cruise, flightTotal: u.to.flight, costDifference: u.costDifference, pctDifference: u.pctDifference, upgradeScore: u.upgradeScore, verdict: u.verdict });
  return {
    kind,
    generatedAt: now.toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    routes,
    bestOpportunities: routes.filter((r) => isBuyAction(r.recommendation)).sort((a, b) => b.confidence - a.confidence).slice(0, 5),
    biggestDrops: routes
      .filter((r) => r.weekChangePct !== null && r.weekChangePct < 0)
      .sort((a, b) => a.weekChangePct! - b.weekChangePct!)
      .slice(0, 5),
    providerComparison: portfolio.providers,
    forecastAccuracy: {
      overall: accuracies.length ? round2(accuracies.reduce((a, b) => a + b, 0) / accuracies.length) : null,
      byProvider: Object.fromEntries(portfolio.providers.map((p) => [p.provider, p.forecastAccuracy])),
    },
    deals,
    bestUpgrades: portfolio.upgrades.filter((u) => u.verdict !== 'NOT_WORTH').slice(0, 5).map(upgradeRow),
    forecastSummary: portfolio.routes.map((r) => ({ route: r.routeName, current: r.savings?.current ?? 0, forecast30Day: r.forecast?.forecast30Day ?? null, expected30dChangePct: r.expected30dChangePct, confidence: r.forecast?.confidence ?? null, recommendation: r.recommendation.action })).filter((r) => r.current > 0),
  };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV_COLUMNS: (keyof WeeklyRouteRow)[] = [
  'route', 'provider', 'current', 'currentCruise', 'currentFlight', 'historicalLow', 'historicalHigh', 'potentialSavings',
  'weekChangePct', 'expected30dChangePct', 'recommendation', 'confidence', 'dealScore', 'reason',
];

/** One row per route. */
export function weeklyReportCsv(report: WeeklyReport): string {
  return [CSV_COLUMNS.join(','), ...report.routes.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

const DEAL_COLUMNS: (keyof WeeklyDeal)[] = ['route', 'provider', 'cabin', 'fare', 'cruisePrice', 'flightPrice', 'totalPrice', 'dealScore', 'fareScore', 'weekChangePct'];

/** The executive deal summary: one row per headline (best deal, best balcony, ...). */
export function weeklyDealsCsv(report: WeeklyReport): string {
  const rows: [string, WeeklyDeal | null][] = [
    ['Best deal', report.deals.bestDeal],
    ['Best balcony', report.deals.bestBalcony],
    ['Best suite', report.deals.bestSuite],
    ['Biggest drop', report.deals.biggestDrop],
    ['Best fare', report.deals.bestFare],
  ];
  const lines = rows.flatMap(([label, d]) => (d ? [[label, ...DEAL_COLUMNS.map((c) => cell(d[c]))].map((x, i) => (i === 0 ? cell(x) : x)).join(',')] : []));
  return ['headline,' + DEAL_COLUMNS.join(','), ...lines].join('\n') + '\n';
}
