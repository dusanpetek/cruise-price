import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { drawableStops, formatStopTime, type ItineraryStop } from '@cruise/domain';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { formatWeekdayDate, stopLabel } from '@/lib/utils';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function StopTime({ iso }: { iso: string | null }) {
  const parts = formatStopTime(iso);
  if (!parts) return <>—</>;
  // The strings are local wall-clock times of the port: shown as given, never converted through a time zone.
  return <>{formatWeekdayDate(parts.date)} {parts.time}</>;
}

/** The map of the route: markers for the distinct ports, a line through every visit in order. Created when it mounts, destroyed when it unmounts. */
function RouteMap({ stops }: { stops: ItineraryStop[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const visits = drawableStops(stops);
    const map = L.map(el, { scrollWheelZoom: false });
    L.tileLayer(TILES, { maxZoom: 18, attribution: t('© OpenStreetMap contributors') }).addTo(map);
    const line = L.polyline(visits.map((v) => [v.lat, v.lng] as [number, number]), { color: '#2563eb', weight: 3 }).addTo(map);
    const seen = new Set<string>();
    for (const v of visits) {
      const key = v.stop.code ?? v.stop.name ?? `${v.lat},${v.lng}`;
      if (seen.has(key)) continue;
      seen.add(key);
      L.circleMarker([v.lat, v.lng], { radius: 7, color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip(stopLabel(v.stop)).addTo(map);
    }
    map.fitBounds(line.getBounds(), { padding: [24, 24] });
    // The dialog has just opened: Leaflet measured a container that was not laid out yet.
    const frame = requestAnimationFrame(() => {
      map.invalidateSize();
      map.fitBounds(line.getBounds(), { padding: [24, 24] });
    });
    return () => {
      cancelAnimationFrame(frame);
      map.remove();
    };
  }, [stops]);

  return <div ref={ref} className="h-64 w-full shrink-0 rounded-lg border border-border lg:h-auto lg:min-h-[26rem] lg:flex-1" role="img" aria-label={t('Map of the route')} />;
}

/**
 * The route of a cruise: the stops with arrival and departure and, when at least two ports can be placed, a map.
 * A modal dialog like RouteSearchDialog; it can be opened from inside another dialog. The map (and with it every
 * tile request) exists only while the dialog is open.
 */
export function RouteMapDialog({ open, title, stops, onClose }: { open: boolean; title: string; stops: ItineraryStop[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // close/cancel of this dialog bubble through the React tree to an enclosing dialog's handlers; only react to our own.
  const onlyOwn = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
  const showMap = open && drawableStops(stops).length >= 2;

  return createPortal(
    <dialog
      ref={ref}
      onClose={onlyOwn}
      onCancel={onlyOwn}
      aria-label={t('Route and times')}
      data-testid="route-map"
      className="m-auto max-h-[90vh] w-[min(64rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="flex max-h-[90vh] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t('Route and times')}</h2>
            <p className="break-words text-xs text-muted-foreground">{title}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClose} aria-label={t('Close')}>✕</Button>
        </div>
        {open && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row">
            {showMap && <RouteMap stops={stops} />}
            <ol className="flex flex-col gap-2 lg:w-96 lg:shrink-0 lg:overflow-y-auto" data-testid="route-stops">
              {stops.map((stop, i) => (
                <li key={i} className="rounded-lg border border-border p-2 text-sm" data-testid="route-stop">
                  <div className="break-words font-medium">{stopLabel(stop)}</div>
                  {!stop.seaDay && (
                    <div className="text-xs tabular-nums text-muted-foreground">
                      <div>{t('Arrival')}: <StopTime iso={stop.arrival} /></div>
                      <div>{t('Departure')}: <StopTime iso={stop.departure} /></div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
