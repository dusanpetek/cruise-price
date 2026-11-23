import { useMemo } from 'react';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { summarizeRuns } from '@cruise/analytics';
import { PROVIDER_IDS, PROVIDER_LABELS, type CollectionResult, type ProviderId } from '@cruise/domain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { useCollectAll, useDailyReport, useRoutes, useRuns } from '@/hooks/queries';
import { failureUrl } from '@/lib/api';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { useUi } from '@/store/ui';
import { t } from '@/lib/i18n';

function Widget({ title, value, sub, tone, testId }: { title: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-semibold tabular-nums', tone)}>{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function FailureLinks({ id }: { id: string }) {
  return (
    <span className="inline-flex gap-2">
      {(['screenshots', 'html', 'logs'] as const).map((kind) => (
        <a key={kind} href={failureUrl(kind, id)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {kind === 'screenshots' ? 'screenshot' : kind === 'html' ? 'HTML' : 'log'}
        </a>
      ))}
    </span>
  );
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export default function CollectionDashboard() {
  const { provider, setProvider } = useUi();
  const { data: runs = [], isLoading } = useRuns();
  const { data: routes = [] } = useRoutes();
  const { data: report } = useDailyReport();
  const collectAll = useCollectAll();
  const summary = useMemo(() => summarizeRuns(runs, provider), [runs, provider]);

  const rate = summary.successRate;
  const visibleResults = (results: CollectionResult[]) => results.filter((r) => !provider || r.provider === provider);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('Collection')}</h1>
          <p className="text-sm text-muted-foreground">{t('Status of the price collections for all routes.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label={t('Provider filter')} className="w-44" value={provider ?? ''} onChange={(e) => setProvider((e.target.value || null) as ProviderId | null)}>
            <option value="">{t('All providers')}</option>
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </option>
            ))}
          </Select>
          <Button
            onClick={() => {
              if (window.confirm(t('Collect all routes now? AIDA collection opens a browser window for about a minute per route.'))) collectAll.mutate();
            }}
            disabled={collectAll.isPending || routes.length === 0}
          >
            <RefreshCw size={14} className={cn(collectAll.isPending && 'animate-spin')} /> {collectAll.isPending ? t('Collecting…') : t('Collect all')}
          </Button>
        </div>
      </div>
      {collectAll.error && (
        <p role="alert" className="text-sm text-destructive">
          {collectAll.error.message}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Widget
          testId="widget-last-collection"
          title={t('Last collection')}
          value={summary.lastRun ? timeAgo(summary.lastRun.finishedAt) : t('Never')}
          sub={summary.lastRun ? `${formatDateTime(summary.lastRun.finishedAt)} · ${t(summary.lastRun.trigger)}` : t('No collection has run yet')}
        />
        <Widget testId="widget-routes-processed" title={t('Routes processed')} value={summary.routesProcessed} sub={t('of {n} configured', { n: routes.length })} />
        <Widget
          testId="widget-success-rate"
          title={t('Success rate')}
          value={rate === null ? t('n/a') : `${Math.round(rate * 100)}%`}
          tone={rate === null ? '' : rate >= 0.9 ? 'text-good' : rate >= 0.5 ? '' : 'text-bad'}
          sub={t('last {n} runs', { n: runs.length })}
        />
        <Widget
          testId="widget-failed-routes"
          title={t('Failed routes')}
          value={summary.failedRoutes.length}
          tone={summary.failedRoutes.length ? 'text-bad' : 'text-good'}
          sub={summary.failedRoutes.length ? summary.failedRoutes.map((f) => f.routeName).join(', ') : t('All routes ok at last run')}
        />
        <Widget
          testId="widget-last-failure"
          title={t('Last failure')}
          value={summary.lastFailure ? timeAgo(summary.lastFailure.at) : t('None')}
          sub={
            summary.lastFailure ? (
              <span className="flex flex-col gap-0.5">
                <span className="truncate" title={summary.lastFailure.error ?? ''}>
                  {summary.lastFailure.routeName}: {summary.lastFailure.error}
                </span>
                {summary.lastFailure.failureId && <FailureLinks id={summary.lastFailure.failureId} />}
              </span>
            ) : (
              t('No failures recorded')
            )
          }
        />
      </div>

      {report && (
        <Card data-testid="daily-report">
          <CardHeader>
            <CardTitle>{t('Daily report · {date}', { date: report.date })}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <p className="mb-2 text-sm tabular-nums">
              {report.collections} collections · {report.successes} succeeded · {report.failures} failed · avg {seconds(report.averageDurationMs)}
            </p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">{t('Provider')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Collections')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Succeeded')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Failed')}</th>
                  <th className="py-1 font-medium">{t('Avg duration')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {Object.entries(report.providers).map(([id, p]) => (
                  <tr key={id} className="border-t border-border">
                    <td className="py-1.5 pr-3">{PROVIDER_LABELS[id as ProviderId] ?? id}</td>
                    <td className="py-1.5 pr-3">{p.collections}</td>
                    <td className="py-1.5 pr-3">{p.successes}</td>
                    <td className="py-1.5 pr-3">{p.failures}</td>
                    <td className="py-1.5">{seconds(p.averageDurationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('Recent runs')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">{t('Loading runs…')}</p>}
          {!isLoading && runs.length === 0 && <p className="text-sm text-muted-foreground">{t('No runs yet. Use “Collect all” or “Collect now” on a route.')}</p>}
          <ul className="flex flex-col divide-y divide-border">
            {runs.slice(0, 10).map((run) => (
              <li key={run.id} className="py-2 text-sm" data-testid="run-row">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="tabular-nums">{formatDateTime(run.startedAt)}</span>
                  <span className="text-muted-foreground">{t(run.trigger)}</span>
                  <span className="text-muted-foreground">{seconds(Date.parse(run.finishedAt) - Date.parse(run.startedAt))}</span>
                </div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {visibleResults(run.results).map((r) => (
                    <li key={r.routeId} className="flex flex-wrap items-center gap-2">
                      {r.status === 'success' ? <CheckCircle2 size={14} className="text-good" aria-label={t('succeeded')} /> : <XCircle size={14} className="text-destructive" aria-label={t('failed')} />}
                      <span>{r.routeName}</span>
                      <span className="text-muted-foreground">{seconds(r.durationMs)}</span>
                      {r.status === 'failed' && (
                        <>
                          <span className="text-destructive">{r.error}</span>
                          {r.failureId && <FailureLinks id={r.failureId} />}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
