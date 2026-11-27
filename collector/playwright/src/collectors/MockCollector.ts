import { detectProviderId, PROVIDER_LABELS, type ItineraryStop, type ProviderId } from '@cruise/domain';
import type { CollectedCruise, CollectionContext, CruiseProviderCollector } from '../collection/types';
import { mockCruise } from './mockPrice';

/** Stand-in for a provider: deterministic fake prices, no browser. Used for demos and tests (COLLECTOR_MODE=mock). */
export class MockCollector implements CruiseProviderCollector {
  readonly label: string;
  readonly source = 'mock' as const;
  readonly headless = true;

  constructor(readonly id: ProviderId) {
    this.label = `${PROVIDER_LABELS[id]} (mock)`;
  }

  matches(url: string): boolean {
    return detectProviderId(url) === this.id;
  }

  async collect(ctx: CollectionContext): Promise<CollectedCruise> {
    return ctx.diagnostics.step(`${this.id}:mock-price`, async () => mockCruise(this.id, ctx.url, ctx.now, ctx.config));
  }

  /** Always the same short trip between two drawable ports, so mock mode and the e2e tests can draw a map. */
  async readItinerary(): Promise<ItineraryStop[]> {
    return [
      { code: 'ESLPA', name: 'Las Palmas', seaDay: false, arrival: null, departure: '2027-01-10T18:00:00', lat: null, lng: null },
      { code: 'SEE', name: null, seaDay: true, arrival: null, departure: null, lat: null, lng: null },
      { code: 'ESSPC', name: 'Santa Cruz de La Palma', seaDay: false, arrival: '2027-01-12T08:00:00', departure: '2027-01-12T17:00:00', lat: null, lng: null },
    ];
  }
}
