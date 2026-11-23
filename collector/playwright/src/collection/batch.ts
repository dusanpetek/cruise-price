import { buildDailyReport, buildHistoricalDataset, dayOf } from '@cruise/analytics';
import type { CollectionRun, Route } from '@cruise/domain';
import type { Stores } from '@cruise/shared/storage';
import { newId } from '@cruise/shared';
import { createAlertPipeline, type AfterSnapshot } from '../alerts/pipeline';
import type { BrowserFactory } from '../browser/browserFactory';
import type { ProviderRegistry } from '../providers/providerRegistry';
import { runCollection, type CollectionOutcome } from '../runner/collectionRunner';
import { skipDecision, type SkipDecision } from './frequency';
import type { CollectionConfig } from './types';

export interface BatchDeps {
  stores: Pick<Stores, 'snapshots' | 'runs' | 'reports' | 'failures' | 'lock' | 'alerts' | 'alertRules' | 'config'> & Partial<Pick<Stores, 'intelligence'>>;
  registry?: ProviderRegistry;
  browserFactory?: BrowserFactory;
  config?: CollectionConfig;
  /** Runs after each stored snapshot (default: the alert pipeline). Pass null to turn it off. */
  afterSnapshot?: AfterSnapshot | null;
}

export interface BatchOptions {
  trigger: CollectionRun['trigger'];
  /** Pause between routes, to stay polite to the provider sites. */
  delayBetweenMs?: number;
  now?: () => Date;
  log?: (line: string) => void;
  /** A deliberate collection of one route: the weekly limit of far-away cruises is lifted, the daily limit is not. */
  force?: boolean;
}

export interface BatchOutcome {
  run: CollectionRun;
  outcomes: CollectionOutcome[];
  /** Routes left out because they were collected too recently: today, or within the last week for cruises that leave in more than six months. */
  skipped: Route[];
  /** Why, and from when each of them may be collected again. */
  skippedDetail: (SkipDecision & { route: Route })[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Collects the routes one after another under the collector lock (throws CollectorLockedError if another
 * run is active), records the run, and regenerates the daily report.
 */
export async function collectRoutes(routes: readonly Route[], deps: BatchDeps, options: BatchOptions): Promise<BatchOutcome> {
  const { stores, registry, browserFactory, config } = deps;
  const afterSnapshot = deps.afterSnapshot === undefined ? createAlertPipeline({ stores }) : deps.afterSnapshot;
  const { trigger, delayBetweenMs = 0, now = () => new Date(), log = () => undefined } = options;
  const release = await stores.lock.acquire(now());
  try {
    const startedAt = now();
    const outcomes: CollectionOutcome[] = [];
    const today = dayOf(startedAt.toISOString());
    // At most one price per route and day, and for cruises that leave in more than six months at most one per week
    // (see skipDecision). Failed attempts, manual and mock snapshots do not count.
    const skipped: Route[] = [];
    const skippedDetail: BatchOutcome['skippedDetail'] = [];
    const due: Route[] = [];
    for (const route of routes) {
      const decision = skipDecision(await stores.snapshots.listByRoute(route.id), today, { ignoreWeekly: options.force === true });
      if (decision) {
        skipped.push(route);
        skippedDetail.push({ route, ...decision });
        log(`skipping ${route.name}: ${decision.reason === 'weekly' ? `leaves in more than 6 months, collected weekly (next from ${decision.nextDay})` : 'already collected today'}`);
      } else due.push(route);
    }
    if (due.length === 0 && skipped.length > 0) {
      // Nothing to do: no run is recorded, so the history only shows real collections.
      return { run: { id: `${startedAt.toISOString().replace(/[:.]/g, '-')}_skipped`, trigger, startedAt: startedAt.toISOString(), finishedAt: now().toISOString(), results: [] }, outcomes, skipped, skippedDetail };
    }
    for (const [i, route] of due.entries()) {
      if (i > 0 && delayBetweenMs > 0) await sleep(delayBetweenMs);
      log(`collecting ${route.name}`);
      const outcome = await runCollection(route, {
        snapshots: stores.snapshots,
        failures: stores.failures,
        ...(registry ? { registry } : {}),
        ...(browserFactory ? { browserFactory } : {}),
        ...(config ? { config } : {}),
        now,
      });
      log(outcome.snapshot ? `  ok: ${outcome.snapshot.packagePrice} ${outcome.snapshot.currency} (+${outcome.snapshot.flightSurcharge} flight)` : `  FAILED: ${outcome.result.error}`);
      outcomes.push(outcome);
      if (outcome.snapshot && stores.intelligence) {
        try {
          await stores.intelligence.write(route.id, buildHistoricalDataset(route, await stores.snapshots.listByRoute(route.id), now().toISOString()));
        } catch (e) {
          console.error(`[collector] could not update the historical dataset of ${route.name}:`, (e as Error).message); // derived data: never fails the collection
        }
      }
      if (outcome.snapshot && afterSnapshot) {
        try {
          const alerts = await afterSnapshot(route, outcome.snapshot);
          if (alerts.length) log(`  ${alerts.length} alert(s) raised`);
        } catch (e) {
          console.error(`[collector] alert evaluation failed for ${route.name}:`, (e as Error).message); // never fails the collection
        }
      }
    }

    const run: CollectionRun = {
      id: `${startedAt.toISOString().replace(/[:.]/g, '-')}_${newId().slice(0, 8)}`,
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      results: outcomes.map((o) => o.result),
    };
    await stores.runs.append(run);
    try {
      const runs = await stores.runs.list(1000);
      await stores.reports.writeDaily(buildDailyReport(runs, dayOf(run.startedAt), now().toISOString()));
    } catch (e) {
      console.error('[collector] could not write daily report:', (e as Error).message);
    }
    return { run, outcomes, skipped, skippedDetail };
  } finally {
    await release();
  }
}
