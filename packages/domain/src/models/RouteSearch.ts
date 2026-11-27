import type { ItineraryStop } from './Itinerary';
import type { ProviderId } from './Provider';

export interface RouteSearchCriteria {
  /** Read the website again even if a recent answer is cached. */
  refresh?: boolean;
  /** Words that must all occur in the title, ports or ship (case and umlauts do not matter). */
  query?: string | null;
  /** Departure between these two dates (YYYY-MM-DD), both inclusive. */
  from?: string | null;
  to?: string | null;
  /** At most this many results (the earliest departures first). */
  limit?: number;
}

/** A cruise the cruise line offers, ready to be tracked as a route. */
export interface RouteSearchResult {
  provider: ProviderId;
  /** The URL the collector can track; for AIDA the journey page with two adults. */
  url: string;
  title: string;
  ship: string | null;
  startDate: string | null;
  endDate: string | null;
  nights: number | null;
  /** The advertised price per person (cruise only unless the offer includes the flight); null when not shown. */
  pricePerPerson: number | null;
  flightIncluded: boolean;
  ports: string[];
  /** The stops with their times, when the provider's search gives them (AIDA). */
  itinerary?: ItineraryStop[];
  imageUrl: string | null;
}

export interface RouteSearchOutcome {
  provider: ProviderId;
  results: RouteSearchResult[];
  /** How many offers matched before the limit was applied. */
  total: number;
  /** Mein Schiff lists thousands of trips; only the first ones are read. True when that cap stopped the search. */
  capped: boolean;
  /** When the cruise line's website was read, if this answer comes from the cache; null when it was just read. */
  cachedAt: string | null;
}

export const DEFAULT_SEARCH_LIMIT = 40;
export const MAX_SEARCH_LIMIT = 100;
