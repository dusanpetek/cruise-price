import { z } from 'zod';
import type { CruiseInfo, ItineraryStop } from '@cruise/domain';
import { nightsBetween, parseGermanDate } from './text';

const DetailSchema = z.object({
  title: z.string().optional(),
  ship: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  duration: z.number().optional(),
});

/** Cruise facts from AIDA's own `detail.cruise.json` response (more stable than scraping the header). */
export function parseAidaCruiseDetail(raw: unknown): CruiseInfo {
  const d = DetailSchema.parse(raw);
  const departure = d.startDate ? parseGermanDate(d.startDate) : null;
  const nights = d.duration ?? (departure && d.endDate ? nightsBetween(departure, parseGermanDate(d.endDate)) : null);
  return { name: d.title ?? null, ship: d.ship ?? null, departure, durationNights: nights && nights > 0 ? nights : null };
}

/**
 * AIDA splits a multi-day stay in two consecutive entries of the same port: first the arrival, then the departure.
 * Those two become one stop; nothing else is merged.
 */
export function mergeSplitStays(stops: ItineraryStop[]): ItineraryStop[] {
  const out: ItineraryStop[] = [];
  for (const s of stops) {
    const prev = out.at(-1);
    if (prev && !prev.seaDay && !s.seaDay && prev.code !== null && prev.code === s.code && prev.arrival !== null && prev.departure === null && s.arrival === null && s.departure !== null) {
      out[out.length - 1] = { ...prev, departure: s.departure };
    } else out.push(s);
  }
  return out;
}

const DETAIL_TIME = /^(\d{2})\.(\d{2})\.(\d{4}), (\d{2}):(\d{2})$/;
/** `DD.MM.YYYY, HH:mm` (local time of the port) to `YYYY-MM-DDTHH:mm:00`; anything else, and impossible dates, become null. */
function detailTime(raw: unknown): string | null {
  const m = typeof raw === 'string' ? DETAIL_TIME.exec(raw.trim()) : null;
  if (!m) return null;
  const [day, month, year, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`;
}

const ItineraryEntrySchema = z.object({
  code: z.string().nullish(),
  name: z.string().nullish(),
  arrivalDateTime: z.unknown().optional(),
  departureDateTime: z.unknown().optional(),
});
const DetailItinerarySchema = z.object({ itinerary: z.array(ItineraryEntrySchema).min(1) });

/** The exact stops of one sailing, from the `itinerary` of AIDA's `detail.cruise.json`. null when the response has none. */
export function parseAidaDetailItinerary(raw: unknown): ItineraryStop[] | null {
  const parsed = DetailItinerarySchema.safeParse(raw);
  if (!parsed.success) return null;
  const stops = parsed.data.itinerary.map((e): ItineraryStop => {
    if (e.code === 'SEE') return { code: null, name: null, seaDay: true, arrival: null, departure: null, lat: null, lng: null };
    return {
      code: e.code && /^[A-Z]{5}$/.test(e.code) ? e.code : null,
      name: e.name?.trim() || null,
      seaDay: false,
      arrival: detailTime(e.arrivalDateTime),
      departure: detailTime(e.departureDateTime),
      lat: null,
      lng: null,
    };
  });
  return mergeSplitStays(stops);
}
