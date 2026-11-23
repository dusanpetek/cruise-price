import type { RouteSearchCriteria, RouteSearchResult } from './types';
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from './types';

/** Lower case without umlauts and accents, so "Kanaren", "kanaren" and "Käsebrot" style input all compare fairly. */
export const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Every word of the query occurs somewhere in the text. An empty query matches everything. */
export function matchesQuery(text: string, query: string | null | undefined): boolean {
  const words = fold(query ?? '').split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(text);
  return words.every((w) => haystack.includes(w));
}

export const inRange = (date: string | null, from: string | null | undefined, to: string | null | undefined): boolean => {
  if (!from && !to) return true;
  if (!date) return false;
  return (!from || date >= from) && (!to || date <= to);
};

export const searchText = (r: Pick<RouteSearchResult, 'title' | 'ship' | 'ports'>) => [r.title, r.ship ?? '', ...r.ports].join(' ');

export const clampLimit = (limit: number | undefined) => Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(limit ?? DEFAULT_SEARCH_LIMIT)));

/** Applies query, dates and the limit: earliest departure first, results without a date last. */
export function refine(results: readonly RouteSearchResult[], criteria: RouteSearchCriteria): { results: RouteSearchResult[]; total: number } {
  const matching = results
    .filter((r) => matchesQuery(searchText(r), criteria.query) && inRange(r.startDate, criteria.from, criteria.to))
    .sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') || a.title.localeCompare(b.title));
  return { results: matching.slice(0, clampLimit(criteria.limit)), total: matching.length };
}
