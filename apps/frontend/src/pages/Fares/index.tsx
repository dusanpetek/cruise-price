import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  cabinCategoriesWithFares,
  compareFares,
  compareServices,
  fareHighlights,
  fareMatrix,
  optionSeries,
  type FareRow as FareComparisonRow,
  type MatrixSort,
  type OptionIntelligence,
} from '@cruise/analytics';
import type { UpgradeOpportunity } from '@cruise/analytics';
import type { CruiseSnapshot } from '@cruise/domain';
import { formatMoney } from '@cruise/shared';
import { ChartCard } from '@/components/charts/charts';
import { SeriesChart, type FareRow } from '@/components/charts/fareCharts';
import { PriceCells, PriceHeaders, PriceTriple } from '@/components/PriceTriple';
import { ValueBadge } from '@/components/ValueBadge';
import { VerdictBadge } from '@/components/VerdictBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/input';
import { useRouteIntelligence, useSnapshots } from '@/hooks/queries';
import { cn, formatDate, pctText } from '@/lib/utils';
import { t, translateWarning } from '@/lib/i18n';

const tri = (v: boolean | null) => t(v === null ? 'unknown' : v ? 'yes' : 'no');
const key = (cabin: string, fareCode: string) => `${cabin}||${fareCode}`;
const SORTS: Record<MatrixSort, string> = { cabin: 'Cabin', total: 'Total price', fare: 'Fare', savings: 'Savings' };

/** Series rows (one per collection) for the given cabin + fare combinations. */
function seriesRows(snapshots: readonly CruiseSnapshot[], combos: { name: string; cabin: string; fareCode: string }[], requireAll: boolean): FareRow[] {
  return snapshots.flatMap((s): FareRow[] => {
    const row: Record<string, number> = { t: Date.parse(s.collectedAt) };
    let present = 0;
    for (const c of combos) {
      const o = s.options.find((x) => x.cabinCategory === c.cabin && x.fareCode === c.fareCode);
      if (!o) continue;
      present++;
      row[c.name] = o.totalPrice;
      row[`${c.name}|cruise`] = o.cruisePrice;
      row[`${c.name}|flight`] = o.flightPrice;
    }
    return present > 0 && (!requireAll || present === combos.length) ? [row as FareRow] : [];
  });
}

