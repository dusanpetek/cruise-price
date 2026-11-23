import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { dealFilterChoices, RANKING_MODES, searchDeals, type DealFilters, type OptionIntelligence, type RankingMode } from '@cruise/analytics';
import { CABIN_GROUPS, CABIN_GROUP_LABELS, PROVIDER_LABELS, type CabinGroup, type ProviderId } from '@cruise/domain';
import { PriceTriple } from '@/components/PriceTriple';
import { ProviderLogo } from '@/components/ProviderLogo';
import { ValueBadge } from '@/components/ValueBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { useIntelligence } from '@/hooks/queries';
import { dateLocale, t } from '@/lib/i18n';
import { formatMoney } from '@cruise/shared';
import { cn, formatDate, pctText } from '@/lib/utils';

const PAGE = 20;
const MODE_LABELS: Record<RankingMode, string> = { cheapest: 'Cheapest', bestValue: 'Best value', bestForecast: 'Best forecast', biggestDrop: 'Biggest recent price drop' };
const MODE_HINTS: Record<RankingMode, string> = {
  cheapest: 'Sorted by trip total, lowest first',
  bestValue: 'Sorted by fare value score, highest first',
  bestForecast: 'Sorted by the expected saving from waiting 30 days',
  biggestDrop: 'Sorted by the price fall over the last week',
};
/** Duration choices in nights (min, max). */
const DURATIONS: { id: string; label: string; min: number | null; max: number | null }[] = [
  { id: 'any', label: 'Any duration', min: null, max: null },
  { id: 'short', label: 'Up to 7 nights', min: null, max: 7 },
  { id: 'medium', label: '8-10 nights', min: 8, max: 10 },
  { id: 'long', label: '11-14 nights', min: 11, max: 14 },
  { id: 'xl', label: '15 nights or more', min: 15, max: null },
];

interface FormState {
  text: string;
  provider: string;
  routeId: string;
  ship: string;
  cabin: string; // '', 'group:<group>' or 'cat:<category>'
  fareCode: string;
  month: string;
  duration: string;
  budget: string;
  belowAverage: boolean;
}
const EMPTY: FormState = { text: '', provider: '', routeId: '', ship: '', cabin: '', fareCode: '', month: '', duration: 'any', budget: '', belowAverage: false };

const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });

function toFilters(f: FormState): DealFilters {
  const duration = DURATIONS.find((d) => d.id === f.duration)!;
  const budget = Number(f.budget.replace(',', '.'));
  return {
    text: f.text || null,
    provider: (f.provider || null) as ProviderId | null,
    routeId: f.routeId || null,
    ship: f.ship || null,
    cabinGroup: f.cabin.startsWith('group:') ? (f.cabin.slice(6) as CabinGroup) : null,
    cabinCategory: f.cabin.startsWith('cat:') ? f.cabin.slice(4) : null,
    fareCode: f.fareCode || null,
    departureMonth: f.month || null,
    minNights: duration.min,
    maxNights: duration.max,
    maxBudget: f.budget.trim() !== '' && Number.isFinite(budget) && budget > 0 ? budget : null,
    belowAverage: f.belowAverage,
  };
}

function DealCard({ o, rank }: { o: OptionIntelligence; rank: number }) {
  const money = (v: number) => formatMoney(v, 'EUR');
  return (
    <li className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.4fr)]" data-testid="deal-row">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm tabular-nums text-muted-foreground">{rank}</span>
          <Link to={`/routes/${o.routeId}/fares`} className="break-words font-medium text-primary hover:underline">{o.routeName}</Link>
        </div>
        <div className="text-xs text-muted-foreground">
          <ProviderLogo provider={o.provider} size={16} className="mr-1 inline-block align-text-bottom" />
          {PROVIDER_LABELS[o.provider]}
          {o.ship && ` · ${o.ship}`}
          {o.departure && ` · ${t('departs {date}', { date: formatDate(o.departure) })}`}
          {o.durationNights && ` · ${t('{n} nights', { n: o.durationNights })}`}
        </div>
        <div className="mt-1 text-sm">
          {o.cabinCategory} · {o.fareName}
          {o.recommendedFare && <span className="ml-1.5 text-xs font-medium text-good" title={t('The fare with the best value score for this cabin')}>★ {t('best value fare')}</span>}
        </div>
      </div>
      <PriceTriple cruise={o.option.cruisePrice} flight={o.option.flightPrice} size="md" />
      <div className="flex flex-wrap content-start items-start gap-x-3 gap-y-1 text-xs">
        <ValueBadge score={o.valueScore} label={o.valueLabel} />
        <span className="tabular-nums" title={t('Deal score 0-100: historical position, forecast, trend, fare value, upgrade value')}>{t('Deal')} <b>{o.dealScore}</b></span>
        <span className="tabular-nums text-muted-foreground" data-testid="deal-forecast">
          {o.expectedSavings === null ? t('no forecast') : o.expectedSavings > 0 ? t('wait: save about {amount}', { amount: money(o.expectedSavings) }) : t('prices expected to rise {amount}', { amount: money(-o.expectedSavings) })}
        </span>
        <span className={cn('tabular-nums', o.recentChange && o.recentChange.amount < 0 ? 'text-good' : 'text-muted-foreground')} data-testid="deal-recent">
          {o.recentChange ? t('last week {pct} ({amount})', { pct: pctText(o.recentChange.pct), amount: `${o.recentChange.amount > 0 ? '+' : ''}${money(o.recentChange.amount)}` }) : t('no change history')}
        </span>
      </div>
    </li>
  );
}

