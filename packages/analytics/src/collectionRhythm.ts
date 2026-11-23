/**
 * How often a route is collected depends on how far away its departure is. These are the calendar helpers behind that rule; the
 * collector applies it and the UI marks the routes it concerns.
 */

/** A cruise that leaves in more than this many months changes little, so it is collected less often. */
export const FAR_FUTURE_MONTHS = 6;
/** ...at most once in this many days. A cruise that leaves sooner is collected once a day. */
export const FAR_FUTURE_INTERVAL_DAYS = 7;
const DAY_MS = 86_400_000;

const utcDay = (day: string) => Date.parse(`${day}T00:00:00Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A calendar day plus whole months; a day that does not exist in the target month ends on its last day (31 Aug + 6 = 28/29 Feb). */
export function addMonths(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  const target = d.getUTCMonth() + months;
  const out = new Date(Date.UTC(d.getUTCFullYear(), target, 1));
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return isoDay(out.getTime());
}

export const addDays = (day: string, days: number) => isoDay(utcDay(day) + days * DAY_MS);

/** The departure is more than six months after today. Without a departure date nothing is known, so it is not "far". */
export const isFarFuture = (departure: string | null | undefined, today: string) => !!departure && departure.slice(0, 10) > addMonths(today, FAR_FUTURE_MONTHS);
