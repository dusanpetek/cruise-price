import type { ProviderId } from '@cruise/domain';
import { AidaCollector } from '../collectors/AidaCollector';
import { MeinSchiffCollector } from '../collectors/MeinSchiffCollector';
import { MockCollector } from '../collectors/MockCollector';
import type { CruiseProviderCollector } from './CruiseProviderCollector';

export class UnsupportedProviderError extends Error {
  constructor(url: string) {
    super(`No provider collector matches URL: ${url}`);
    this.name = 'UnsupportedProviderError';
  }
}

export class ProviderRegistry {
  constructor(private readonly collectors: readonly CruiseProviderCollector[]) {}

  list(): readonly CruiseProviderCollector[] {
    return this.collectors;
  }

  get(id: ProviderId): CruiseProviderCollector | undefined {
    return this.collectors.find((c) => c.id === id);
  }

  /** Picks the collector from the URL alone. */
  resolve(url: string): CruiseProviderCollector {
    const found = this.collectors.find((c) => c.matches(url));
    if (!found) throw new UnsupportedProviderError(url);
    return found;
  }
}

export type CollectorMode = 'live' | 'mock';

export function createProviderRegistry(mode: CollectorMode): ProviderRegistry {
  return new ProviderRegistry(
    mode === 'mock'
      ? [new MockCollector('aida'), new MockCollector('mein-schiff')]
      : [new AidaCollector(), new MeinSchiffCollector()],
  );
}

export const collectorModeFromEnv = (env: NodeJS.ProcessEnv = process.env): CollectorMode =>
  env.COLLECTOR_MODE === 'mock' ? 'mock' : 'live';

/** Real collectors by default; `COLLECTOR_MODE=mock` swaps in the mock ones. */
export const providerRegistry = createProviderRegistry(collectorModeFromEnv());
