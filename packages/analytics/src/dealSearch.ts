import type { CabinGroup, ProviderId } from '@cruise/domain';
import type { OptionIntelligence } from './fares';

/** How the matching deals are ordered. */
export type RankingMode = 'cheapest' | 'bestValue' | 'bestForecast' | 'biggestDrop';
export const RANKING_MODES: readonly RankingMode[] = ['cheapest', 'bestValue', 'bestForecast', 'biggestDrop'];

export interface DealFilters {
  provider?: ProviderId | null;
  routeId?: string | null;
  ship?: string | null;
  /** A cabin category exactly as the provider names it. */
  cabinCategory?: string | null;
  /** Or one of the five cabin groups (e.g. every kind of balcony). */
  cabinGroup?: CabinGroup | null;
  fareCode?: string | null;
  /** Departure month as YYYY-MM. */
  departureMonth?: string | null;
  minNights?: number | null;
  maxNights?: number | null;
  /** Maximum trip total in euro (cruise + flight + fees, for the whole party). */
  maxBudget?: number | null;
  /** Only trip totals below the combination's own historical average. */
  belowAverage?: boolean;
  /** Matches the route name, ship or fare name (case-insensitive). */
  text?: string | null;
}

/** Whether the trip total is below the combination's historical average. */
export const isBelowAverage = (o: OptionIntelligence) => o.option.totalPrice < o.historicalAverage;

const matches = (o: OptionIntelligence, f: DealFilters): boolean => {
  if (f.provider && o.provider !== f.provider) return false;
  if (f.routeId && o.routeId !== f.routeId) return false;
  if (f.ship && o.ship !== f.ship) return false;
  if (f.cabinCategory && o.cabinCategory !== f.cabinCategory) return false;
  if (f.cabinGroup && o.cabinGroup !== f.cabinGroup) return false;
  if (f.fareCode && o.fare.fareCode !== f.fareCode) return false;
  if (f.departureMonth && o.departure?.slice(0, 7) !== f.departureMonth) return false;
  if (f.minNights != null && (o.durationNights === null || o.durationNights < f.minNights)) return false;
  if (f.maxNights != null && (o.durationNights === null || o.durationNights > f.maxNights)) return false;
  if (f.maxBudget != null && o.option.totalPrice > f.maxBudget) return false;
  if (f.belowAverage && !isBelowAverage(o)) return false;
  const text = f.text?.trim().toLowerCase();
  if (text && ![o.routeName, o.ship ?? '', o.fareName, o.cabinCategory].some((x) => x.toLowerCase().includes(text))) return false;
  return true;
};

const byTotal = (a: OptionIntelligence, b: OptionIntelligence) => a.option.totalPrice - b.option.totalPrice;
// null sorts last for forecast and drop rankings
const orderings: Record<RankingMode, (a: OptionIntelligence, b: OptionIntelligence) => number> = {
  cheapest: (a, b) => byTotal(a, b) || b.valueScore - a.valueScore,
  bestValue: (a, b) => b.valueScore - a.valueScore || b.dealScore - a.dealScore || byTotal(a, b),
  bestForecast: (a, b) => (b.expectedSavings ?? -Infinity) - (a.expectedSavings ?? -Infinity) || byTotal(a, b),
  biggestDrop: (a, b) => (a.recentChange?.amount ?? Infinity) - (b.recentChange?.amount ?? Infinity) || byTotal(a, b),
};

/**
 * The deals that match the filters, best first for the ranking mode:
 *  cheapest = lowest trip total; bestValue = highest fare value score; bestForecast = largest expected saving by waiting;
 *  biggestDrop = largest price fall over the last week. Every entry carries cruise, flight and total.
 */
export function searchDeals(options: readonly OptionIntelligence[], filters: DealFilters = {}, mode: RankingMode = 'bestValue', limit = Infinity): OptionIntelligence[] {
  return options.filter((o) => matches(o, filters)).sort(orderings[mode]).slice(0, limit);
}

export interface DealFilterChoices {
  providers: ProviderId[];
  routes: { id: string; name: string }[];
  ships: string[];
  cabinCategories: string[];
  fares: { code: string; name: string }[];
  months: string[];
  nights: number[];
}

/** What the filter menus offer: only values that exist in the data. */
export function dealFilterChoices(options: readonly OptionIntelligence[]): DealFilterChoices {
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  return {
    providers: uniq(options.map((o) => o.provider)).sort(),
    routes: [...new Map(options.map((o) => [o.routeId, o.routeName])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    ships: uniq(options.flatMap((o) => (o.ship ? [o.ship] : []))).sort(),
    cabinCategories: uniq(options.map((o) => o.cabinCategory)).sort(),
    fares: [...new Map(options.map((o) => [o.fare.fareCode, o.fareName])).entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
    months: uniq(options.flatMap((o) => (o.departure ? [o.departure.slice(0, 7)] : []))).sort(),
    nights: uniq(options.flatMap((o) => (o.durationNights !== null ? [o.durationNights] : []))).sort((a, b) => a - b),
  };
}
