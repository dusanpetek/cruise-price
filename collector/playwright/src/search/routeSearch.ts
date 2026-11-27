import type { ProviderId } from '@cruise/domain';
import { chromiumFactory, createPageSession, type BrowserFactory } from '../browser/browserFactory';
import { aidaResults, fetchAidaItems } from './aida';
import { refine } from './filters';
import { fetchMeinSchiffCards, meinSchiffWanted, parseMeinSchiffCard } from './meinSchiff';
import { MOCK_CATALOG } from './mock';
import type { RouteSearchCriteria, RouteSearchOutcome, RouteSearchResult } from './types';

export * from './types';
export { aidaResults, aidaStops, aidaJourneyUrl, type AidaItem } from './aida';
export { cleanMeinSchiffUrl, parseMeinSchiffCard } from './meinSchiff';
export { fold, matchesQuery, inRange, refine } from './filters';

/** How long what the website showed counts as current. The offer lists change a few times a day at most. */
export const SEARCH_CACHE_TTL_MS = 12 * 60 * 60_000;

/** The place the last answer is kept (the search cache store of the data directory). */
export interface SearchCache {
  read(key: string): Promise<unknown | null>;
  write(key: string, entry: unknown): Promise<void>;
  prune?(olderThanMs: number, now?: number): Promise<number>;
}

export interface RouteSearchDeps {
  browserFactory?: BrowserFactory;
  /** 'mock' answers from a fixed catalogue without a browser (COLLECTOR_MODE=mock). */
  mode?: 'live' | 'mock';
  /** Without a cache every search reads the website. */
  cache?: SearchCache;
  now?: () => Date;
  ttlMs?: number;
}

interface CacheEntry {
  fetchedAt: string;
  /** Everything the website showed, before the text and date filters and the limit. */
  results: RouteSearchResult[];
  capped: boolean;
  /** How many cards a Mein Schiff read was asked to load (AIDA always reads everything). */
  wanted: number;
}

/** AIDA lists all its offers in one go. Mein Schiff is read for the chosen period, so the period is part of the key. */
export const cacheKeyOf = (provider: ProviderId, criteria: RouteSearchCriteria) =>
  provider === 'aida' ? 'aida' : `mein-schiff_${criteria.from ?? 'any'}_${criteria.to ?? 'any'}`;

const wantedOf = (provider: ProviderId, criteria: RouteSearchCriteria) => (provider === 'aida' ? 0 : meinSchiffWanted(criteria));

const isEntry = (v: unknown): v is CacheEntry => {
  const e = v as Partial<CacheEntry> | null;
  return !!e && typeof e.fetchedAt === 'string' && !Number.isNaN(Date.parse(e.fetchedAt)) && Array.isArray(e.results) && typeof e.capped === 'boolean' && typeof e.wanted === 'number';
};

/** A current cache entry that is good enough for this search, or null. */
async function freshEntry(provider: ProviderId, criteria: RouteSearchCriteria, deps: RouteSearchDeps): Promise<CacheEntry | null> {
  if (!deps.cache || criteria.refresh || deps.mode === 'mock') return null;
  const entry = await deps.cache.read(cacheKeyOf(provider, criteria)).catch(() => null);
  if (!isEntry(entry)) return null;
  const age = (deps.now?.() ?? new Date()).getTime() - Date.parse(entry.fetchedAt);
  if (age < 0 || age > (deps.ttlMs ?? SEARCH_CACHE_TTL_MS)) return null;
  return entry.wanted >= wantedOf(provider, criteria) ? entry : null;
}

const outcomeOf = (provider: ProviderId, criteria: RouteSearchCriteria, all: RouteSearchResult[], capped: boolean, cachedAt: string | null): RouteSearchOutcome => {
  const { results, total } = refine(all, criteria);
  return { provider, results, total, capped, cachedAt };
};

/** The answer from the cache, or null when the website has to be read. Needs no browser. */
export async function cachedRouteSearch(provider: ProviderId, criteria: RouteSearchCriteria, deps: RouteSearchDeps = {}): Promise<RouteSearchOutcome | null> {
  const entry = await freshEntry(provider, criteria, deps);
  return entry ? outcomeOf(provider, criteria, entry.results, entry.capped, entry.fetchedAt) : null;
}

/**
 * Searches what a cruise line offers, so a route can be picked instead of typed. It reads the website like the collection does
 * (AIDA in a visible window, Mein Schiff headless), only the public offer list, and never logs in or books anything.
 * A recent answer is reused from the cache for 12 hours; `criteria.refresh` reads the website again.
 */
export async function searchRoutes(provider: ProviderId, criteria: RouteSearchCriteria, deps: RouteSearchDeps = {}): Promise<RouteSearchOutcome> {
  if (deps.mode === 'mock') {
    const { results, total } = refine(MOCK_CATALOG.filter((r) => r.provider === provider), criteria);
    return { provider, results, total, capped: false, cachedAt: null };
  }
  const hit = await cachedRouteSearch(provider, criteria, deps);
  if (hit) return hit;

  const session = createPageSession(deps.browserFactory ?? chromiumFactory, { headless: provider !== 'aida' });
  try {
    const page = await session.getPage();
    let all: RouteSearchResult[];
    let capped: boolean;
    if (provider === 'aida') {
      const { items, capped: c } = await fetchAidaItems(page);
      all = aidaResults(items);
      capped = c;
    } else {
      const { cards, capped: c } = await fetchMeinSchiffCards(page, criteria, meinSchiffWanted(criteria));
      all = cards.flatMap((card) => parseMeinSchiffCard(card) ?? []);
      capped = c;
    }
    if (deps.cache) {
      const now = deps.now?.() ?? new Date();
      const entry: CacheEntry = { fetchedAt: now.toISOString(), results: all, capped, wanted: wantedOf(provider, criteria) };
      // A cache that cannot be written must never fail a search that worked.
      await deps.cache.write(cacheKeyOf(provider, criteria), entry).catch(() => undefined);
      await deps.cache.prune?.(2 * (deps.ttlMs ?? SEARCH_CACHE_TTL_MS), now.getTime()).catch(() => undefined);
    }
    return outcomeOf(provider, criteria, all, capped, null);
  } finally {
    await session.close();
  }
}
