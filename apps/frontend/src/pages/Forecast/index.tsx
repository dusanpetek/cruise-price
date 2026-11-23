import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { forecastDashboard, savingsProjection, toSeries, tripOf } from '@cruise/analytics';
import { CABIN_GROUP_LABELS } from '@cruise/domain';
import { formatMoney } from '@cruise/shared';
import { ChartCard } from '@/components/charts/charts';
import { ConfidenceBand, ExpectedRangeChart, ForecastAccuracyChart, ForecastConfidenceChart, HistoricalForecast, RecommendationTimelineChart, SavingsProjectionChart } from '@/components/charts/forecastCharts';
import { RecommendationBadge } from '@/components/RecommendationBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/input';
import { useRouteIntelligence, useSnapshots } from '@/hooks/queries';
import { formatDate, pctText } from '@/lib/utils';
import { t } from '@/lib/i18n';

const DAY = 86_400_000;

/** Projection horizons come from the analytics as English ("Now", "+30 days"). */
const projLabel = (label: string) => (label === 'Now' ? t('Now') : t('+{n} days', { n: label.replace(/\D/g, '') }));

export default function ForecastPage() {
  const { id } = useParams();
  const { data: intel, isLoading, error } = useRouteIntelligence(id);
  const { data: snapshots = [] } = useSnapshots(id);
  const [cabin, setCabin] = useState('');

  // Everything here is the trip total (cruise + flight): forecasts are fitted on it.
  const history = useMemo(() => toSeries(snapshots, cabin || null).map((p) => ({ t: Date.parse(p.collectedAt), price: tripOf(p) })), [snapshots, cabin]);
  if (isLoading) return <p className="text-muted-foreground">{t('Analysing…')}</p>;
  if (error || !intel) return <p role="alert" className="text-destructive">{error?.message ?? 'Route not found.'}</p>;

  const currency = intel.currency;
  const money = (v: number) => formatMoney(v, currency);
  const withForecast = intel.cabinForecasts.filter((c) => c.forecast);
  const latestSnapshot = snapshots.at(-1);
  const flight = (cabin ? latestSnapshot?.cabins.find((c) => c.category === cabin)?.flightTotal : latestSnapshot?.flightSurcharge) ?? 0;
  const forecast = cabin ? (intel.cabinForecasts.find((c) => c.category === cabin)?.forecast ?? null) : intel.forecast;
  const bt = intel.backtest;
  const timeline = intel.recommendationTimeline;
  const lastT = history.at(-1)?.t ?? 0;
  const projection = savingsProjection(forecast);
  const dash = forecastDashboard(forecast);
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const label = cabin || t('cheapest cabin');
  const noForecast = t('Not enough history yet: forecasts need at least 5 price snapshots within 60 days.');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to={`/routes/${intel.routeId}`} className="text-sm text-primary hover:underline">← {intel.routeName}</Link>
        <h1 className="text-xl font-semibold">{t('Forecast and recommendation')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('A linear trend fitted to the last 60 days of prices. It is a statistical extrapolation, not a promise: confidence reflects how well the trend fits and how much data exists.')}
        </p>
      </div>

      <Card data-testid="recommendation-card">
        <CardContent className="flex flex-col gap-2 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <RecommendationBadge action={intel.recommendation.action} confidence={intel.recommendation.confidence} />
            <span className="text-sm">{intel.recommendation.reason}</span>
          </div>
          <ul className="list-disc pl-5 text-sm" data-testid="explanation">
            {intel.recommendation.explanation.slice(1).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="whitespace-pre-line text-sm text-muted-foreground">{intel.insight}</p>
          <p className="text-sm" data-testid="booking-window">
            <span className="font-medium">{t('Booking window:')} </span>
            {intel.bookingWindow.note}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="fc-cabin">{t('Cabin category')}</Label>
        <Select id="fc-cabin" className="w-64" value={cabin} onChange={(e) => setCabin(e.target.value)}>
          <option value="">{t('Cheapest cabin (headline)')}</option>
          {withForecast.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
        </Select>
        <span className="text-xs text-muted-foreground">{t('Accuracy and the recommendation timeline always use the cheapest cabin.')}</span>
      </div>

      {forecast && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="forecast-numbers">
          {([['Now', forecast.currentPrice], ['In 7 days', forecast.forecast7Day], ['In 30 days', forecast.forecast30Day], ['In 60 days', forecast.forecast60Day]] as const).map(([title, v]) => (
            <Card key={title}>
              <CardHeader><CardTitle>{t(title)}</CardTitle></CardHeader>
              <CardContent>
                <div className="text-xl font-semibold tabular-nums">{money(v)} <span className="text-xs font-normal text-muted-foreground">{t('Total')}</span></div>
                <div className="text-xs tabular-nums text-muted-foreground">{t('Cruise {cruise} + Flight {flight}', { cruise: money(v - flight), flight: money(flight) })}</div>
                {title !== 'Now' && <div className="text-xs text-muted-foreground">{pctText(((v - forecast.currentPrice) / forecast.currentPrice) * 100)} · {t('confidence {pct}%', { pct: Math.round(forecast.confidence * 100) })}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dash && (
        <Card data-testid="forecast-summary-card">
          <CardContent className="grid gap-4 pt-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">{t('Current')}</div>
              <div className="text-2xl font-semibold tabular-nums">{money(dash.current)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('Forecast 30 days')}</div>
              <div className="text-2xl font-semibold tabular-nums">{money(dash.forecast30Day)}</div>
            </div>
            <div data-testid="potential-saving">
              <div className="text-xs text-muted-foreground">{dash.potentialSaving >= 0 ? t('Potential saving') : t('Expected extra cost')}</div>
              <div className={`text-2xl font-semibold tabular-nums ${dash.potentialSaving > 0 ? 'text-good' : dash.potentialSaving < 0 ? 'text-bad' : ''}`}>{money(Math.abs(dash.potentialSaving))}</div>
              <div className="text-xs text-muted-foreground">{pctText(-dash.potentialSavingPct)} · {t('confidence {pct}%', { pct: Math.round(dash.confidence * 100) })}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          testId="chart-range"
          title={t('Expected price range')}
          empty={dash ? undefined : noForecast}
          summary={dash ? t('Expected trip total in 7, 30 and 60 days with its 95% range: {low} to {high} after 30 days.', { low: money(dash.horizons[1]!.low), high: money(dash.horizons[1]!.high) }) : undefined}
          exportRows={dash?.horizons.map((h) => ({ days: h.days, expected_price: h.price, low: h.low, high: h.high, expected_saving: h.expectedSaving }))}
          filename="expected-price-range"
        >
          {dash && <ExpectedRangeChart horizons={dash.horizons} current={dash.current} currency={currency} />}
        </ChartCard>

        <ChartCard
          testId="chart-forecast-confidence"
          title={t('Forecast confidence by horizon')}
          empty={dash ? undefined : noForecast}
          summary={dash ? t('Confidence in the forecast after 7, 30 and 60 days: {a}%, {b}% and {c}%.', { a: Math.round(dash.horizons[0]!.confidence * 100), b: Math.round(dash.horizons[1]!.confidence * 100), c: Math.round(dash.horizons[2]!.confidence * 100) }) : undefined}
          exportRows={dash?.horizons.map((h) => ({ days: h.days, confidence: h.confidence }))}
          filename="forecast-confidence"
        >
          {dash && <ForecastConfidenceChart horizons={dash.horizons} />}
        </ChartCard>

        <ChartCard
          testId="chart-forecast"
          title={t('Historical and forecast total price ({label})', { label })}
          empty={forecast ? undefined : noForecast}
          summary={forecast ? t('Total trip price history of the {label} (cruise plus flight) followed by a 60-day trend forecast, expected to reach {f60} from {now} now.', { label, f60: money(forecast.forecast60Day), now: money(forecast.currentPrice) }) : undefined}
          exportRows={forecast ? [...history.map((h) => ({ date: day(h.t), type: 'actual', total_price: h.price })), ...forecast.points.map((p) => ({ date: day(lastT + p.days * DAY), type: 'forecast', total_price: p.price }))] : undefined}
          filename="historical-forecast"
        >
          {forecast && <HistoricalForecast history={history} forecast={forecast} currency={currency} />}
        </ChartCard>

        <ChartCard
          testId="chart-confidence"
          title={t('Forecast confidence band (95%, total price)')}
          empty={forecast ? undefined : noForecast}
          summary={forecast ? t('Prediction interval for the {label}: after 30 days between {low} and {high}.', { label, low: money(forecast.points[1]!.low), high: money(forecast.points[1]!.high) }) : undefined}
          exportRows={forecast?.curve.filter((_, i) => i % 5 === 0).map((p) => ({ date: day(lastT + p.days * DAY), forecast: p.price, low: p.low, high: p.high }))}
          filename="confidence-band"
        >
          {forecast && <ConfidenceBand forecast={forecast} startT={lastT} currency={currency} />}
        </ChartCard>

        <ChartCard
          testId="chart-accuracy"
          title={bt.directionalAccuracy === null ? t('Forecast accuracy') : t('Forecast accuracy: {pct}% direction correct, {err}% avg error ({n} forecasts)', { pct: Math.round(bt.directionalAccuracy * 100), err: bt.mape?.toFixed(1) ?? '–', n: bt.samples })}
          empty={bt.samples === 0 ? t('Not yet measurable: validating a 30-day forecast needs about 40 days of history.') : undefined}
          summary={t('Forecasts made 30 days earlier compared with the actual price; {n} comparisons.', { n: bt.samples })}
          exportRows={bt.points.map((p) => ({ forecast_made: p.cutoffAt.slice(0, 10), target_date: p.targetAt.slice(0, 10), predicted: p.predicted, actual: p.actual, direction_correct: p.directionCorrect ? 1 : 0 }))}
          filename="forecast-accuracy"
        >
          <ForecastAccuracyChart points={bt.points} currency={currency} />
        </ChartCard>

        <ChartCard
          testId="chart-timeline"
          title={t('Recommendation timeline')}
          empty={timeline.length === 0 ? t('A recommendation needs at least 14 price snapshots.') : undefined}
          summary={t('What the recommendation would have been at {n} past collections: BUY, WAIT or MONITOR. Prices are total trip prices.', { n: timeline.length })}
          exportRows={timeline.map((p) => ({ date: day(p.t), total_price: p.price, action: p.action, confidence: p.confidence }))}
          filename="recommendation-timeline"
        >
          <RecommendationTimelineChart points={timeline} currency={currency} />
        </ChartCard>

        <ChartCard
          testId="chart-projection"
          title={t('Savings projection: what waiting is worth ({label}, total price)', { label })}
          empty={forecast ? undefined : noForecast}
          summary={forecast ? projection.map((p) => `${projLabel(p.label)}: ${p.savings >= 0 ? t('saves') : t('costs')} ${money(Math.abs(p.savings))}`).join('; ') : undefined}
          exportRows={projection.map((p) => ({ horizon: p.label, projected_price: p.price, savings_if_waiting: p.savings }))}
          filename="savings-projection"
        >
          <SavingsProjectionChart points={projection} currency={currency} />
        </ChartCard>
      </div>

      {intel.groups.length > 0 && (
        <Card data-testid="group-table">
          <CardHeader><CardTitle>{t('By cabin category')}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">{t('Category')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Current')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Historical low')}</th>
                  <th className="py-1 pr-3 font-medium">{t('30-day outlook')}</th>
                  <th className="py-1 font-medium">{t('Recommendation')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {intel.groups.map((g) => (
                  <tr key={g.group} className="border-t border-border">
                    <td className="py-1.5 pr-3">{t(CABIN_GROUP_LABELS[g.group])}</td>
                    <td className="py-1.5 pr-3">{money(g.current)}</td>
                    <td className="py-1.5 pr-3">{money(g.low)} <span className="text-muted-foreground">({t('{pct} above', { pct: pctText(g.pctToMin) })})</span></td>
                    <td className="py-1.5 pr-3">{g.expected30dChangePct === null ? t('n/a') : pctText(g.expected30dChangePct)}</td>
                    <td className="py-1.5"><RecommendationBadge action={g.recommendation.action} confidence={g.recommendation.confidence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {intel.departure && <p className="mt-2 text-xs text-muted-foreground">Departure {formatDate(intel.departure)}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
