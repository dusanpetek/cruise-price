import type { Page } from 'playwright';
import type { RouteSearchResult } from './types';

const BASE = 'https://aida.de';
const API = `${BASE}/content/aida-search-and-booking/requests/search.cruise.json`;
const PAGE_SIZE = 200;
const MAX_PAGES = 6;
/** AIDA's page can be slow (cookie banner, tracking scripts): generous limits, and one more try before giving up. */
export const AIDA_TIMEOUTS = { navigationMs: 180_000, settleMs: 20_000, requestMs: 120_000, attempts: 2 } as const;

/** The parts of AIDA's own search response that are used. */
export interface AidaItem {
  title?: string;
  routeGroupCode?: string;
  duration?: number;
  ports?: { name: string | null }[];
  cruiseItemVariant?: {
    fromCity?: string;
    toCity?: string;
    startDate?: string;
    endDate?: string;
    duration?: number;
    amountPerPerson?: number | null;
    journeyIdentifier?: string;
    flightIncluded?: boolean;
    imageUrl?: string | null;
    ship?: { name?: string; marketingName?: string };
  }[];
}

/** The journey page of one sailing for two adults, the URL form the collector tracks. */
export const aidaJourneyUrl = (journey: string) => `${BASE}/finden/${journey}/CLASSIC?pax[adults]=2&pax[juveniles]=0&pax[children]=0&pax[babies]=0`;

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/(-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());

/**
 * AIDA groups the sailings of one route into one item: its variants are the same route on other dates and ships. Every variant
 * becomes one result. Duplicate journeys are dropped.
 */
export function aidaResults(items: readonly AidaItem[]): RouteSearchResult[] {
  const seen = new Set<string>();
  const out: RouteSearchResult[] = [];
  for (const item of items) {
    const ports = [...new Set((item.ports ?? []).map((p) => p.name).filter((n): n is string => !!n).map(titleCase))];
    for (const v of item.cruiseItemVariant ?? []) {
      if (!v.journeyIdentifier || seen.has(v.journeyIdentifier)) continue;
      seen.add(v.journeyIdentifier);
      out.push({
        provider: 'aida',
        url: aidaJourneyUrl(v.journeyIdentifier),
        title: item.title ?? item.routeGroupCode ?? v.journeyIdentifier,
        ship: v.ship?.marketingName ?? v.ship?.name ?? null,
        startDate: v.startDate ?? null,
        endDate: v.endDate ?? null,
        nights: v.duration ?? item.duration ?? null,
        pricePerPerson: typeof v.amountPerPerson === 'number' ? v.amountPerPerson : null,
        flightIncluded: !!v.flightIncluded,
        ports,
        imageUrl: v.imageUrl ?? null,
      });
    }
  }
  return out;
}

/**
 * Asks AIDA's own search (the one the website uses) for every offer, from inside the page so that the session is the browser's.
 * The page needs a headed browser, like the collection does.
 */
export async function fetchAidaItems(page: Page): Promise<{ items: AidaItem[]; capped: boolean }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= AIDA_TIMEOUTS.attempts; attempt++) {
    try {
      return await fetchAidaItemsOnce(page);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function fetchAidaItemsOnce(page: Page): Promise<{ items: AidaItem[]; capped: boolean }> {
  await page.goto(`${BASE}/finden`, { waitUntil: 'domcontentloaded', timeout: AIDA_TIMEOUTS.navigationMs });
  await page.waitForLoadState('networkidle', { timeout: AIDA_TIMEOUTS.settleMs }).catch(() => undefined);
  return page.evaluate(
    async ({ api, size, maxPages, requestMs }) => {
      const items: unknown[] = [];
      let totalPages = 1;
      for (let p = 1; p <= Math.min(totalPages, maxPages); p++) {
        const res = await fetch(`${api}/size=${size}/p=${p}/sortCriteria=DepartureDate/sortDirection=Asc.json`, { signal: AbortSignal.timeout(requestMs) });
        if (!res.ok) throw new Error(`AIDA search answered ${res.status}`);
        const json = (await res.json()) as { success?: boolean; totalPages?: number; cruiseItems?: unknown[] };
        if (json.success === false) throw new Error('AIDA search failed');
        totalPages = json.totalPages ?? 1;
        items.push(...(json.cruiseItems ?? []));
      }
      return { items, capped: totalPages > maxPages };
    },
    { api: API, size: PAGE_SIZE, maxPages: MAX_PAGES, requestMs: AIDA_TIMEOUTS.requestMs },
  ) as Promise<{ items: AidaItem[]; capped: boolean }>;
}
