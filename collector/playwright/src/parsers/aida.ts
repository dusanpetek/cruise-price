import { z } from 'zod';
import type { CruiseInfo } from '@cruise/domain';
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
