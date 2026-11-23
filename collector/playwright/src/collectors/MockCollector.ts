import { detectProviderId, PROVIDER_LABELS, type ProviderId } from '@cruise/domain';
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
}
