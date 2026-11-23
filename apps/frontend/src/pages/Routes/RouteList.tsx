import { useState } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { isFarFuture } from '@cruise/analytics';
import { PROVIDER_LABELS, type Route } from '@cruise/domain';
import { ProviderLogo } from '@/components/ProviderLogo';
import { Button } from '@/components/ui/button';
import { useIntelligence, useRouteMutations, useRoutes } from '@/hooks/queries';
import { cn, sortRoutes, tripDates } from '@/lib/utils';
import { RouteForm } from './RouteForm';
import { t } from '@/lib/i18n';

/** Start and end of the trip with weekdays: "Sa., 13.03.2027 – Sa., 20.03.2027". */
function TripDates({ departure, nights }: { departure: string | null; nights: number | null }) {
  const dates = tripDates(departure, nights);
  if (!dates) return null;
  return (
    <span className="block text-xs tabular-nums text-muted-foreground" data-testid="route-dates" title={nights ? t('{n} nights', { n: nights }) : undefined}>
      {dates.start}
      {dates.end && ` – ${dates.end}`}
    </span>
  );
}

export function RouteList() {
  const { data: routes, isLoading, error } = useRoutes();
  const { create, update, remove } = useRouteMutations();
  const { data: intelligence } = useIntelligence();
  /** The ship of a route is the one of its latest collection. */
  const tripOf = (id: string) => intelligence?.routes.find((r) => r.routeId === id);
  /** Cruises that leave in more than six months are collected once a week (the UTC day, like the collector counts). */
  const today = new Date().toISOString().slice(0, 10);
  const navigate = useNavigate();
  const current = useMatch('/routes/:id/*')?.params.id;
  const [mode, setMode] = useState<{ kind: 'add' } | { kind: 'edit'; route: Route } | null>(null);

  const close = () => setMode(null);
  const mutationError = (mode?.kind === 'add' ? create.error : update.error)?.message ?? null;

  return (
    <section aria-label={t('Routes')} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('Routes')}</h2>
        <Button size="sm" variant="outline" onClick={() => setMode({ kind: 'add' })}>
          <Plus size={14} /> {t('Add')}
        </Button>
      </div>

      {mode?.kind === 'add' && (
        <RouteForm
          busy={create.isPending}
          error={mutationError}
          onCancel={close}
          onSubmit={(input) =>
            create.mutate(input, {
              onSuccess: (route) => {
                close();
                navigate(`/routes/${route.id}`);
              },
            })
          }
        />
      )}

      {isLoading && <p className="text-sm text-muted-foreground">{t('Loading routes…')}</p>}
      {error && <p className="text-sm text-destructive">{t('Could not load routes: {error}', { error: error.message })}</p>}
      {routes?.length === 0 && <p className="text-sm text-muted-foreground">{t('No routes yet. Add one to start tracking.')}</p>}

      <ul className="flex flex-col gap-2">
        {sortRoutes(routes ?? [], (r) => tripOf(r.id)?.departure, (p) => PROVIDER_LABELS[p as keyof typeof PROVIDER_LABELS] ?? p).map((route) =>
          mode?.kind === 'edit' && mode.route.id === route.id ? (
            <li key={route.id}>
              <RouteForm
                initial={route}
                busy={update.isPending}
                error={mutationError}
                onCancel={close}
                onSubmit={(input) => update.mutate({ id: route.id, input }, { onSuccess: close })}
              />
            </li>
          ) : (
            <li
              key={route.id}
              className={cn('relative flex flex-col rounded-lg border bg-card transition-colors hover:bg-muted/50', route.id === current ? 'border-primary' : 'border-border')}
            >
              {/* The whole card is the link (its ::after covers the card); the buttons sit above it. */}
              <NavLink to={`/routes/${route.id}`} className="flex items-start gap-3 px-3 pb-1 pt-3 after:absolute after:inset-0 after:rounded-lg after:content-['']">
                <ProviderLogo provider={route.provider} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium leading-snug">{route.name}</span>
                  {/* The logo says which cruise line it is; screen readers get the name as hidden text. */}
                  <span className="sr-only"> ({PROVIDER_LABELS[route.provider]})</span>
                  {tripOf(route.id)?.ship && <span className="block text-xs text-muted-foreground" data-testid="route-ship">{tripOf(route.id)!.ship}</span>}
                  <TripDates departure={tripOf(route.id)?.departure ?? null} nights={tripOf(route.id)?.durationNights ?? null} />
                  {isFarFuture(tripOf(route.id)?.departure, today) && (
                    <span
                      className="mt-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                      data-testid="route-weekly"
                      title={t('This cruise leaves in more than 6 months, so its price is collected once a week.')}
                    >
                      <CalendarClock size={12} aria-hidden /> {t('collected weekly')}
                    </span>
                  )}
                </span>
              </NavLink>
              <div className="pointer-events-none relative z-10 flex justify-end gap-1 px-1 pb-1 [&>button]:pointer-events-auto">
                <Button size="icon" variant="ghost" aria-label={t('Edit {name}', { name: route.name })} onClick={() => setMode({ kind: 'edit', route })}>
                  <Pencil size={14} />
                </Button>
                <Button
                  size="icon"
                  variant="destructive"
                  aria-label={t('Delete {name}', { name: route.name })}
                  onClick={() => {
                    if (!window.confirm(t('Delete route "{name}"? Stored snapshots are kept on disk.', { name: route.name }))) return;
                    remove.mutate(route.id, { onSuccess: () => route.id === current && navigate('/') });
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
