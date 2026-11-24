import { ArrowDown, ArrowRight, ArrowUp, FileText, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RankedRoute } from '@cruise/analytics';
import { PROVIDER_LABELS } from '@cruise/domain';
import { formatMoney } from '@cruise/shared';
import { PriceCells, PriceHeaders, PriceTriple } from '@/components/PriceTriple';
import { RecommendationBadge } from '@/components/RecommendationBadge';
import { VerdictBadge } from '@/components/VerdictBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDealReports, useGenerateDealReport, useIntelligence } from '@/hooks/queries';
import { dealReportUrl } from '@/lib/api';
import { cn, pctText } from '@/lib/utils';
import { t } from '@/lib/i18n';

function Widget({ title, testId, hint, children }: { title: string; testId: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card data-testid={testId} className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent className="overflow-x-auto">{children}</CardContent>
    </Card>
  );
}

const KIND_LABELS = { daily: 'Daily report', weekly: 'Weekly report', monthly: 'Monthly report' } as const;

const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-2 text-sm text-muted-foreground">{children}</p>;
const RouteLink = ({ r }: { r: RankedRoute }) => (
  <span className="block">
    <Link to={`/routes/${r.routeId}`} className="font-medium text-primary hover:underline">
      {r.routeName}
    </Link>
    {r.focus && (
      <span className="ml-1.5 inline-block text-xs text-muted-foreground" data-testid="route-focus" title={t('Numbers for the favorite fare and cabin of this route')}>
        ★ {[r.focus.fareName ?? r.focus.fareCode, r.focus.cabin].filter(Boolean).join(' · ')}
      </span>
    )}
  </span>
);
const money = (r: RankedRoute, v: number) => formatMoney(v, r.currency);

