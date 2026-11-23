import type { Stores } from '@cruise/shared/storage';
import { buildSnapshotInput } from './collection/snapshotBuilder';
import { mockCruise } from './collectors/mockPrice';
import { DEFAULT_COLLECTION_CONFIG } from './collection/types';

const DAY = 86_400_000;

const DEMO_ROUTES = [
  { name: 'Demo: Mediterranean (AIDA, mock data)', provider: 'aida', url: 'https://www.aida.de/kreuzfahrt/mittelmeer-highlights' },
  { name: 'Demo: Norwegian Fjords (Mein Schiff, mock data)', provider: 'mein-schiff', url: 'https://www.meinschiff.com/reisen/norwegen-fjorde' },
] as const;

/**
 * Creates demo routes with `days` days of mock history (source "mock"). Does nothing if any route exists.
 * The demo URLs are fake: collect them with COLLECTOR_MODE=mock, or delete them and add real routes.
 */
export async function seedDemoData(stores: Pick<Stores, 'routes' | 'snapshots'>, days = 90, now = new Date()) {
  if ((await stores.routes.list()).length > 0) return false;
  for (const input of DEMO_ROUTES) {
    const route = await stores.routes.create(input);
    for (let d = days; d >= 0; d--) {
      const at = new Date(now.getTime() - d * DAY);
      await stores.snapshots.create(
        buildSnapshotInput({
          routeId: route.id,
          provider: route.provider,
          source: 'mock',
          collectedAt: at.toISOString(),
          collected: mockCruise(route.provider, route.url, at, DEFAULT_COLLECTION_CONFIG),
        }),
      );
    }
  }
  return true;
}
