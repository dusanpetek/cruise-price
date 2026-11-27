import type { Page } from 'playwright';
import type { CruiseInfo, FareOption, ItineraryStop, Party, ProviderId } from '@cruise/domain';
import type { Diagnostics } from '../runner/diagnostics';

/** Business configuration for every collection: who travels and from where. */
export interface CollectionConfig {
  adults: number;
  airport: string;
}
export const DEFAULT_COLLECTION_CONFIG: CollectionConfig = { adults: 2, airport: 'FRA' };

export interface CollectionContext {
  url: string;
  routeId: string;
  config: CollectionConfig;
  diagnostics: Diagnostics;
  /** Launches the browser on first call. Mock collectors never call it, so no browser is started. */
  getPage: () => Promise<Page>;
  /** Clock for the run; collectors must use this instead of `new Date()`. */
  now: Date;
}

export interface CollectedCabin {
  category: string;
  packagePerPerson: number;
  flightPerPerson: number;
}

/** A bookable cabin + fare, priced for the whole party, flight not included. */
export interface CollectedOption {
  cabinCategory: string;
  fareCode: string;
  cruisePrice: number;
}

/** What a provider adapter returns; the SnapshotBuilder turns it into a stored snapshot. */
export interface CollectedCruise {
  currency: string;
  cruise: CruiseInfo;
  party: Party;
  cabins: CollectedCabin[];
  /** Every fare found, and each cabin x fare price. Without them the snapshot has cabins only ("fare unknown"). */
  fares?: FareOption[];
  options?: CollectedOption[];
  /** Things that could not be collected; stored on the snapshot so gaps are visible. */
  warnings?: string[];
}

export interface CruiseProviderCollector {
  readonly id: ProviderId;
  readonly label: string;
  /** Whether snapshots come from a mock or a real page; copied onto the stored snapshot. */
  readonly source: 'mock' | 'live';
  /** AIDA refuses headless browsers, so it needs a visible window. */
  readonly headless: boolean;
  matches(url: string): boolean;
  collect(ctx: CollectionContext): Promise<CollectedCruise>;
  /** The route's stops, read after a successful collection (the page is still open). null when the provider does not show them. */
  readItinerary?(ctx: CollectionContext): Promise<ItineraryStop[] | null>;
}
