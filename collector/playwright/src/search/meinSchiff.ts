import type { Page } from 'playwright';
import type { RouteSearchCriteria, RouteSearchResult } from './types';
import { clampLimit } from './filters';

const BASE = 'https://www.meinschiff.com';
/** The list is read card by card while scrolling; this many cards are enough for any date range of a few months. */
export const MAX_CARDS = 150;
export const MEIN_SCHIFF_TIMEOUTS = { navigationMs: 120_000, cardsMs: 60_000 } as const;
const MAX_SCROLLS = 25;

export interface RawCard {
  href: string;
  text: string;
  img: string | null;
}

/** The link without the tracking parameters of the list (list_code, list_name, list_position). */
export function cleanMeinSchiffUrl(href: string): string {
  const url = new URL(href, BASE);
  for (const key of ['list_code', 'list_name', 'list_position']) url.searchParams.delete(key);
  return url.toString();
}

/**
 * One card of the trip list as text, e.g.
 *   "Mein Schiff 7 / 7 Nächte - Kanaren mit Madeira - ab/bis Las Palmas / Las Palmas (Gran Canaria)→Funchal (Madeira)→... /
 *    Do, 04.03. / Do, 11.03.27 / ab899 €p.P. / z.B. Innenkabine / mit Flug ab 1.469 €"
 * The start date has no year; it is the year of the end date, or the year before when the month is later.
 */
export function parseMeinSchiffCard(card: RawCard): RouteSearchResult | null {
  const lines = card.text.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines.find((l) => /^\d+\s+Nächte\b/i.test(l));
  if (!title) return null;
  const ship = lines.find((l) => /^Mein Schiff\b/i.test(l)) ?? null;
  const nights = Number(title.match(/^(\d+)/)![1]);
  const ports = (lines.find((l) => l.includes('→')) ?? '').split('→').map((p) => p.replace(/\s*\(.*\)\s*$/, '').trim()).filter(Boolean);
  const start = lines.map((l) => l.match(/^\p{L}{2},\s*(\d{2})\.(\d{2})\.$/u)).find(Boolean);
  const end = lines.map((l) => l.match(/^\p{L}{2},\s*(\d{2})\.(\d{2})\.(\d{2})$/u)).find(Boolean);
  let startDate: string | null = null;
  let endDate: string | null = null;
  if (end) {
    const year = 2000 + Number(end[3]);
    endDate = `${year}-${end[2]}-${end[1]}`;
    if (start) startDate = `${Number(start[2]) > Number(end[2]) ? year - 1 : year}-${start[2]}-${start[1]}`;
  }
  const price = card.text.match(/ab\s*([\d.]+)\s*€/);
  const flightIncluded = /\(Inklusive Flug\)/i.test(card.text);
  return {
    provider: 'mein-schiff',
    url: cleanMeinSchiffUrl(card.href),
    title: title.replace(/\s+/g, ' '),
    ship,
    startDate,
    endDate,
    nights,
    pricePerPerson: price ? Number(price[1]!.replace(/\./g, '')) : null,
    flightIncluded,
    ports,
    imageUrl: card.img && !/Platzhalter/i.test(card.img) ? card.img : null,
  };
}

/** Cards in the page, one per trip: the nearest ancestor of the link that shows both a date and a price. */
const readCards = (page: Page): Promise<RawCard[]> =>
  page.evaluate(() => {
    const seen = new Map<string, { href: string; text: string; img: string | null }>();
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/trips/"]'))) {
      const key = a.href.split('?')[0]! + (new URL(a.href).searchParams.get('cabinCategoryType') ?? '');
      if (seen.has(key)) continue;
      let el: HTMLElement = a;
      for (let i = 0; i < 8 && el.parentElement; i++) {
        el = el.parentElement;
        if (/€/.test(el.innerText) && /\d{2}\.\d{2}\./.test(el.innerText) && el.querySelectorAll('a[href*="/trips/"]').length <= 6) break;
      }
      seen.set(key, { href: a.href, text: el.innerText, img: el.querySelector('img')?.src ?? null });
    }
    return [...seen.values()];
  });

/** The trip list of the website for a date range, read while scrolling (it loads ten trips at a time). */
export async function fetchMeinSchiffCards(page: Page, criteria: RouteSearchCriteria, wanted: number): Promise<{ cards: RawCard[]; capped: boolean }> {
  const range = criteria.from || criteria.to ? `?datesSelection=${encodeURIComponent(`${criteria.from ?? new Date().toISOString().slice(0, 10)},${criteria.to ?? '2030-12-31'}`)}` : '';
  await page.goto(`${BASE}/de/trips${range}`, { waitUntil: 'domcontentloaded', timeout: MEIN_SCHIFF_TIMEOUTS.navigationMs });
  await page.getByRole('button', { name: /^Zustimmen$/i }).first().click({ timeout: 8_000 }).catch(() => undefined);
  await page.waitForSelector('a[href*="/trips/"]', { timeout: MEIN_SCHIFF_TIMEOUTS.cardsMs }).catch(() => undefined);

  let cards = await readCards(page);
  const target = Math.min(MAX_CARDS, Math.max(wanted, 10));
  let stalled = 0;
  for (let i = 0; i < MAX_SCROLLS && cards.length < target && stalled < 2; i++) {
    await page.mouse.wheel(0, 6000);
    await page.waitForTimeout(1200);
    const next = await readCards(page);
    stalled = next.length > cards.length ? 0 : stalled + 1;
    cards = next;
  }
  return { cards, capped: cards.length >= MAX_CARDS };
}

export const meinSchiffWanted = (criteria: RouteSearchCriteria) => (criteria.query?.trim() ? MAX_CARDS : clampLimit(criteria.limit));
