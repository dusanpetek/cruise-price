import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUp, LineChart as LineChartIcon, ListTree, Map as MapIcon, Plane, RefreshCw, Tags } from 'lucide-react';
import {
  analyzeSeries,
  cabinBand,
  cabinCategories,
  cabinComparison,
  cabinGroupBreakdown,
  computeAnalytics,
  filterByRange,
  observationsToPoints,
  selectionSeries,
  tripOf,
  type PriceTrend,
} from '@cruise/analytics';
import { PROVIDER_LABELS } from '@cruise/domain';
import { formatMoney } from '@cruise/shared';
import { CabinComparison, ChartCard, ComponentTimeline, MinMaxBand, PackageTimeline } from '@/components/charts/charts';
import { ChartFilters } from '@/components/charts/ChartFilters';
import { CabinGroupTable } from '@/components/CabinGroupTable';
import { RouteMapDialog } from '@/components/RouteMapDialog';
import { TimingCard } from '@/components/TimingCard';
import { ApiError } from '@/lib/api';
import { ProviderLogo } from '@/components/ProviderLogo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { PriceCells, PriceHeaders, PriceTriple } from '@/components/PriceTriple';
import { RecommendationBadge } from '@/components/RecommendationBadge';
import { useItinerary, useRouteIntelligence, useRouteMutations, useRoutes, useSnapshotMutations, useSnapshots } from '@/hooks/queries';
import { cn, formatDate, pctText, signed } from '@/lib/utils';
import { useUi } from '@/store/ui';
import { t } from '@/lib/i18n';

