import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PROVIDER_IDS, PROVIDER_LABELS, type ProviderId, type RouteSearchResult } from '@cruise/domain';
import { formatMoney } from '@cruise/shared';
import { RouteMapDialog } from '@/components/RouteMapDialog';
import { ProviderLogo } from '@/components/ProviderLogo';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { useRouteSearch } from '@/hooks/queries';
import { t } from '@/lib/i18n';
import { timeAgo, tripDates } from '@/lib/utils';

const SEARCH_HINT: Record<ProviderId, string> = {
  aida: 'AIDA is searched in a browser window that opens for a moment; this takes up to half a minute.',
  'mein-schiff': 'Mein Schiff is searched in the background; this takes about ten seconds.',
};

/** The name a picked cruise gets as a route: title, ship and the day of departure, so equal titles can be told apart. */
export const routeNameOf = (r: RouteSearchResult) => [r.title, r.ship, r.startDate ? tripDates(r.startDate, null)?.start : null].filter(Boolean).join(' · ');

/**
 * Search what a cruise line offers and pick one: the offer list of the cruise line's own website, by text (destination, port,
 * ship) and departure dates. Opens as a modal dialog; picking a cruise hands it to the route form.
 */
export function RouteSearchDialog({ open, initialProvider, onClose, onPick }: { open: boolean; initialProvider: ProviderId; onClose: () => void; onPick: (result: RouteSearchResult) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [provider, setProvider] = useState<ProviderId>(initialProvider);
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const search = useRouteSearch();
  const [mapOf, setMapOf] = useState<RouteSearchResult | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setProvider(initialProvider);
      search.reset();
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = (e: React.FormEvent) => {
    e.preventDefault();
    search.mutate({ provider, query, from, to });
  };
  const data = search.data;

  // The map dialog opens on top of this one; its close/cancel events bubble through the React tree, so only react to our own.
  const onlyOwn = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <>
    {createPortal(
    <dialog
      ref={ref}
      onClose={onlyOwn}
      onCancel={onlyOwn}
      aria-label={t('Search cruises')}
      data-testid="route-search"
      className="m-auto max-h-[90vh] w-[min(52rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="flex max-h-[90vh] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('Search cruises')}</h2>
            <p className="text-xs text-muted-foreground">{t('Find a cruise on the cruise line\'s website and pick it; its link and name are filled in for you.')}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClose} aria-label={t('Close')}>✕</Button>
        </div>

        <form onSubmit={run} className="grid gap-3 border-b border-border p-4 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]" aria-label={t('Cruise search')}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rs-provider">{t('Cruise line')}</Label>
            <Select id="rs-provider" value={provider} onChange={(e) => { setProvider(e.target.value as ProviderId); search.reset(); }}>
              {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-1">
            <Label htmlFor="rs-query">{t('Destination, port or ship')}</Label>
            <Input id="rs-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('e.g. Kanaren or Norwegen')} autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rs-from">{t('Departure from')}</Label>
            <Input id="rs-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rs-to">{t('Departure until')}</Label>
            <Input id="rs-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button type="submit" className="self-end" disabled={search.isPending}>{search.isPending ? t('Searching…') : t('Search')}</Button>
          <p className="text-xs text-muted-foreground sm:col-span-5">{t(SEARCH_HINT[provider])}</p>
        </form>

        <div className="min-h-24 flex-1 overflow-y-auto p-4" aria-live="polite">
          {search.isPending && <p className="text-sm text-muted-foreground" data-testid="route-search-pending">{t('Searching {line}… please wait.', { line: PROVIDER_LABELS[provider] })}</p>}
          {search.error && <p role="alert" className="text-sm text-destructive" data-testid="route-search-error">{search.error.message}</p>}
          {!search.isPending && !search.error && !data && <p className="text-sm text-muted-foreground">{t('Enter a destination, a port or a ship, and optionally the departure dates, then search. Without any input you see the next departures.')}</p>}
          {data && !search.isPending && (
            <>
              <p className="mb-2 text-sm text-muted-foreground" data-testid="route-search-count">
                {data.results.length === 0 ? t('No cruise found. Try a shorter text or wider dates.') : data.total > data.results.length ? t('{n} cruises found, the first {m} are shown. Narrow the search to see others.', { n: data.total, m: data.results.length }) : t('{n} cruises found.', { n: data.total })}
                {data.capped && ` ${t('Only the first offers of the website were read; set departure dates to search further ahead.')}`}
              </p>
              {data.cachedAt && (
                <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="route-search-cached">
                  {t('From the cache: the website was read {when}.', { when: timeAgo(data.cachedAt) })}
                  <Button type="button" size="sm" variant="outline" onClick={() => search.mutate({ provider, query, from, to, refresh: true })} data-testid="route-search-refresh">
                    {t('Read the website again')}
                  </Button>
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {data.results.map((r) => {
                  const dates = tripDates(r.startDate, r.nights);
                  return (
                    <li key={r.url} className="flex items-start gap-3 rounded-lg border border-border p-3" data-testid="route-search-result">
                      <ProviderLogo provider={r.provider} size={32} />
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="break-words font-medium">{r.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.ship && <span>{r.ship}</span>}
                          {dates && <span className="tabular-nums">{r.ship ? ' · ' : ''}{dates.start}{dates.end && ` – ${dates.end}`}</span>}
                          {r.nights && <span> · {t('{n} nights', { n: r.nights })}</span>}
                        </div>
                        {r.ports.length > 0 && <div className="truncate text-xs text-muted-foreground" title={r.ports.join(' → ')}>{r.ports.slice(0, 5).join(' → ')}{r.ports.length > 5 ? ' …' : ''}</div>}
                        <div className="mt-0.5 text-xs tabular-nums">
                          {r.pricePerPerson !== null ? <b>{t('from {price} per person', { price: formatMoney(r.pricePerPerson, 'EUR') })}</b> : <span className="text-muted-foreground">{t('price not shown')}</span>}
                          {r.flightIncluded && <span className="text-muted-foreground"> · {t('flight included')}</span>}
                        </div>
                      </div>
                      {r.itinerary?.length ? <Button type="button" size="sm" variant="outline" onClick={() => setMapOf(r)} aria-label={t('Route of {title}', { title: r.title })} data-testid="route-search-route">{t('Route')}</Button> : null}
                      <Button type="button" size="sm" onClick={() => onPick(r)} aria-label={t('Pick {title}', { title: routeNameOf(r) })} data-testid="route-search-pick">{t('Pick')}</Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
    )}
    <RouteMapDialog open={mapOf !== null} title={mapOf?.title ?? ''} stops={mapOf?.itinerary ?? []} onClose={() => setMapOf(null)} />
    </>
  );
}
