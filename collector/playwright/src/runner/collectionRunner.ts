import { RouteSchema, type CollectionResult, type CruiseSnapshot, type Route } from '@cruise/domain';
import type { FailureStore, ItineraryStore, SnapshotStore } from '@cruise/shared/storage';
import { createPageSession, type BrowserFactory } from '../browser/browserFactory';
import { buildSnapshotInput } from '../collection/snapshotBuilder';
import { DEFAULT_COLLECTION_CONFIG, type CollectionConfig } from '../collection/types';
import { providerRegistry, type ProviderRegistry } from '../providers/providerRegistry';
import { Diagnostics, type CollectionDiagnostics } from './diagnostics';

export interface CollectionRunnerDeps {
  snapshots: SnapshotStore;
  /** Where failure screenshots / HTML / logs go. Without it failures are still reported, just without files. */
  failures?: FailureStore;
  /** Where the route's itinerary is kept; without it (or a collector that cannot read one) no itinerary is read. */
  itineraries?: ItineraryStore;
  registry?: ProviderRegistry;
  browserFactory?: BrowserFactory;
  config?: CollectionConfig;
  now?: () => Date;
}

export interface CollectionOutcome {
  snapshot: CruiseSnapshot | null;
  diagnostics: CollectionDiagnostics;
  /** The same outcome as a row for the run record. */
  result: CollectionResult;
}

/** Collects one route and stores the snapshot. Never throws; failures land in diagnostics with evidence files. */
export async function runCollection(route: Route, deps: CollectionRunnerDeps): Promise<CollectionOutcome> {
  const { snapshots, itineraries, failures, registry = providerRegistry, browserFactory, config = DEFAULT_COLLECTION_CONFIG, now = () => new Date() } = deps;
  const startedAt = now();
  const t0 = performance.now();
  const diagnostics = new Diagnostics();
  let session: ReturnType<typeof createPageSession> | undefined;
  let provider: string | null = null;
  let providerId: Route['provider'] | null = null;

  const finish = (snapshot: CruiseSnapshot | null, error?: Error, failure?: CollectionDiagnostics['failure']): CollectionOutcome => {
    const durationMs = performance.now() - t0;
    return {
      snapshot,
      diagnostics: {
        routeId: route.id,
        provider,
        url: route.url,
        startedAt: startedAt.toISOString(),
        durationMs,
        status: error ? 'failed' : 'success',
        ...(error ? { error: error.message } : {}),
        steps: diagnostics.steps,
        ...(failure ? { failure } : {}),
      },
      result: {
        routeId: route.id,
        routeName: route.name,
        provider: providerId,
        status: error ? 'failed' : 'success',
        durationMs,
        snapshotId: snapshot?.id ?? null,
        error: error?.message ?? null,
        failureId: failure?.id ?? null,
      },
    };
  };

  try {
    RouteSchema.parse(route);
    const collector = await diagnostics.step('resolve-provider', async () => registry.resolve(route.url));
    provider = providerId = collector.id;
    session = createPageSession(browserFactory, { headless: collector.headless });
    const collected = await diagnostics.step('collect', () =>
      collector.collect({ url: route.url, routeId: route.id, config, diagnostics, getPage: session!.getPage, now: startedAt }),
    );
    const snapshot = await diagnostics.step('store-snapshot', () =>
      snapshots.create(
        buildSnapshotInput({
          routeId: route.id,
          provider: collector.id,
          source: collector.source,
          collectedAt: startedAt.toISOString(),
          collected,
        }),
      ),
    );
    if (collector.readItinerary && itineraries) {
      // Only after the snapshot is stored: whatever happens here (the step stays recorded as failed) must not fail the price run.
      try {
        await diagnostics.step('read-itinerary', async () => {
          const stops = await collector.readItinerary!({ url: route.url, routeId: route.id, config, diagnostics, getPage: session!.getPage, now: startedAt });
          if (stops) await itineraries.put({ routeId: route.id, provider: collector.id, readAt: startedAt.toISOString(), stops });
        });
      } catch {
        // see above
      }
    }
    return finish(snapshot);
  } catch (e) {
    const error = e as Error;
    return finish(null, error, await captureFailure({ route, startedAt, durationMs: performance.now() - t0, error, diagnostics, session, provider, failures }));
  } finally {
    await session?.close();
  }
}

/** Saves what was on screen (PNG + HTML) and a log with the error and every step's timing. */
async function captureFailure(args: {
  route: Route;
  startedAt: Date;
  durationMs: number;
  error: Error;
  diagnostics: Diagnostics;
  session: ReturnType<typeof createPageSession> | undefined;
  provider: string | null;
  failures: FailureStore | undefined;
}): Promise<CollectionDiagnostics['failure'] | undefined> {
  const { route, startedAt, durationMs, error, diagnostics, session, provider, failures } = args;
  if (!failures) return undefined;
  try {
    const page = session?.peekPage();
    const open = page && !page.isClosed();
    const [screenshot, html, title] = open
      ? await Promise.all([
          page.screenshot({ fullPage: true }).catch(() => undefined),
          page.content().catch(() => undefined),
          page.title().catch(() => null),
        ])
      : [undefined, undefined, null];
    const id = `${startedAt.toISOString().replace(/[:.]/g, '-')}_${route.id}`;
    const saved = await failures.save({
      id,
      ...(screenshot ? { screenshot } : {}),
      ...(html !== undefined ? { html } : {}),
      log: {
        routeId: route.id,
        routeName: route.name,
        url: route.url,
        provider,
        startedAt: startedAt.toISOString(),
        durationMs,
        error: { message: error.message, stack: error.stack },
        page: open ? { url: page.url(), title } : null,
        steps: diagnostics.steps,
      },
    });
    return { id, screenshot: saved.files.screenshots, html: saved.files.html, log: saved.files.logs! };
  } catch (e) {
    console.error('[collector] could not save failure diagnostics:', (e as Error).message);
    return undefined;
  }
}
