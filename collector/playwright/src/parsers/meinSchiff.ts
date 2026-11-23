import type { CruiseInfo } from '@cruise/domain';
import { nightsBetween, normalizeText, parseEuro, re } from './text';

export interface ParsedCabin {
  category: string;
  pricePerPerson: number;
  /** "mit Flug ab" per person: cheapest airport, so only useful as a cross-check. */
  withFlightFrom: number | null;
}

/** Reads the cabin cards out of the visible text of the "Reise anpassen" dialog. */
export function parseCabins(dialogText: string, cabinPattern: string): ParsedCabin[] {
  const text = normalizeText(dialogText);
  return [...text.matchAll(re(cabinPattern, 'gm'))].map((m) => ({
    category: m.groups!.title!.trim(),
    pricePerPerson: parseEuro(m.groups!.price!),
    withFlightFrom: m.groups!.withFlight ? parseEuro(m.groups!.withFlight) : null,
  }));
}

/** The dialog's "Gesamtpreis" (whole party) for the currently selected cabin and travel option. */
export function parseTotal(dialogText: string, totalPattern: string): number {
  const m = normalizeText(dialogText).match(re(totalPattern));
  if (!m?.[1]) throw new Error('Gesamtpreis not found in dialog');
  return parseEuro(m[1]);
}

export function parseGuests(text: string, guestsPattern: string): number {
  const m = normalizeText(text).match(re(guestsPattern));
  if (!m?.[1]) throw new Error('Guest count not found');
  return Number(m[1]);
}

/** "14.03. – 21.03.2027" -> departure + nights. The start year is inferred from the end date. */
export function parseDateRange(text: string, pattern: string): { departure: string; nights: number } | null {
  const m = normalizeText(text).match(re(pattern));
  if (!m) return null;
  const [, d1, m1, d2, m2, year] = m;
  const endYear = Number(year);
  const startYear = Number(m1) > Number(m2) ? endYear - 1 : endYear;
  const departure = `${startYear}-${m1}-${d1}`;
  return { departure, nights: nightsBetween(departure, `${endYear}-${m2}-${d2}`) };
}

export function parseMeinSchiffCruiseInfo(
  input: { title: string | null; ship: string | null; pageText: string },
  patterns: { dateRangePattern: string; nightsPattern: string },
): CruiseInfo {
  const range = parseDateRange(input.pageText, patterns.dateRangePattern);
  const titleNights = input.title?.match(re(patterns.nightsPattern))?.[1];
  const nights = titleNights ? Number(titleNights) : range?.nights;
  return {
    name: input.title?.trim() || null,
    ship: input.ship?.trim() || null,
    departure: range?.departure ?? null,
    durationNights: nights && nights > 0 ? nights : null,
  };
}
