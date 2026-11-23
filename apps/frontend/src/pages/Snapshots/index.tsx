import { Fragment, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PROVIDER_LABELS } from '@cruise/domain';
import { formatMoney } from '@cruise/shared';
import { PriceCells, PriceHeaders } from '@/components/PriceTriple';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRoutes, useSnapshots } from '@/hooks/queries';
import { formatDate, formatDateTime } from '@/lib/utils';
import { t, translateWarning } from '@/lib/i18n';

const PAGE = 50;

/** Every stored snapshot of one route, newest first, with the full cabin price list on demand. */
export default function SnapshotExplorer() {
  const { id } = useParams();
  const { data: routes } = useRoutes();
  const route = routes?.find((r) => r.id === id);
  const { data = [], isLoading } = useSnapshots(id);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => [...data].reverse(), [data]);

  if (routes && !route) return <p className="text-muted-foreground">{t('Route not found.')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to={`/routes/${id}`} className="text-sm text-primary hover:underline">
          ← {route?.name ?? t('Route')}
        </Link>
        <h1 className="text-xl font-semibold">{t('Snapshot explorer')}</h1>
        <p className="text-sm text-muted-foreground">{t('{n} snapshots stored. Snapshots are immutable; new collections only ever add rows.', { n: data.length })}</p>
      </div>

      {isLoading && <p className="text-muted-foreground">{t('Loading snapshots…')}</p>}
      {!isLoading && data.length === 0 && <p className="text-muted-foreground">{t('No snapshots yet.')}</p>}

      {rows.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto pt-4">
            <table className="w-full text-sm" data-testid="snapshot-table">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-6 py-1" />
                  <th className="py-1 pr-3 font-medium">{t('Collected')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Provider')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Ship')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Cabins')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Fares')}</th>
                  <PriceHeaders />
                  <th className="py-1 font-medium">{t('Source')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.slice(0, shown).map((s) => {
                  const money = (v: number) => formatMoney(v, s.currency);
                  const isOpen = open === s.id;
                  const provider = s.provider ?? route?.provider;
                  return (
                    <Fragment key={s.id}>
                      <tr className="border-t border-border" data-testid="snapshot-row">
                        <td className="py-1.5">
                          <button
                            type="button"
                            aria-label={t(isOpen ? 'Hide cabins for {date}' : 'Show cabins for {date}', { date: formatDateTime(s.collectedAt) })}
                            aria-expanded={isOpen}
                            disabled={s.cabins.length === 0}
                            onClick={() => setOpen(isOpen ? null : s.id)}
                            className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                          >
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td className="py-1.5 pr-3">{formatDateTime(s.collectedAt)}</td>
                        <td className="py-1.5 pr-3">{provider ? PROVIDER_LABELS[provider] : '—'}</td>
                        <td className="py-1.5 pr-3">{s.cruise.ship ?? '—'}</td>
                        <td className="py-1.5 pr-3">{s.cabins.length || '—'}</td>
                        <td className="py-1.5 pr-3" title={s.options.length === 0 ? t('Collected before fares were tracked') : undefined}>
                          {s.options.length === 0 ? <span className="text-muted-foreground">{t('unknown')}</span> : s.fares.length}
                        </td>
                        <PriceCells cruise={s.packagePrice} flight={s.flightSurcharge} currency={s.currency} />
                        <td className="py-1.5 text-muted-foreground">{t(s.source)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/40" data-testid="snapshot-detail">
                          <td />
                          <td colSpan={9} className="py-2">
                            <p className="mb-2 text-xs text-muted-foreground">
                              {s.cruise.name ?? t('Cruise')}
                              {s.cruise.departure && ` · ${t('departs {date}', { date: formatDate(s.cruise.departure) })}`}
                              {s.cruise.durationNights && ` · ${t('{n} nights', { n: s.cruise.durationNights })}`}
                              {` · ${t('{n} adults', { n: s.party.adults })}`}
                              {s.party.departureAirport && ` · ${t('flights from {airport}', { airport: s.party.departureAirport })}`}
                            </p>
                            {s.options.length === 0 ? (
                              <p className="text-sm text-muted-foreground">{t('Fare: unknown. Only the cheapest price per cabin was stored for this collection.')}</p>
                            ) : null}
                            <table className="w-full max-w-3xl text-sm">
                              <thead className="text-left text-xs text-muted-foreground">
                                <tr>
                                  <th className="py-1 pr-3 font-medium">{t('Cabin category')}</th>
                                  <th className="py-1 pr-3 font-medium">{t('Fare')}</th>
                                  <PriceHeaders />
                                </tr>
                              </thead>
                              <tbody>
                                {s.options.length > 0
                                  ? s.options.map((o) => (
                                      <tr key={`${o.cabinCategory}-${o.fareCode}`} className="border-t border-border">
                                        <td className="py-1 pr-3">{o.cabinCategory}</td>
                                        <td className="py-1 pr-3">{s.fares.find((f) => f.fareCode === o.fareCode)?.fareName ?? o.fareCode}</td>
                                        <PriceCells cruise={o.cruisePrice} flight={o.flightPrice} currency={s.currency} />
                                      </tr>
                                    ))
                                  : s.cabins.map((c) => (
                                      <tr key={c.category} className="border-t border-border">
                                        <td className="py-1 pr-3">{c.category}</td>
                                        <td className="py-1 pr-3 text-muted-foreground">{t('unknown')}</td>
                                        <PriceCells cruise={c.packageTotal} flight={c.flightTotal} currency={s.currency} />
                                      </tr>
                                    ))}
                              </tbody>
                            </table>
                            {s.warnings.length > 0 && (
                              <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground" data-testid="snapshot-warnings">
                                {s.warnings.map((w) => <li key={w}>{translateWarning(w)}</li>)}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {rows.length > shown && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setShown((n) => n + PAGE)}>
                {t('Show more ({n} older)', { n: rows.length - shown })}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
