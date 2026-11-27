import { z } from 'zod';
import { PROVIDER_IDS } from './Provider';
import { portCoordinate } from './portCoordinates';

/** Local wall-clock time at the port, `YYYY-MM-DDTHH:mm:ss`, without a zone. */
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

export const ItineraryStopSchema = z
  .object({
    /** UN/LOCODE (e.g. ESLPA). Null when the provider gives none (Mein Schiff). */
    code: z.string().min(1).nullable(),
    name: z.string().nullable(),
    seaDay: z.boolean(),
    arrival: localDateTime.nullable(),
    departure: localDateTime.nullable(),
    /** Position looked up via OpenStreetMap; only set for ports the coordinate table does not know. Both set or both null. */
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
  })
  .refine((s) => (s.lat === null) === (s.lng === null), { message: 'lat and lng must both be set or both be null' });
export type ItineraryStop = z.infer<typeof ItineraryStopSchema>;

export const ItinerarySchema = z.object({
  routeId: z.string().min(1),
  provider: z.enum(PROVIDER_IDS),
  readAt: z.string().datetime(),
  stops: z.array(ItineraryStopSchema),
});
export type Itinerary = z.infer<typeof ItinerarySchema>;

/** Stops that can be placed on the map: sea days and ports without known coordinates are left out, order kept. */
export function drawableStops(stops: ItineraryStop[]): { stop: ItineraryStop; lat: number; lng: number }[] {
  const drawable: { stop: ItineraryStop; lat: number; lng: number }[] = [];
  for (const stop of stops) {
    if (stop.seaDay) continue;
    const at = portCoordinate(stop);
    if (at) drawable.push({ stop, lat: at.lat, lng: at.lng });
    else if (typeof stop.lat === 'number' && typeof stop.lng === 'number') drawable.push({ stop, lat: stop.lat, lng: stop.lng });
  }
  return drawable;
}

/** Splits a local `YYYY-MM-DDTHH:mm:ss` string into `YYYY-MM-DD` and `HH:mm` without any timezone conversion. */
export function formatStopTime(iso: string | null): { date: string; time: string } | null {
  if (iso === null) return null;
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
