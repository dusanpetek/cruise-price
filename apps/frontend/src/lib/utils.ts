import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { dateLocale, t } from './i18n';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const formatDate = (iso: string | number) =>
  new Date(iso).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' });

const DAY_MS = 86_400_000;

/** A calendar date (YYYY-MM-DD) with its weekday, e.g. "Sa 13.03.2027" / "Sat 13/03/2027" (no full stop or comma). Time zones never shift it. */
export function formatWeekdayDate(isoDate: string): string {
  const parts = new Intl.DateTimeFormat(dateLocale(), { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(`${isoDate.slice(0, 10)}T12:00:00Z`));
  const weekday = parts.find((p) => p.type === 'weekday')!.value.replace(/\./g, '');
  const date = parts.filter((p) => p.type !== 'weekday').map((p) => p.value).join('').replace(/^[\s,.]+/, '');
  return `${weekday} ${date}`;
}

/** The start and the end of a trip with weekdays: the end is the departure plus the nights. Null without a departure date. */
export function tripDates(departure: string | null, nights: number | null): { start: string; end: string | null } | null {
  if (!departure) return null;
  const end = nights ? new Date(Date.parse(`${departure.slice(0, 10)}T12:00:00Z`) + nights * DAY_MS).toISOString().slice(0, 10) : null;
  return { start: formatWeekdayDate(departure), end: end ? formatWeekdayDate(end) : null };
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(dateLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  return t('{n} d ago', { n: Math.floor(s / 86400) });
}

export const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;
export const pctText = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

/** Cruise line first (by its name), then the departure date (earliest first; routes without a date last), then the name. */
export function sortRoutes<T extends { name: string; provider: string }>(routes: readonly T[], departureOf: (route: T) => string | null | undefined, providerName: (provider: string) => string): T[] {
  return [...routes].sort((a, b) => {
    const byProvider = providerName(a.provider).localeCompare(providerName(b.provider));
    if (byProvider !== 0) return byProvider;
    const da = departureOf(a) ?? '';
    const db = departureOf(b) ?? '';
    if (da !== db) return da === '' ? 1 : db === '' ? -1 : da < db ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** What an itinerary row calls a stop: the port name, "Sea day", or "Unknown port" for a stop without a name. */
export function stopLabel(stop: { name: string | null; seaDay: boolean }): string {
  if (stop.seaDay) return t('Sea day');
  return stop.name ?? t('Unknown port');
}
