import { FAR_FUTURE_INTERVAL_DAYS, addDays, dayOf, isFarFuture } from '@cruise/analytics';
import type { CruiseSnapshot } from '@cruise/domain';

// The calendar helpers live in @cruise/analytics (the UI marks the same routes); they are re-exported for the collector's tests.
export { FAR_FUTURE_INTERVAL_DAYS, FAR_FUTURE_MONTHS, addDays, addMonths, isFarFuture } from '@cruise/analytics';

export interface SkipDecision {
  /** 'daily': a price was already stored today. 'weekly': the cruise leaves in more than six months and was collected within the last week. */
  reason: 'daily' | 'weekly';
  /** The day of the last real price, and the first day the route may be collected again. */
  lastDay: string;
  nextDay: string;
}

/**
 * Whether a route is too soon to collect again. Only real (live) prices count: failed attempts, manual and mock snapshots do not.
 * Departure within six months (or unknown): once per day. Departure in more than six months: once per week.
 * `ignoreWeekly` (a deliberate single collection) lifts the weekly limit only; the daily limit always stays.
 */
export function skipDecision(snapshots: readonly CruiseSnapshot[], today: string, options: { ignoreWeekly?: boolean } = {}): SkipDecision | null {
  const live = snapshots.filter((s) => s.source === 'live');
  if (live.length === 0) return null;
  const lastDay = live.map((s) => dayOf(s.collectedAt)).reduce((a, b) => (b > a ? b : a));
  // The departure of the newest snapshot that has one.
  const departure = snapshots.filter((s) => s.cruise.departure).reduce<CruiseSnapshot | null>((a, b) => (!a || b.collectedAt > a.collectedAt ? b : a), null)?.cruise.departure ?? null;
  const far = isFarFuture(departure, today) && !options.ignoreWeekly;
  const interval = far ? FAR_FUTURE_INTERVAL_DAYS : 1;
  const nextDay = addDays(lastDay, interval);
  return today < nextDay ? { reason: far ? 'weekly' : 'daily', lastDay, nextDay } : null;
}
