import { createStores } from '@cruise/shared/storage';
import { DEFAULT_CRON, scheduleCollections, scheduleDealReports } from '../scheduler';

const stores = createStores();
const collect = process.env.COLLECT_CRON ?? DEFAULT_CRON;
scheduleCollections(stores, collect);
const reports = scheduleDealReports(stores);
console.log(`Collector scheduled (${collect}); reports: daily (${reports.daily}), weekly (${reports.weekly}), monthly (${reports.monthly}). Press Ctrl+C to stop.`);