export default function FaresPage() {
  const { id } = useParams();
  const { data: intel, isLoading } = useRouteIntelligence(id);
  const { data: snapshots = [] } = useSnapshots(id);
  const latest = snapshots.at(-1);
  const [cabinPick, setCabinPick] = useState('');
  const [sort, setSort] = useState<MatrixSort>('cabin');
  const [basePick, setBasePick] = useState('');
  const [upPick, setUpPick] = useState('');
  const [duelA, setDuelA] = useState('');
  const [duelB, setDuelB] = useState('');
  const [upFarePick, setUpFarePick] = useState('');

  const hasFares = !!latest && latest.options.length > 0;
  const cabins = useMemo(() => (latest ? cabinCategoriesWithFares(latest) : []), [latest]);
  const cabin = cabinPick && cabins.includes(cabinPick) ? cabinPick : (cabins.find((c) => latest && compareFares(latest, c).length > 1) ?? cabins[0] ?? '');
  const rows = useMemo(() => (latest && cabin ? compareFares(latest, cabin) : []), [latest, cabin]);
  const cabinOptions = useMemo(() => (intel?.options ?? []).filter((o) => o.cabinCategory === cabin), [intel, cabin]);
  const highlights = useMemo(() => fareHighlights(cabinOptions), [cabinOptions]);
  const matrix = useMemo(() => (hasFares && latest ? fareMatrix(latest, sort) : null), [hasFares, latest, sort]);

  if (isLoading) return <p className="text-muted-foreground">{t('Loading…')}</p>;
  if (!intel || !latest) return <p className="text-muted-foreground">{t('Route not found or no snapshots yet.')}</p>;
  const currency = latest.currency;
  const money = (v: number) => formatMoney(v, currency);
  const back = (
    <Link to={`/routes/${intel.routeId}`} className="text-sm text-primary hover:underline">
      ← {intel.routeName}
    </Link>
  );

  if (!hasFares) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <h1 className="text-xl font-semibold">{t('Fares')}</h1>
        <p className="text-muted-foreground" data-testid="no-fares">
          {t('Fare: unknown. The latest snapshot has no fare data (it was collected before fares were tracked, or by hand). Collect this route again to get every fare.')}
        </p>
        {latest.warnings.length > 0 && <Warnings items={latest.warnings} />}
      </div>
    );
  }

  const optionOf = (code: string): OptionIntelligence | undefined => cabinOptions.find((o) => o.fare.fareCode === code);
  const base = rows.find((r) => r.fare.fareCode === basePick) ?? rows[0]!;
  const upgrade = rows.find((r) => r.fare.fareCode === upPick) ?? rows[1] ?? rows[0]!;
  const services = compareServices(base.fare, upgrade.fare, upgrade.option.totalPrice - base.option.totalPrice);

  const evolutionNames = rows.map((r) => r.fare.fareName);
  const evolutionRows = seriesRows(snapshots, rows.map((r) => ({ name: r.fare.fareName, cabin, fareCode: r.fare.fareCode })), false);

  const allCombos = latest.options.map((o) => ({ key: key(o.cabinCategory, o.fareCode), cabin: o.cabinCategory, fareCode: o.fareCode, label: `${o.cabinCategory} + ${latest.fares.find((f) => f.fareCode === o.fareCode)?.fareName ?? o.fareCode}` }));
  const defaultA = rows[0] ? key(cabin, rows[0].fare.fareCode) : (allCombos[0]?.key ?? '');
  const defaultB = rows[1] ? key(cabin, rows[1].fare.fareCode) : (allCombos[1]?.key ?? defaultA);
  const a = allCombos.find((c) => c.key === (duelA || defaultA)) ?? allCombos[0]!;
  const b = allCombos.find((c) => c.key === (duelB || defaultB)) ?? allCombos[0]!;
  const duelRows = seriesRows(snapshots, [{ name: a.label, ...a }, { name: b.label === a.label ? `${b.label} (2)` : b.label, ...b }], true);
  const duelNames = [a.label, b.label === a.label ? `${b.label} (2)` : b.label];
  const lastDuel = duelRows.at(-1);
  const duelDiff = lastDuel ? lastDuel[duelNames[1]!]! - lastDuel[duelNames[0]!]! : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        {back}
        <h1 className="text-xl font-semibold">{t('Fares')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('Every cabin and fare, always as cruise + flight = total ({adults} adults, flights from {airport}). Collected {date}.', { adults: latest.party.adults, airport: latest.party.departureAirport ?? t('n/a'), date: formatDate(latest.collectedAt) })}
        </p>
      </div>
      {latest.warnings.length > 0 && <Warnings items={latest.warnings} />}

      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="fare-cabin">{t('Cabin category')}</Label>
        <Select id="fare-cabin" className="w-64" value={cabin} onChange={(e) => setCabinPick(e.target.value)}>
          {cabins.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      <section aria-label={t('Fare highlights')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Highlight testId="fare-cheapest" title={t('Cheapest fare')} o={highlights.cheapest} />
        <Highlight testId="fare-most-expensive" title={t('Most expensive fare')} o={highlights.mostExpensive} />
        <Highlight testId="fare-best-value" title={t('Best value fare')} o={highlights.bestValue} note={highlights.bestValue ? t('fare score {n}/100', { n: highlights.bestValue.fareScore }) : undefined} />
        <Card data-testid="fare-largest-saving">
          <CardHeader><CardTitle>{t('Largest saving')}</CardTitle></CardHeader>
          <CardContent>
            {highlights.largestSaving ? (
              <>
                <div className="text-xl font-semibold tabular-nums text-good">{money(highlights.largestSaving.saving.amount)} <span className="text-sm font-normal">({highlights.largestSaving.saving.pct.toFixed(1)}%)</span></div>
                <div className="text-xs text-muted-foreground">
                  {highlights.largestSaving.fromFare} → {highlights.largestSaving.toFare}, total price
                </div>
                <PriceTriple className="mt-1" size="sm" cruise={highlights.largestSaving.saving.to.cruisePrice} flight={highlights.largestSaving.saving.to.flightPrice} currency={currency} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('This cabin has a single fare.')}</p>
            )}
          </CardContent>
        </Card>
      </section>

      <Card data-testid="fare-comparison">
        <CardHeader><CardTitle>{t('{cabin}: fares compared', { cabin })}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">{t('Fare')}</th>
                <PriceHeaders />
                <th className="py-1 pr-3 font-medium">{t('Difference')}</th>
                <th className="py-1 pr-3 font-medium">{t('Saves vs dearest')}</th>
                <th className="py-1 pr-3 font-medium">{t('Outlook')}</th>
                <th className="py-1 pr-3 font-medium">{t('Fare value score')}</th>
                <th className="py-1 font-medium">{t('Deal')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.fare.fareCode} className="border-t border-border" data-testid="fare-row">
                  <td className="py-1.5 pr-3 font-medium">
                    {r.fare.fareName}
                    {!r.servicesKnown && <span className="ml-1 text-xs font-normal text-muted-foreground">{t('(services unknown)')}</span>}
                  </td>
                  <PriceCells cruise={r.option.cruisePrice} flight={r.option.flightPrice} currency={currency} />
                  <td className="py-1.5 pr-3 tabular-nums">
                    {r.difference === 0 ? t('cheapest') : `+${money(r.difference)}`}
                    {r.difference !== 0 && <div className="text-xs text-muted-foreground">{pctText(r.differencePct)}</div>}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{r.savingsVsMostExpensive === 0 ? '–' : money(r.savingsVsMostExpensive)}</td>
                  <td className="py-1.5 pr-3 text-xs">{optionOf(r.fare.fareCode)?.outlook.text ?? t('n/a')}</td>
                  <td className="py-1.5 pr-3" data-testid="fare-value">
                    {(() => {
                      const o = optionOf(r.fare.fareCode);
                      return o ? (
                        <>
                          <ValueBadge score={o.valueScore} label={o.valueLabel} />
                          {o.recommendedFare && <div className="mt-0.5 text-xs font-medium text-good">★ {t('recommended')}</div>}
                        </>
                      ) : (
                        t('n/a')
                      );
                    })()}
                  </td>
                  <td className="py-1.5 tabular-nums">{optionOf(r.fare.fareCode)?.dealScore ?? t('n/a')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <UpgradeAnalyzer upgrades={intel.upgrades} fareCodes={rows.map((r) => ({ code: r.fare.fareCode, name: r.fare.fareName }))} fareCode={upFarePick || rows[0]!.fare.fareCode} onFare={setUpFarePick} currency={currency} />

      <Card data-testid="services-comparison">
        <CardHeader><CardTitle>{t('What the extra money buys')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="svc-base">{t('From')}</Label>
            <Select id="svc-base" className="w-56" value={base.fare.fareCode} onChange={(e) => setBasePick(e.target.value)}>
              {rows.map((r) => <option key={r.fare.fareCode} value={r.fare.fareCode}>{r.fare.fareName}</option>)}
            </Select>
            <Label htmlFor="svc-up">{t('to')}</Label>
            <Select id="svc-up" className="w-56" value={upgrade.fare.fareCode} onChange={(e) => setUpPick(e.target.value)}>
              {rows.map((r) => <option key={r.fare.fareCode} value={r.fare.fareCode}>{r.fare.fareName}</option>)}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[base, upgrade].map((r: FareComparisonRow, i) => (
              <div key={i}>
                <div className="text-xs text-muted-foreground">{r.fare.fareName}</div>
                <PriceTriple size="sm" cruise={r.option.cruisePrice} flight={r.option.flightPrice} currency={currency} />
              </div>
            ))}
          </div>
          <p className="text-lg font-semibold tabular-nums" data-testid="extra-cost">
            {t('Extra cost:')} {services.extraCost === null ? t('unknown') : `${services.extraCost >= 0 ? '' : '-'}${money(Math.abs(services.extraCost))}`}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{t('(total, flight unchanged)')}</span>
          </p>
          <ServiceList title={t('Additional benefits')} tone="good" mark="✓" items={services.extraBenefits} empty={t('None confirmed.')} />
          <ServiceList title={t('Listed for {a}; unknown for {b}', { a: upgrade.fare.fareName, b: base.fare.fareName })} tone="muted" mark="?" items={services.unknownBenefits} empty={t('None.')} />
          <ServiceList title={t('No longer included')} tone="bad" mark="✗" items={services.lostBenefits} empty={t('None confirmed.')} />
          <ServiceList title={t('Listed for {a}; unknown for {b}', { a: base.fare.fareName, b: upgrade.fare.fareName })} tone="muted" mark="?" items={services.unknownLosses} empty={t('None.')} />
          <ul className="text-sm">
            {services.terms.map((term) => (
              <li key={term.label}>{t(term.label)}: {tri(term.base)} → {tri(term.upgrade)}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card data-testid="fare-matrix">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('Cabin × fare matrix')}</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="matrix-sort">{t('Sort by')}</Label>
            <Select id="matrix-sort" className="w-40" value={sort} onChange={(e) => setSort(e.target.value as MatrixSort)}>
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {matrix && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">{t('Cabin')}</th>
                  {matrix.fares.map((f) => <th key={f.fareCode} className="py-1 pr-3 font-medium">{f.fareName}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((r) => (
                  <tr key={r.cabinCategory} className="border-t border-border align-top" data-testid="matrix-row">
                    <td className="py-1.5 pr-3 font-medium">{r.cabinCategory}</td>
                    {matrix.fares.map((f) => {
                      const cell = r.cells[f.fareCode]!;
                      return (
                        <td key={f.fareCode} className={cn('py-1.5 pr-3', cell.option && cell.option.totalPrice === r.cheapestTotal && 'bg-good/10')}>
                          {cell.option ? (
                            <>
                              <PriceTriple size="sm" cruise={cell.option.cruisePrice} flight={cell.option.flightPrice} currency={currency} />
                              {cell.savings ? <div className="text-xs text-good">{t('saves {amount} vs dearest', { amount: money(cell.savings) })}</div> : null}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t('not offered')}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <ChartCard
        testId="chart-fare-evolution"
        title={t('Fare evolution: {cabin} (total trip price)', { cabin })}
        summary={t('Total trip price of each fare of the {cabin} over time: {fares}.', { cabin, fares: evolutionNames.join(', ') })}
        exportRows={evolutionRows.map((r) => ({ date: new Date(r.t).toISOString().slice(0, 10), ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 't')) }))}
        filename={`fare-evolution-${cabin}`}
        empty={evolutionRows.length < 2 ? t('Needs at least two collections with fare data.') : undefined}
      >
        <SeriesChart rows={evolutionRows} names={evolutionNames} currency={currency} />
      </ChartCard>

      <Card data-testid="fare-outlook">
        <CardHeader><CardTitle>{t('Outlook per fare ({cabin}, next 30 days)', { cabin })}</CardTitle></CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {cabinOptions.map((o) => (
              <li key={o.fare.fareCode} className="flex justify-between gap-2 py-1">
                <span>{o.outlook.text}</span>
                <span className="text-xs text-muted-foreground">{o.outlook.expected30dChangePct === null ? t('no forecast') : `${pctText(o.outlook.expected30dChangePct)} · ${t('confidence {pct}%', { pct: Math.round(o.outlook.confidence * 100) })}`}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2" data-testid="fare-duel">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="duel-a">{t('Compare')}</Label>
          <Select id="duel-a" className="w-64" value={a.key} onChange={(e) => setDuelA(e.target.value)}>
            {allCombos.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
          <Label htmlFor="duel-b">{t('with')}</Label>
          <Select id="duel-b" className="w-64" value={b.key} onChange={(e) => setDuelB(e.target.value)}>
            {allCombos.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
        </div>
        <ChartCard
          testId="chart-fare-duel"
          title={t('{a} vs {b} (total trip price)', { a: duelNames[0] ?? '', b: duelNames[1] ?? '' })}
          summary={t('Total trip price of {a} and {b} over time', { a: duelNames[0] ?? '', b: duelNames[1] ?? '' }) + (duelDiff === null ? '' : '; ' + t(duelDiff >= 0 ? 'now {amount} more for the second' : 'now {amount} less for the second', { amount: money(Math.abs(duelDiff)) })) + '.'}
          exportRows={duelRows.map((r) => ({ date: new Date(r.t).toISOString().slice(0, 10), ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 't')) }))}
          filename="fare-comparison"
          empty={duelRows.length < 2 ? t('Both combinations need at least two collections in common.') : undefined}
        >
          <SeriesChart rows={duelRows} names={duelNames} currency={currency} />
        </ChartCard>
        {duelDiff !== null && (
          <p className="text-sm tabular-nums" data-testid="duel-difference">
            {t(duelDiff >= 0 ? 'Now: {b} costs {amount} more than {a} (total price).' : 'Now: {b} costs {amount} less than {a} (total price).', { a: duelNames[0] ?? '', b: duelNames[1] ?? '', amount: money(Math.abs(duelDiff)) })}
          </p>
        )}
      </div>
    </div>
  );
}

function Highlight({ testId, title, o, note }: { testId: string; title: string; o: OptionIntelligence | null; note?: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {o ? (
          <>
            <div className="mb-1 text-sm font-medium">{o.fareName}</div>
            <PriceTriple size="md" cruise={o.option.cruisePrice} flight={o.option.flightPrice} />
            {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('No data.')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceList({ title, items, mark, tone, empty }: { title: string; items: string[]; mark: string; tone: 'good' | 'bad' | 'muted'; empty: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="text-sm">
          {items.map((s) => (
            <li key={s} className={cn(tone === 'good' && 'text-good', tone === 'bad' && 'text-bad', tone === 'muted' && 'text-muted-foreground')}>
              <span aria-hidden>{mark}</span> {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  return (
    <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm" data-testid="warnings">
      <b>{t('Not collected:')}</b>
      <ul className="list-disc pl-5">
        {items.map((w) => <li key={w}>{translateWarning(w)}</li>)}
      </ul>
    </div>
  );
}

/** Upgrade analyzer: is moving up one cabin group worth it, at this fare? */
export function UpgradeAnalyzer({ upgrades, fareCodes, fareCode, onFare, currency }: { upgrades: UpgradeOpportunity[]; fareCodes: { code: string; name: string }[]; fareCode: string; onFare: (code: string) => void; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  const list = upgrades.filter((u) => u.fareCode === fareCode).sort((a, b) => b.upgradeScore - a.upgradeScore);
  return (
    <Card data-testid="upgrade-analyzer">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('Upgrade analyzer')}</CardTitle>
        <div className="flex items-center gap-2">
          <Label htmlFor="upgrade-fare">{t('Fare')}</Label>
          <Select id="upgrade-fare" className="w-52" value={fareCode} onChange={(e) => onFare(e.target.value)}>
            {fareCodes.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground">{t('Is the better cabin worth the extra money? Trip totals (cruise + flight), compared with what the same upgrade has usually cost.')}</p>
        {list.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('This fare is offered in only one cabin group, so there is nothing to upgrade to.')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {list.map((u) => (
              <li key={u.from.group + u.to.group} className="grid gap-2 py-2 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)]" data-testid="upgrade-row" data-verdict={u.verdict}>
                <div>
                  <div className="font-medium">{u.from.cabinCategory} → {u.to.cabinCategory}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">{money(u.from.total)} → {money(u.to.total)}</div>
                </div>
                <div className="tabular-nums">
                  <div className="font-semibold">{u.costDifference >= 0 ? '+' : ''}{money(u.costDifference)}</div>
                  <div className="text-xs text-muted-foreground">{u.pctDifference >= 0 ? '+' : ''}{u.pctDifference.toFixed(1)}%</div>
                </div>
                <div className="flex flex-col items-start gap-1 text-xs">
                  <VerdictBadge verdict={u.verdict} />
                  <span className="tabular-nums text-muted-foreground">
                    {t('Upgrade score {n}/100', { n: u.upgradeScore })}
                    {u.upgradeValue !== null && ` · ${t(u.upgradeValue >= 0 ? 'Upgrade value: {amount} below the usual price' : 'Upgrade value: {amount} above the usual price', { amount: money(Math.abs(u.upgradeValue)) })}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
