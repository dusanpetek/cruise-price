import type { CruiseSnapshot } from '@cruise/domain';
import type { PricePoint } from './prices';

export type DateRange = '30d' | '90d' | 'all';

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<Exclude<DateRange, 'all'>, number> = { '30d': 30, '90d': 90 };

/** Keeps snapshots within the range, measured back from the latest snapshot (not the wall clock). */
export function filterByRange<T extends { collectedAt: string }>(snapshots: readonly T[], range: DateRange): T[] {
  if (range === 'all' || snapshots.length === 0) return [...snapshots];
  const latest = Math.max(...snapshots.map((s) => Date.parse(s.collectedAt)));
  const from = latest - RANGE_DAYS[range] * DAY_MS;
  return snapshots.filter((s) => Date.parse(s.collectedAt) >= from);
}

/** Every cabin category seen across the snapshots, in first-seen order. */
export function cabinCategories(snapshots: readonly CruiseSnapshot[]): string[] {
  const seen = new Set<string>();
  for (const s of snapshots) for (const c of s.cabins) seen.add(c.category);
  return [...seen];
}

/**
 * Price series for analytics and charts, as cruise + flight (+ fees) per collection, so every component stays available
 * while analysis uses the trip total. Without a cabin it is the headline series (the cheapest trip); with one it is that
 * category only, skipping snapshots that lack it.
 */
export function toSeries(snapshots: readonly CruiseSnapshot[], cabin?: string | null): PricePoint[] {
  if (!cabin) return snapshots.map((s) => ({ collectedAt: s.collectedAt, packagePrice: s.packagePrice, flightSurcharge: s.flightSurcharge, mandatoryFees: s.pricing.mandatoryFees }));
  return snapshots.flatMap((s) => {
    const c = s.cabins.find((x) => x.category === cabin);
    return c ? [{ collectedAt: s.collectedAt, packagePrice: c.packageTotal, flightSurcharge: c.flightTotal, mandatoryFees: c.mandatoryFees }] : [];
  });
}

export interface CabinComparisonPoint {
  t: number;
  [category: string]: number;
}

/**
 * One row per snapshot with the TRIP total of every cabin category (for the comparison chart): at each cabin's cheapest fare,
 * or, with `fareCode`, at that fare (snapshots without that fare are skipped).
 */
export function cabinComparison(snapshots: readonly CruiseSnapshot[], fareCode: string | null = null): CabinComparisonPoint[] {
  return snapshots.flatMap((s): CabinComparisonPoint[] => {
    const entries = fareCode ? s.options.filter((o) => o.fareCode === fareCode).map((o) => [o.cabinCategory, o.totalPrice] as const) : s.cabins.map((c) => [c.category, c.tripTotal] as const);
    return entries.length ? [{ t: Date.parse(s.collectedAt), ...Object.fromEntries(entries) }] : [];
  });
}

export interface BandPoint {
  t: number;
  min: number;
  max: number;
}

/** Cheapest and most expensive cabin per snapshot (trip totals); falls back to the headline trip total if no cabins were stored. */
export function cabinBand(snapshots: readonly CruiseSnapshot[], fareCode: string | null = null): BandPoint[] {
  return snapshots.flatMap((s): BandPoint[] => {
    const totals = fareCode ? s.options.filter((o) => o.fareCode === fareCode).map((o) => o.totalPrice) : s.cabins.map((c) => c.tripTotal);
    if (fareCode && totals.length === 0) return [];
    const fallback = s.pricing.tripTotal;
    return [
      {
        t: Date.parse(s.collectedAt),
        min: totals.length ? Math.min(...totals) : fallback,
        max: totals.length ? Math.max(...totals) : fallback,
      },
    ];
  });
}