export default function Overview() {
  const { data, isLoading, error } = useIntelligence();
  const reports = useDealReports();
  const generate = useGenerateDealReport();

  if (isLoading) return <p className="text-muted-foreground">{t('Analysing price history…')}</p>;
  if (error || !data) return <p role="alert" className="text-destructive">Could not load the analysis: {error?.message}</p>;
  if (data.routes.length === 0) return <p className="text-muted-foreground">{t('Add a route to start tracking prices. Recommendations appear once enough history has been collected.')}</p>;

  const forecasts = data.routes
    .filter((r) => r.expected30dChangePct !== null)
    .sort((a, b) => Math.abs(b.expected30dChangePct!) - Math.abs(a.expected30dChangePct!));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('Booking intelligence')}</h1>
        <p className="text-sm text-muted-foreground">{t('Should you book now or wait? Based on the collected price history; updates after every collection.')}</p>
      </div>

      <Widget title={t('Fare highlights')} testId="widget-fares" hint={t('Across every route, cabin and fare: always cruise + flight = total')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {([['Cheapest fare', data.fareHighlights.cheapest], ['Most expensive fare', data.fareHighlights.mostExpensive], ['Best value fare', data.fareHighlights.bestValue]] as const).map(([title, o]) => (
            <div key={title} data-testid={`highlight-${title.split(' ')[0]!.toLowerCase()}`}>
              <h3 className="text-xs font-semibold text-muted-foreground">{t(title)}</h3>
              {o ? (
                <>
                  <div className="text-sm font-medium">{o.fareName} · {o.cabinCategory}</div>
                  <div className="text-xs text-muted-foreground">{o.routeName}</div>
                  <PriceTriple size="md" cruise={o.option.cruisePrice} flight={o.option.flightPrice} />
                </>
              ) : (
                <Empty>{t('No fare data yet.')}</Empty>
              )}
            </div>
          ))}
          <div data-testid="highlight-largest">
            <h3 className="text-xs font-semibold text-muted-foreground">{t('Largest saving')}</h3>
            {data.fareHighlights.largestSaving ? (
              <>
                <div className="text-xl font-semibold tabular-nums text-good">{formatMoney(data.fareHighlights.largestSaving.saving.amount)} <span className="text-sm font-normal">({data.fareHighlights.largestSaving.saving.pct.toFixed(1)}%)</span></div>
                <div className="text-xs text-muted-foreground">{data.fareHighlights.largestSaving.routeName} · {data.fareHighlights.largestSaving.cabinCategory}: {data.fareHighlights.largestSaving.fromFare} → {data.fareHighlights.largestSaving.toFare}</div>
                <PriceTriple size="sm" cruise={data.fareHighlights.largestSaving.saving.to.cruisePrice} flight={data.fareHighlights.largestSaving.saving.to.flightPrice} />
              </>
            ) : (
              <Empty>{t('No cabin with two fares yet.')}</Empty>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs"><Link to="/deals" className="text-primary hover:underline">{t('Open the deal finder →')}</Link></p>
      </Widget>

      <div className="grid gap-4">
        <Widget title={t('Best booking opportunities')} testId="widget-opportunities" hint={t('Routes recommended for booking now, most confident first')}>
          {data.bestOpportunities.length === 0 ? (
            <Empty>{t('No route is currently close enough to its historical low to recommend booking.')}</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">{t('Route')}</th>
                  <PriceHeaders />
                  <th className="py-1 pr-3 font-medium">{t('Lowest trip total')}</th>
                  <th className="py-1 font-medium">{t('Recommendation')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.bestOpportunities.map((r) => (
                  <tr key={r.routeId} className="border-t border-border">
                    <td className="py-1.5 pr-3"><RouteLink r={r} /></td>
                    <PriceCells cruise={r.analytics!.currentCruise} flight={r.analytics!.currentFlightSurcharge} currency={r.currency} />
                    <td className="py-1.5 pr-3 tabular-nums">{money(r, r.savings!.historicalLow)}</td>
                    <td className="py-1.5"><RecommendationBadge action={r.recommendation.action} confidence={r.recommendation.confidence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Widget>

        <Widget title={t('Highest savings potential')} testId="widget-savings" hint={t('Trip total now minus the lowest trip total ever')}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">{t('Route')}</th>
                <PriceHeaders />
                <th className="py-1 pr-3 font-medium">{t('Lowest trip total')}</th>
                <th className="py-1 font-medium">{t('Potential savings')}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.highestSavings.slice(0, 5).map((r) => (
                <tr key={r.routeId} className="border-t border-border">
                  <td className="py-1.5 pr-3"><RouteLink r={r} /></td>
                  <PriceCells cruise={r.analytics!.currentCruise} flight={r.analytics!.currentFlightSurcharge} currency={r.currency} />
                  <td className="py-1.5 pr-3 tabular-nums">{money(r, r.savings!.historicalLow)}</td>
                  <td className="py-1.5 font-medium">{money(r, r.savings!.potentialSavings)} <span className="font-normal text-muted-foreground">({r.savings!.potentialSavingsPct.toFixed(1)}%)</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.highestSavings.length === 0 && <Empty>{t('No price data yet.')}</Empty>}
        </Widget>

        <Widget title={t('Forecast summary')} testId="widget-forecast" hint={t('Expected movement of the cheapest-cabin price over the next 30 days (linear trend)')}>
          {forecasts.length === 0 ? (
            <Empty>{t('Forecasts need at least 5 price snapshots per route.')}</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {forecasts.map((r) => {
                const pct = r.expected30dChangePct!;
                const Icon = pct > 0.5 ? ArrowUp : pct < -0.5 ? ArrowDown : ArrowRight;
                return (
                  <li key={r.routeId} className="flex items-center justify-between gap-3 py-1.5">
                    <RouteLink r={r} />
                    <span className={cn('inline-flex items-center gap-1 tabular-nums', pct > 0.5 ? 'text-bad' : pct < -0.5 ? 'text-good' : '')}>
                      <Icon size={14} aria-hidden /> {pctText(pct)}
                      <span className="text-xs text-muted-foreground">{t('confidence {pct}%', { pct: Math.round((r.forecast?.confidence ?? 0) * 100) })}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Widget>

        <Widget title={t('Top opportunities')} testId="widget-ranking" hint={t('Routes ranked by deal score 0-100: mean of historical position, forecast opportunity, price trend, fare value and upgrade value, on the trip total')}>
          <ol className="flex flex-col divide-y divide-border text-sm">
            {data.rankings.deals.map((r, i) => (
              <li key={r.routeId} className="flex items-center gap-3 py-1.5" data-testid="opportunity-row">
                <span className="w-5 text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <RouteLink r={r} />
                  {r.ship && <span className="block text-xs text-muted-foreground">{r.ship}</span>}
                </span>
                <RecommendationBadge action={r.recommendation.action} />
                <span className="text-right" aria-label={t('Deal score {n}', { n: r.dealScore })}>
                  <span className="text-xs text-muted-foreground">{t('Score')} </span>
                  <b className="tabular-nums">{r.dealScore}</b>
                </span>
              </li>
            ))}
          </ol>
          {data.rankings.deals.length === 0 && <Empty>{t('No ranked routes yet.')}</Empty>}
        </Widget>

        <Widget title={t('Best upgrade opportunity')} testId="widget-upgrade" hint={t('Is the better cabin worth the extra money? Trip totals, compared with what the upgrade has usually cost')}>
          {data.bestUpgrade ? (
            <div className="flex flex-col gap-1 text-sm" data-testid="best-upgrade">
              <div>
                <Link to={`/routes/${data.bestUpgrade.routeId}/fares`} className="font-medium text-primary hover:underline">{data.bestUpgrade.routeName}</Link>
                <span className="text-muted-foreground"> · {data.bestUpgrade.fareName ?? t('cheapest fare')}</span>
              </div>
              <div className="font-medium">{data.bestUpgrade.from.cabinCategory} → {data.bestUpgrade.to.cabinCategory}</div>
              <div className="tabular-nums">
                <b className="text-lg">{data.bestUpgrade.costDifference >= 0 ? '+' : ''}{formatMoney(data.bestUpgrade.costDifference)}</b>
                <span className="text-muted-foreground"> ({data.bestUpgrade.pctDifference.toFixed(1)}%)</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <VerdictBadge verdict={data.bestUpgrade.verdict} />
                <span className="tabular-nums text-muted-foreground">{t('Upgrade score {n}/100', { n: data.bestUpgrade.upgradeScore })}</span>
              </div>
            </div>
          ) : (
            <Empty>{t('No upgrade to compare yet: a route needs two cabin groups.')}</Empty>
          )}
        </Widget>

        <Widget title={t('Volatility and stability')} testId="widget-volatility" hint={t('How much each route\'s price moves around')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {([['Most volatile', data.rankings.volatile], ['Most stable', data.rankings.stable]] as const).map(([title, list]) => (
              <div key={title}>
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground">{t(title)}</h3>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {list.slice(0, 5).map((r) => (
                    <li key={r.routeId} className="flex justify-between gap-2 py-1">
                      <span className="truncate"><RouteLink r={r} /></span>
                      <span className="tabular-nums text-muted-foreground">±{r.savings!.volatilityPct.toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Widget>

        <Widget title={t('Provider scorecard')} testId="widget-providers" hint={t('Indicative: compares the routes you track, not the whole market')}>
          {data.providers.length === 0 ? (
            <Empty>{t('No provider data yet.')}</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">{t('Provider')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Avg trip total')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Avg discount')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Stability')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Forecast accuracy')}</th>
                  <th className="py-1 font-medium">{t('Score')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.providers.map((p) => (
                  <tr key={p.provider} className="border-t border-border">
                    <td className="py-1.5 pr-3 font-medium">{PROVIDER_LABELS[p.provider]}</td>
                    <td className="py-1.5 pr-3">{formatMoney(p.averagePrice)}</td>
                    <td className="py-1.5 pr-3">{p.averageDiscountPct.toFixed(1)}%</td>
                    <td className="py-1.5 pr-3">{p.stabilityScore}</td>
                    <td className="py-1.5 pr-3">{p.forecastAccuracy === null ? <span className="text-muted-foreground">{t('not yet measurable')}</span> : `${Math.round(p.forecastAccuracy * 100)}%`}</td>
                    <td className="py-1.5 font-semibold">{p.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Widget>
      </div>

      <Widget title={t('Deal reports')} testId="widget-reports" hint={t('Best deals, top price drops, best fares, best upgrades, forecast summary and recommendations, as JSON, CSV and PDF')}>
        <div className="flex flex-wrap items-center gap-3">
          {(['daily', 'weekly', 'monthly'] as const).map((kind) => (
            <Button key={kind} size="sm" variant={kind === 'weekly' ? 'default' : 'outline'} data-testid={`generate-${kind}`} onClick={() => generate.mutate(kind)} disabled={generate.isPending}>
              <RefreshCw size={14} className={cn(generate.isPending && generate.variables === kind && 'animate-spin')} /> {t(KIND_LABELS[kind])}
            </Button>
          ))}
          {generate.isPending && <span role="status" className="text-sm text-muted-foreground">{t('Generating…')}</span>}
          {generate.data?.pdfError && <span role="status" className="text-sm text-muted-foreground">{t('PDF skipped: {error}', { error: generate.data.pdfError })}</span>}
          {generate.error && <span role="alert" className="text-sm text-destructive">{generate.error.message}</span>}
        </div>
        {reports.data && reports.data.length === 0 && <Empty>{t('No report yet. They are also generated by the scheduler: daily, every Monday and on the 1st of the month.')}</Empty>}
        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
          {reports.data?.map((file) => (
            <li key={file}>
              <a href={dealReportUrl(file)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-primary hover:bg-muted">
                <FileText size={12} /> {file}
              </a>
            </li>
          ))}
        </ul>
      </Widget>
    </div>
  );
}