export default function DealFinder() {
  const { data, isLoading, error } = useIntelligence();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [mode, setMode] = useState<RankingMode>('bestValue');
  const [shown, setShown] = useState(PAGE);
  const options = data?.options;
  const choices = useMemo(() => dealFilterChoices(options ?? []), [options]);
  const results = useMemo(() => searchDeals(options ?? [], toFilters(form), mode), [options, form, mode]);

  if (isLoading) return <p className="text-muted-foreground">{t('Looking for deals…')}</p>;
  if (error || !data) return <p role="alert" className="text-destructive">{t('Could not load deals: {error}', { error: error?.message ?? '' })}</p>;

  const set = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };
  const preset = (patch: Partial<FormState>, ranking: RankingMode = 'bestValue') => {
    setForm({ ...EMPTY, ...patch });
    setMode(ranking);
    setShown(PAGE);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('Deal finder')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('Every cabin and fare of every route, ranked. Prices are always cruise + flight = total for the whole party. Routes differ in itinerary and length, so compare like with like.')}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label={t('Quick searches')}>
            <span className="text-muted-foreground">{t('Quick searches')}:</span>
            <Button size="sm" variant="outline" data-testid="preset-balcony" onClick={() => preset({ cabin: 'group:balcony', budget: '3000' }, 'cheapest')}>{t('Balconies under 3.000 €, including flights')}</Button>
            <Button size="sm" variant="outline" data-testid="preset-suites" onClick={() => preset({ cabin: 'group:suite', belowAverage: true })}>{t('Suites below the historical average')}</Button>
            <Button size="sm" variant="outline" data-testid="preset-forecast" onClick={() => preset({}, 'bestForecast')}>{t('Where waiting pays off')}</Button>
            <Button size="sm" variant="ghost" data-testid="preset-reset" onClick={() => preset({})}>{t('Reset filters')}</Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label={t('Deal filters')}>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-text">{t('Search')}</Label>
              <Input id="f-text" value={form.text} placeholder={t('Route, ship or fare')} onChange={(e) => set({ text: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-provider">{t('Provider')}</Label>
              <Select id="f-provider" value={form.provider} onChange={(e) => set({ provider: e.target.value })}>
                <option value="">{t('All providers')}</option>
                {choices.providers.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-route">{t('Route')}</Label>
              <Select id="f-route" value={form.routeId} onChange={(e) => set({ routeId: e.target.value })}>
                <option value="">{t('All routes')}</option>
                {choices.routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-ship">{t('Ship')}</Label>
              <Select id="f-ship" value={form.ship} onChange={(e) => set({ ship: e.target.value })}>
                <option value="">{t('All ships')}</option>
                {choices.ships.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-cabin">{t('Cabin category')}</Label>
              <Select id="f-cabin" value={form.cabin} onChange={(e) => set({ cabin: e.target.value })}>
                <option value="">{t('All cabins')}</option>
                <optgroup label={t('Cabin groups')}>
                  {CABIN_GROUPS.map((g) => <option key={g} value={`group:${g}`}>{t(CABIN_GROUP_LABELS[g])}</option>)}
                </optgroup>
                <optgroup label={t('Categories')}>
                  {choices.cabinCategories.map((c) => <option key={c} value={`cat:${c}`}>{c}</option>)}
                </optgroup>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-fare">{t('Fare type')}</Label>
              <Select id="f-fare" value={form.fareCode} onChange={(e) => set({ fareCode: e.target.value })}>
                <option value="">{t('All fares')}</option>
                {choices.fares.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-month">{t('Departure month')}</Label>
              <Select id="f-month" value={form.month} onChange={(e) => set({ month: e.target.value })}>
                <option value="">{t('Any month')}</option>
                {choices.months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-duration">{t('Duration')}</Label>
              <Select id="f-duration" value={form.duration} onChange={(e) => set({ duration: e.target.value })}>
                {DURATIONS.map((d) => <option key={d.id} value={d.id}>{t(d.label)}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f-budget">{t('Maximum budget (€, trip total)')}</Label>
              <Input id="f-budget" type="number" min={0} step={50} inputMode="numeric" value={form.budget} placeholder="3000" onChange={(e) => set({ budget: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={form.belowAverage} onChange={(e) => set({ belowAverage: e.target.checked })} /> {t('Below the historical average')}
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('Ranking')}>
            <span className="text-xs text-muted-foreground">{t('Ranking')}:</span>
            {RANKING_MODES.map((m) => (
              <Button key={m} size="sm" variant={mode === m ? 'default' : 'outline'} aria-pressed={mode === m} data-testid={`mode-${m}`} onClick={() => { setMode(m); setShown(PAGE); }}>
                {t(MODE_LABELS[m])}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <section data-testid="deal-results" aria-label={t('Results')}>
        <p className="mb-2 text-sm text-muted-foreground" data-testid="deal-count" aria-live="polite">
          {t('{n} offers match', { n: results.length })} · {t(MODE_HINTS[mode])}
        </p>
        {data.options.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('No fare data yet. Collect your routes to compare fares.')}</p>
        ) : results.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('No offer matches these filters. Loosen the budget or pick another cabin.')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {results.slice(0, shown).map((o, i) => <DealCard key={`${o.routeId}-${o.cabinCategory}-${o.fare.fareCode}`} o={o} rank={i + 1} />)}
          </ul>
        )}
        {results.length > shown && (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setShown((n) => n + PAGE)}>
            {t('Show more ({n} more)', { n: results.length - shown })}
          </Button>
        )}
      </section>
    </div>
  );
}
