import type { CollectionResult, CollectionRun, DailyReport, ProviderStats } from '@cruise/domain';

const round = (n: number) => Math.round(n);

function stats(results: readonly CollectionResult[]): ProviderStats {
  const successes = results.filter((r) => r.status === 'success').length;
  return {
    collections: results.length,
    successes,
    failures: results.length - successes,
    averageDurationMs: results.length ? round(results.reduce((a, r) => a + r.durationMs, 0) / results.length) : 0,
  };
}

/** UTC calendar day of an ISO timestamp, e.g. "2026-11-17". */
export const dayOf = (iso: string) => iso.slice(0, 10);

/** Aggregates every run that started on `date` (UTC). */
export function buildDailyReport(runs: readonly CollectionRun[], date: string, generatedAt: string): DailyReport {
  const dayRuns = runs.filter((r) => dayOf(r.startedAt) === date);
  const results = dayRuns.flatMap((r) => r.results);
  const total = stats(results);
  const byProvider = new Map<string, CollectionResult[]>();
  for (const r of results) byProvider.set(r.provider ?? 'unknown', [...(byProvider.get(r.provider ?? 'unknown') ?? []), r]);

  return {
    date,
    generatedAt,
    runs: dayRuns.length,
    collections: total.collections,
    successes: total.successes,
    failures: total.failures,
    successRate: total.collections ? total.successes / total.collections : 1,
    averageDurationMs: total.averageDurationMs,
    providers: Object.fromEntries([...byProvider].map(([p, rs]) => [p, stats(rs)])),
  };
}

export interface RunSummary {
  lastRun: CollectionRun | null;
  routesProcessed: number;
  /** 0..1 across all supplied results; null when there are none. */
  successRate: number | null;
  /** Routes whose most recent collection failed. */
  failedRoutes: { routeId: string; routeName: string; error: string | null; at: string }[];
  lastFailure: { routeName: string; error: string | null; at: string; failureId: string | null } | null;
}

/** Powers the collection dashboard widgets. `runs` may be in any order. */
export function summarizeRuns(runs: readonly CollectionRun[], provider?: string | null): RunSummary {
  const keep = (r: CollectionResult) => !provider || r.provider === provider;
  const sorted = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const lastRun = sorted[0] ?? null;
  const flat = sorted.flatMap((run) => run.results.filter(keep).map((result) => ({ run, result })));

  const latestPerRoute = new Map<string, (typeof flat)[number]>();
  for (const entry of flat) if (!latestPerRoute.has(entry.result.routeId)) latestPerRoute.set(entry.result.routeId, entry);
  const failures = flat.filter((e) => e.result.status === 'failed');

  return {
    lastRun,
    routesProcessed: lastRun ? lastRun.results.filter(keep).length : 0,
    successRate: flat.length ? flat.filter((e) => e.result.status === 'success').length / flat.length : null,
    failedRoutes: [...latestPerRoute.values()]
      .filter((e) => e.result.status === 'failed')
      .map((e) => ({ routeId: e.result.routeId, routeName: e.result.routeName, error: e.result.error, at: e.run.finishedAt })),
    lastFailure: failures[0]
      ? {
          routeName: failures[0].result.routeName,
          error: failures[0].result.error,
          at: failures[0].run.finishedAt,
          failureId: failures[0].result.failureId,
        }
      : null,
  };
}
