import { collectorModeFromEnv, scheduleCollections, scheduleDealReports, DEFAULT_CRON } from '@cruise/collector';
import { createStores } from '@cruise/shared/storage';
import { createApiServer } from './app';
import { authFromEnv } from './auth';

const stores = createStores();
const port = Number(process.env.API_PORT ?? 8787);

const auth = authFromEnv(); // throws on a half-configured sign-in: better no server than an open one
if (!auth) console.warn('WARNING: sign-in is off (AUTH_PASSWORD_HASH is not set); anyone who reaches this API can use it.');

createApiServer({ stores, auth }).listen(port, () =>
  console.log(`API on http://localhost:${port} (data: ${stores.dataDir}, collectors: ${collectorModeFromEnv()}, sign-in: ${auth ? `on${auth.totpSecret ? ' + authenticator code' : ''}` : 'OFF'})`),
);

// Opt-in: AIDA collection opens a visible browser window, so the scheduler does not run unless asked for.
if (process.env.ENABLE_SCHEDULER === '1') {
  const expression = process.env.COLLECT_CRON ?? DEFAULT_CRON;
  scheduleCollections(stores, expression);
  const reports = scheduleDealReports(stores);
  console.log(`Scheduler on (collections ${expression}, reports daily ${reports.daily}, weekly ${reports.weekly}, monthly ${reports.monthly})`);
}
