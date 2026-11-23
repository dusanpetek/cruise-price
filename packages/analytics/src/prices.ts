import type { CruiseSnapshot } from '@cruise/domain';

export type PriceTrend = 'up' | 'down' | 'flat';

/**
 * One collection of one price series. `packagePrice` is the cruise total and `flightSurcharge` the flight total, both for the
 * whole party; everything is analysed on the TRIP total (cruise + flight + mandatory fees).
 */
export type PricePoint = Pick<CruiseSnapshot, 'collectedAt' | 'packagePrice' | 'flightSurcharge'> & { mandatoryFees?: number };

/** The price every statistic, ranking, forecast, alert and score is based on. */
export const tripOf = (p: Pick<PricePoint, 'packagePrice' | 'flightSurcharge' | 'mandatoryFees'>): number => p.packagePrice + p.flightSurcharge + (p.mandatoryFees ?? 0);

/** All prices below are TRIP totals (cruise + flight + mandatory fees) for the whole party. */
export interface PriceAnalytics {
  count: number;
  /** Current trip total. */
  current: number;
  previous: number | null;
  /** Lowest trip total ever seen. */
  min: number;
  /** Highest trip total ever seen. */
  max: number;
  average: number;
  /** current - min (>= 0). Also the "savings potential" if the price falls back to its low. */
  diffToMin: number;
  /** current - max (<= 0). */
  diffToMax: number;
  /** (current - min) / min * 100 */
  pctToMin: number;
  /** (current - max) / max * 100 */
  pctToMax: number;
  trend: PriceTrend;
  /** current - previous; 0 when there is only one snapshot. */
  change: number;
  /** The parts of the current trip total. */
  currentCruise: number;
  currentFlightSurcharge: number;
  currentMandatoryFees: number;
  /** Same as `current`: the trip total. */
  currentTotal: number;
  /** Most recent snapshot that had the lowest / highest price. */
  minAt: string;
  maxAt: string;
  /** Whole days between the most recent lowest-price snapshot and the latest snapshot (0 = current is the low). */
  daysSinceLowest: number;
  changeSinceFirst: number;
  changeSinceFirstPct: number;
  /** Change versus the last snapshot at least 30 days older than the latest; null if history is shorter. */
  change30d: number | null;
  change30dPct: number | null;
}

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (diff: number, base: number) => (base === 0 ? 0 : round2((diff / base) * 100));
const time = (p: PricePoint) => Date.parse(p.collectedAt);
type Trip = PricePoint & { trip: number };

/** Returns null when there are no snapshots. Input order does not matter. */
export function computeAnalytics(snapshots: readonly PricePoint[]): PriceAnalytics | null {
  if (snapshots.length === 0) return null;
  const sorted: Trip[] = [...snapshots].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).map((p) => ({ ...p, trip: tripOf(p) }));
  const prices = sorted.map((s) => s.trip);
  const first = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;
  const current = latest.trip;
  const previous = sorted.length > 1 ? sorted[sorted.length - 2]!.trip : null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const change = previous === null ? 0 : round2(current - previous);
  const lastAt = (price: number) => sorted.findLast((s) => s.trip === price)!.collectedAt;
  const minAt = lastAt(min);
  const baseline = sorted.findLast((s) => time(s) <= time(latest) - 30 * DAY_MS);

  return {
    count: sorted.length,
    current,
    previous,
    min,
    max,
    average: round2(prices.reduce((a, b) => a + b, 0) / prices.length),
    diffToMin: round2(current - min),
    diffToMax: round2(current - max),
    pctToMin: pct(current - min, min),
    pctToMax: pct(current - max, max),
    trend: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    change,
    currentCruise: latest.packagePrice,
    currentFlightSurcharge: latest.flightSurcharge,
    currentMandatoryFees: latest.mandatoryFees ?? 0,
    currentTotal: current,
    minAt,
    maxAt: lastAt(max),
    daysSinceLowest: Math.floor((time(latest) - Date.parse(minAt)) / DAY_MS),
    changeSinceFirst: round2(current - first.trip),
    changeSinceFirstPct: pct(current - first.trip, first.trip),
    change30d: baseline ? round2(current - baseline.trip) : null,
    change30dPct: baseline ? pct(current - baseline.trip, baseline.trip) : null,
  };
}
