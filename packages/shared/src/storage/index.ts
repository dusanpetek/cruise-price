import { createAlertRuleStore, createAlertStore } from './alertStore';
import { createCollectorLock } from './collectorLock';
import { createConfigStore } from './configStore';
import { createFailureStore } from './failureStore';
import { createIntelligenceStore } from './intelligenceStore';
import { createGeocodeStore } from './geocodeStore';
import { createItineraryStore } from './itineraryStore';
import { resolveDataDir } from './paths';
import { createReportStore } from './reportStore';
import { createRouteStore } from './routeStore';
import { createSearchCacheStore } from './searchCacheStore';
import { createRunStore } from './runStore';
import { createSnapshotStore } from './snapshotStore';
import { createWeeklyReportStore } from './weeklyReportStore';

export * from './alertStore';
export * from './collectorLock';
export * from './configStore';
export * from './errors';
export * from './failureStore';
export * from './geocodeStore';
export * from './intelligenceStore';
export * from './itineraryStore';
export * from './paths';
export * from './reportStore';
export * from './routeStore';
export * from './searchCacheStore';
export * from './runStore';
export * from './snapshotStore';
export * from './weeklyReportStore';
export { stableStringify, sha256 } from './stableJson';

/** All stores over one data directory. */
export function createStores(dataDir: string = resolveDataDir()) {
  return {
    dataDir,
    routes: createRouteStore(dataDir),
    itineraries: createItineraryStore(dataDir),
    snapshots: createSnapshotStore(dataDir),
    runs: createRunStore(dataDir),
    reports: createReportStore(dataDir),
    failures: createFailureStore(dataDir),
    lock: createCollectorLock(dataDir),
    alertRules: createAlertRuleStore(dataDir),
    alerts: createAlertStore(dataDir),
    weeklyReports: createWeeklyReportStore(dataDir),
    config: createConfigStore(dataDir),
    intelligence: createIntelligenceStore(dataDir),
    searchCache: createSearchCacheStore(dataDir),
    geocodes: createGeocodeStore(dataDir),
  };
}
export type Stores = ReturnType<typeof createStores>;
