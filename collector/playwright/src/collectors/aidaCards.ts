import type { Page } from 'playwright';
import { normalizeText, parseEuro } from '../parsers/text';
import { locate } from '../selectors/locate';
import type { AidaSelectors } from '../selectors';

export interface CardPrice {
  title: string;
  price: number;
  flightIncluded: boolean;
}

/** The cabin cards with a price, and the titles of those without one (sold out cards show no price element). */
export async function readCabinCards(page: Page, selectors: AidaSelectors): Promise<{ priced: CardPrice[]; unpriced: string[] }> {
  const cards = locate(page, selectors.cabinCard);
  await cards.first().waitFor({ state: 'visible', timeout: 20_000 });
  const priced: CardPrice[] = [];
  const unpriced: string[] = [];
  for (let i = 0; i < (await cards.count()); i++) {
    const card = cards.nth(i);
    const title = normalizeText(await locate(card, selectors.cabinTitle).first().innerText());
    const price = locate(card, selectors.cabinPrice);
    // Look first: waiting for a price element that a sold-out card never has would stall for the full timeout.
    if ((await price.count()) === 0) {
      unpriced.push(title);
      continue;
    }
    priced.push({ title, price: parseEuro(await price.first().innerText()), flightIncluded: (await locate(card, selectors.flightIncluded).count()) > 0 });
  }
  if (priced.length === 0 && unpriced.length === 0) throw new Error('No cabin categories found on the page');
  return { priced, unpriced };
}