function Kpi({ title, value, sub, tone, testId }: { title: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; testId?: string }) {
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

const TREND: Record<PriceTrend, { icon: typeof ArrowUp; label: string; tone: string }> = {
  up: { icon: ArrowUp, label: 'Rising', tone: 'text-bad' },
  down: { icon: ArrowDown, label: 'Falling', tone: 'text-good' },
  flat: { icon: ArrowRight, label: 'Stable', tone: '' },
};

export default function RouteDetail() {
  const { id } = useParams();
  const { data: routes } = useRoutes();
  const route = routes?.find((r) => r.id === id) ?? null;
  const { data: snapshots = [], isLoading } = useSnapshots(id);
  const { data: itinerary } = useItinerary(id);
  const [mapOpen, setMapOpen] = useState(false);
  const { chartRange, chartCabin, chartFare, language, setChartFare, setChartCabin } = useUi();
  const { favorite: saveFavorite } = useRouteMutations();
  const [showCruise, setShowCruise] = useState(false);
  const [showFlight, setShowFlight] = useState(false);
  const { data: intel } = useRouteIntelligence(id);

  // The route opens with its favorite fare and cabin (when it has one); the selection can still be changed freely.
  const favorite = route?.favorite ?? null;
  const favoriteKey = `${route?.id ?? ''}|${favorite?.fareCode ?? ''}|${favorite?.cabin ?? ''}`;
  useEffect(() => {
    setChartFare(favorite?.fareCode ?? null);
    setChartCabin(favorite?.cabin ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoriteKey]);

  const latest = snapshots.at(-1);
  const fareList = useMemo(() => (latest?.fares ?? []).map((f) => ({ code: f.fareCode, name: f.fareName })), [latest]);
  // A fare or cabin that this route does not (or no longer) offer falls back to the cheapest.
  const fareCode = chartFare && fareList.some((f) => f.code === chartFare) ? chartFare : null;
  const fareName = fareList.find((f) => f.code === fareCode)?.name ?? null;
  const allCabins = useMemo(() => cabinCategories(snapshots), [snapshots]);
  const cabins = useMemo(() => (fareCode && latest ? [...new Set(latest.options.filter((o) => o.fareCode === fareCode).map((o) => o.cabinCategory))] : allCabins), [fareCode, latest, allCabins]);
  const cabin = chartCabin && cabins.includes(chartCabin) ? chartCabin : null;

  // Everything on this page follows the selected fare and cabin, always on the trip total.
  const selected = useMemo(() => selectionSeries(snapshots, { cabin, fareCode }), [snapshots, cabin, fareCode]);
  const view = useMemo(
    () => analyzeSeries({ series: selected, routeName: route?.name ?? '', label: cabin ?? 'Cheapest cabin', fareName, provider: route?.provider ?? 'aida', locale: language }),
    [selected, route, cabin, fareName, language],
  );
  const analytics = view.analytics;
  const filteredSnapshots = useMemo(() => filterByRange(snapshots, chartRange), [snapshots, chartRange]);
  const series = useMemo(() => observationsToPoints(filterByRange(selected, chartRange)), [selected, chartRange]);
  const chartStats = useMemo(() => computeAnalytics(series), [series]);

  if (!routes) return <p className="text-muted-foreground">{t('Loading…')}</p>;
  if (!route) return <p className="text-muted-foreground">{t('Route not found. Pick one from the list.')}</p>;

  const currency = latest?.currency ?? 'EUR';
  const money = (v: number) => formatMoney(v, currency);
  const trend = analytics && TREND[analytics.trend];
  const selectionLabel = [fareName ?? t('all fares (cheapest)'), cabin ?? t('cheapest cabin')].join(' · ');
  const favoriteLabel = [fareList.find((f) => f.code === favorite?.fareCode)?.name ?? favorite?.fareCode ?? t('all fares (cheapest)'), favorite?.cabin ?? t('cheapest cabin')].join(' · ');
  const suffix = [fareName, cabin].filter(Boolean).join(' · ');
  const titled = (title: string) => (suffix ? `${title} · ${suffix}` : title);
  const fareCabinRows = fareCode && latest ? latest.options.filter((o) => o.fareCode === fareCode) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{route.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <a href={route.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              <ProviderLogo provider={route.provider} size={20} className="mr-1.5 inline-block align-middle" />
              {PROVIDER_LABELS[route.provider]} ↗
            </a>
            <Link to={`/routes/${route.id}/snapshots`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <ListTree size={14} /> {t('Snapshot explorer')}
            </Link>
            <Link to={`/routes/${route.id}/fares`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Tags size={14} /> {t('Fares')}
            </Link>
            <Link to={`/routes/${route.id}/forecast`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <LineChartIcon size={14} /> {t('Forecast and charts')}
            </Link>
            {itinerary && itinerary.stops.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => setMapOpen(true)}>
                <MapIcon size={14} /> {t('Route and times')}
              </Button>
            )}
            {itinerary === null && <span className="text-xs text-muted-foreground">{t('Itinerary not collected yet')}</span>}
          </div>
          {latest?.cruise.ship && (
            <p className="mt-1 text-sm text-muted-foreground">
              {latest.cruise.ship}
              {latest.cruise.departure && ` · ${t('departs {date}', { date: formatDate(latest.cruise.departure) })}`}
              {latest.cruise.durationNights && ` · ${t('{n} nights', { n: latest.cruise.durationNights })}`}
              {latest.party.departureAirport && ` · ${t('{adults} adults, flights from {airport}', { adults: latest.party.adults, airport: latest.party.departureAirport })}`}
            </p>
          )}
        </div>
        <CollectControls routeId={route.id} />
      </div>

      {latest && (
        <section aria-label={t('View')} className="flex flex-col gap-1">
          <ChartFilters cabins={cabins} fares={fareList} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span data-testid="view-label">{t('Showing: {what}', { what: selectionLabel })}</span>
            {favorite && (
              <span data-testid="favorite-label" className="font-medium text-foreground">
                ★ {t('Favorite: {what}', { what: favoriteLabel })}
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              data-testid="favorite-set"
              disabled={saveFavorite.isPending || (!fareCode && !cabin) || (favorite?.fareCode === fareCode && favorite?.cabin === cabin)}
              onClick={() => saveFavorite.mutate({ id: route.id, favorite: { fareCode, cabin } })}
            >
              ☆ {t('Set as favorite')}
            </Button>
            {favorite && (
              <Button size="sm" variant="ghost" data-testid="favorite-clear" disabled={saveFavorite.isPending} onClick={() => saveFavorite.mutate({ id: route.id, favorite: { fareCode: null, cabin: null } })}>
                {t('Remove favorite')}
              </Button>
            )}
          </div>
        </section>
      )}

      {isLoading && <p className="text-muted-foreground">{t('Loading history…')}</p>}
      {!isLoading && snapshots.length === 0 && <p className="text-muted-foreground">{t('No snapshots yet. Collect one to get started.')}</p>}
      {!isLoading && snapshots.length > 0 && !analytics && (
        <p className="text-muted-foreground" data-testid="no-selection-data">
          {t('No data for this selection: the fare was not offered in this cabin.')}
        </p>
      )}

      {analytics && (
        <Card data-testid="intelligence-card">
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <RecommendationBadge action={view.recommendation.action} confidence={view.recommendation.confidence} />
              <span className="text-sm">{view.recommendation.reason}</span>
            </div>
            <details className="text-sm" data-testid="explanation-details" open>
              <summary className="cursor-pointer text-xs font-semibold uppercase text-muted-foreground">{t('Why this recommendation')}</summary>
              <ul className="mt-1 list-disc pl-5" data-testid="explanation">
                {view.recommendation.explanation.slice(1).map((line) => <li key={line}>{line}</li>)}
              </ul>
            </details>
            <p className="whitespace-pre-line text-sm text-muted-foreground" data-testid="insight">{view.insight}</p>
            {view.forecast && (
              <p className="text-sm tabular-nums" data-testid="forecast-line">
                <span className="font-medium">{t('Forecast:')} </span>
                {t('7 days {a} · 30 days {b} · 60 days {c}', { a: money(view.forecast.forecast7Day), b: money(view.forecast.forecast30Day), c: money(view.forecast.forecast60Day) })}
                <span className="text-muted-foreground"> {t('(confidence {pct}%)', { pct: Math.round(view.forecast.confidence * 100) })}</span>
              </p>
            )}
            {view.savings && (
              <p className="text-sm tabular-nums" data-testid="savings-line">
                <span className="font-medium">{t('Savings analytics:')} </span>
                {t('potential {amount}', { amount: money(view.savings.potentialSavings) })}
                {view.savings.largestDrop && ` · ${t('largest drop {amount} ({pct}%)', { amount: money(view.savings.largestDrop.amount), pct: view.savings.largestDrop.pct })}`}
                {` · ${t('volatility ±{pct}% · stability {score}/100', { pct: view.savings.volatilityPct.toFixed(1), score: view.savings.stabilityScore })}`}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {intel && intel.snapshotCount > 0 && <TimingCard intel={intel} />}

      {analytics && trend && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi
              testId="kpi-current"
              title={t('Current trip total')}
              value={money(analytics.current)}
              sub={
                <span className="inline-flex items-center gap-1">
                  <Plane size={12} /> {t('Cruise {cruise} + Flight {flight}', { cruise: money(analytics.currentCruise), flight: money(analytics.currentFlightSurcharge) })}
                  {analytics.currentMandatoryFees > 0 && ` + ${t('fees')} ${money(analytics.currentMandatoryFees)}`}
                </span>
              }
            />
            <Kpi testId="kpi-lowest" title={t('Lowest trip total')} value={money(analytics.min)} tone="text-good" sub={t('Now {pct} vs low', { pct: pctText(analytics.pctToMin) })} />
            <Kpi testId="kpi-highest" title={t('Highest trip total')} value={money(analytics.max)} tone="text-bad" sub={t('Now {pct} vs high', { pct: pctText(analytics.pctToMax) })} />
            <Kpi testId="kpi-savings" title={t('Potential savings')} value={money(analytics.diffToMin)} sub={analytics.diffToMin === 0 ? t('At the lowest trip total') : t('Trip total now minus the lowest trip total')} />
            <Kpi
              testId="kpi-trend"
              title={t('Trend')}
              tone={trend.tone}
              value={
                <span className="inline-flex items-center gap-1">
                  <trend.icon size={22} /> {t(trend.label)}
                </span>
              }
              sub={analytics.previous === null ? t('Needs two snapshots') : t('{amount} € since last', { amount: signed(analytics.change) })}
            />
          </div>

          <section aria-label={t('Price history')} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi testId="hist-best" title={t('Best trip total ever')} value={money(analytics.min)} tone="text-good" sub={formatDate(analytics.minAt)} />
            <Kpi testId="hist-worst" title={t('Worst trip total ever')} value={money(analytics.max)} tone="text-bad" sub={formatDate(analytics.maxAt)} />
            <Kpi
              testId="hist-days-since-low"
              title={t('Days since lowest')}
              value={analytics.daysSinceLowest}
              sub={analytics.daysSinceLowest === 0 ? t('Current price is the low') : t('since the best price')}
            />
            <Kpi
              testId="hist-since-first"
              title={t('Change since first')}
              value={`${signed(analytics.changeSinceFirst)} €`}
              tone={analytics.changeSinceFirst > 0 ? 'text-bad' : analytics.changeSinceFirst < 0 ? 'text-good' : ''}
              sub={pctText(analytics.changeSinceFirstPct)}
            />
            <Kpi
              testId="hist-30d"
              title={t('Change last 30 days')}
              value={analytics.change30d === null ? t('n/a') : `${signed(analytics.change30d)} €`}
              tone={(analytics.change30d ?? 0) > 0 ? 'text-bad' : (analytics.change30d ?? 0) < 0 ? 'text-good' : ''}
              sub={analytics.change30dPct === null ? t('Needs 30 days of history') : pctText(analytics.change30dPct)}
            />
          </section>

          {intel && (intel.bestFare || intel.bestCabin) && (
            <section aria-label={t('Best fare and cabin')} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([['Best fare', intel.bestFare, 'kpi-best-fare'], ['Best cabin', intel.bestCabin, 'kpi-best-cabin']] as const).map(([title, o, kid]) =>
                o ? (
                  <Card key={kid} data-testid={kid}>
                    <CardHeader><CardTitle>{t(title)}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="text-sm font-medium">{o.cabinCategory} · {o.fareName}</div>
                      <PriceTriple cruise={o.option.cruisePrice} flight={o.option.flightPrice} currency={currency} />
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t('Score {n}/100', { n: title === 'Best fare' ? o.fareScore : o.dealScore })} · <Link to={`/routes/${route.id}/fares`} className="text-primary hover:underline">{t('all fares')}</Link>
                      </div>
                    </CardContent>
                  </Card>
                ) : null,
              )}
            </section>
          )}

          <h2 className="text-sm font-semibold">
            {t('Charts')}{chartStats ? ` · ${t('avg {avg} · {count} snapshots', { avg: money(chartStats.average), count: chartStats.count })}` : ''}
          </h2>
          <div className="flex flex-wrap gap-4 text-sm" role="group" aria-label={t('Optional charts')}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showCruise} onChange={(e) => setShowCruise(e.target.checked)} /> {t('Show cruise price history')}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showFlight} onChange={(e) => setShowFlight(e.target.checked)} /> {t('Show flight price history')}
            </label>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard
              testId="chart-trip"
              title={titled(t('Trip total history'))}
              empty={chartStats ? undefined : t('No data for this filter')}
              summary={chartStats ? t('Trip total (cruise plus flight) over {count} snapshots; now {now} (cruise {cruise} plus flight {flight}).', { count: chartStats.count, now: money(chartStats.current), cruise: money(chartStats.currentCruise), flight: money(chartStats.currentFlightSurcharge) }) : undefined}
              exportRows={series.map((p) => ({ date: p.collectedAt.slice(0, 10), cruise_total: p.packagePrice, flight_total: p.flightSurcharge, trip_total: tripOf(p) }))}
              filename="trip-total"
            >
              {chartStats && <PackageTimeline series={series} currency={currency} />}
            </ChartCard>
            {showCruise && (
              <ChartCard
                testId="chart-cruise"
                title={titled(t('Cruise price history'))}
                empty={chartStats ? undefined : t('No data for this filter')}
                summary={t('Cruise component of the trip total over time. The tooltip shows cruise, flight and total.')}
                exportRows={series.map((p) => ({ date: p.collectedAt.slice(0, 10), cruise_total: p.packagePrice, flight_total: p.flightSurcharge, trip_total: tripOf(p) }))}
                filename="cruise-price"
              >
                <ComponentTimeline series={series} currency={currency} which="cruise" />
              </ChartCard>
            )}
            {showFlight && (
              <ChartCard
                testId="chart-flight"
                title={titled(t('Flight price history'))}
                empty={chartStats ? undefined : t('No data for this filter')}
                summary={chartStats ? t('Flight component of the trip total over time, now {flight}. The tooltip shows cruise, flight and total.', { flight: money(chartStats.currentFlightSurcharge) }) : undefined}
                exportRows={series.map((p) => ({ date: p.collectedAt.slice(0, 10), cruise_total: p.packagePrice, flight_total: p.flightSurcharge, trip_total: tripOf(p) }))}
                filename="flight-price"
              >
                <ComponentTimeline series={series} currency={currency} which="flight" />
              </ChartCard>
            )}
            <ChartCard
              testId="chart-cabins"
              title={fareName ? `${t('Cabin comparison (total trip price)')} · ${fareName}` : t('Cabin comparison (total trip price)')}
              empty={cabins.length === 0 ? t('No cabin data yet. Collect this route to compare cabin categories.') : undefined}
              summary={t('Total trip price (cruise plus flight) of {n} cabin categories over time.', { n: cabins.length })}
              exportRows={cabinComparison(filteredSnapshots, fareCode).map(({ t: time, ...rest }) => ({ date: new Date(time).toISOString().slice(0, 10), ...rest }))}
              filename="cabin-comparison"
            >
              <CabinComparison rows={cabinComparison(filteredSnapshots, fareCode)} categories={cabin ? [cabin] : cabins} currency={currency} />
            </ChartCard>
            {filteredSnapshots.at(-1) && <CabinGroupTable breakdown={cabinGroupBreakdown(filteredSnapshots.at(-1)!, fareCode)} currency={currency} />}
            <ChartCard
              testId="chart-band"
              title={fareName ? `${t('Cheapest vs most expensive cabin (total trip price)')} · ${fareName}` : t('Cheapest vs most expensive cabin (total trip price)')}
              empty={cabins.length === 0 ? t('No cabin data yet. Collect this route to see the price band.') : undefined}
              summary={t('Range of total trip prices between the cheapest and the most expensive cabin at each collection.')}
              exportRows={cabinBand(filteredSnapshots, fareCode).map((b) => ({ date: new Date(b.t).toISOString().slice(0, 10), cheapest: b.min, most_expensive: b.max }))}
              filename="cabin-price-band"
            >
              <MinMaxBand band={cabinBand(filteredSnapshots, fareCode)} currency={currency} />
            </ChartCard>
          </div>

          {latest && latest.cabins.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {fareName
                    ? t('Cabins with the {fare} fare at last collection ({adults} adults)', { fare: fareName, adults: latest.party.adults })
                    : t('Cabins at last collection ({adults} adults, cheapest fare)', { adults: latest.party.adults })}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">{t('Category')}</th>
                      <th className="py-1 pr-3 font-medium">{t('Cruise per person')}</th>
                      <PriceHeaders />
                    </tr>
                  </thead>
                  <tbody>
                    {fareCode
                      ? fareCabinRows.map((o) => (
                          <tr key={o.cabinCategory} className="border-t border-border">
                            <td className="py-1.5 pr-3">{o.cabinCategory}</td>
                            <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{money(o.cruisePerPerson)}</td>
                            <PriceCells cruise={o.cruisePrice} flight={o.flightPrice} currency={currency} />
                          </tr>
                        ))
                      : latest.cabins.map((c) => (
                          <tr key={c.category} className="border-t border-border">
                            <td className="py-1.5 pr-3">{c.category}</td>
                            <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{money(c.packagePerPerson)}</td>
                            <PriceCells cruise={c.packageTotal} flight={c.flightTotal} currency={currency} />
                          </tr>
                        ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}
      {itinerary && <RouteMapDialog open={mapOpen} title={route.name} stops={itinerary.stops} onClose={() => setMapOpen(false)} />}
    </div>
  );
}

function CollectControls({ routeId }: { routeId: string }) {
  const { collect, addManual } = useSnapshotMutations(routeId);
  const [price, setPrice] = useState('');
  const [flight, setFlight] = useState('');
  const error = collect.error?.message ?? addManual.error?.message;

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const packagePrice = Number(price);
    if (!price || !Number.isFinite(packagePrice) || packagePrice < 0) return;
    addManual.mutate({ packagePrice, flightSurcharge: Number(flight) || 0 }, { onSuccess: () => (setPrice(''), setFlight('')) });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-end justify-end gap-2">
        <form onSubmit={submitManual} className="flex items-end gap-2" aria-label={t('Manual snapshot')}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="m-price">{t('Package €')}</Label>
            <Input id="m-price" type="number" min="0" step="any" className="w-28" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="m-flight">{t('Flight €')}</Label>
            <Input id="m-flight" type="number" min="0" step="any" className="w-24" value={flight} onChange={(e) => setFlight(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" disabled={addManual.isPending}>
            {t('Add manual')}
          </Button>
        </form>
        <Button onClick={() => collect.mutate()} disabled={collect.isPending}>
          <RefreshCw size={14} className={cn(collect.isPending && 'animate-spin')} /> {collect.isPending ? t('Collecting…') : t('Collect now')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="max-w-md text-right text-sm text-destructive">
          {error}
        </p>
      )}
      {/* A cruise that leaves in more than six months is collected once a week; a single collection can be forced. */}
      {collect.error instanceof ApiError && collect.error.code === 'ALREADY_COLLECTED_THIS_WEEK' && (
        <Button variant="outline" size="sm" onClick={() => collect.mutate(true)} disabled={collect.isPending} data-testid="collect-anyway">
          {t('Collect anyway')}
        </Button>
      )}
    </div>
  );
}
