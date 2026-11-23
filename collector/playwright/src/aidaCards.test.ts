import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { readCabinCards } from './collectors/aidaCards';
import { loadAidaSelectors } from './selectors';

const sel = loadAidaSelectors();

interface FakeCard {
  title: string;
  price?: string; // no price element = a sold-out card
  flight?: boolean;
}

/** A page whose cabin cards are the given ones; a locator reads nothing it was not asked for, like the real thing. */
function fakePage(cards: FakeCard[]) {
  const innerTexts: string[] = [];
  const cardLocator = (c: FakeCard) => ({
    locator: (css: string) => {
      if (css === sel.cabinTitle.css) return { first: () => ({ innerText: async () => c.title }) };
      if (css === sel.cabinPrice.css) {
        return {
          count: async () => (c.price === undefined ? 0 : 1),
          first: () => ({ innerText: async () => { innerTexts.push(c.price!); return c.price!; } }),
        };
      }
      if (css === sel.flightIncluded.css) return { count: async () => (c.flight ? 1 : 0) };
      throw new Error(`unexpected selector ${css}`);
    },
  });
  const waitFor = vi.fn(async () => undefined);
  const page = {
    locator: (css: string) => {
      if (css !== sel.cabinCard.css) throw new Error(`unexpected selector ${css}`);
      return { first: () => ({ waitFor }), count: async () => cards.length, nth: (i: number) => cardLocator(cards[i]!) };
    },
  } as unknown as Page;
  return { page, waitFor, innerTexts };
}

describe('readCabinCards', () => {
  it('reads title, per-person price and whether the flight is included', async () => {
    const { page, waitFor } = fakePage([{ title: 'Innenkabine', price: 'ab 599 €' }, { title: 'Balkonkabine', price: 'ab 1.049 €', flight: true }]);
    const out = await readCabinCards(page, sel);
    expect(waitFor).toHaveBeenCalledWith(expect.objectContaining({ state: 'visible' }));
    expect(out.unpriced).toEqual([]);
    expect(out.priced).toEqual([
      { title: 'Innenkabine', price: 599, flightIncluded: false },
      { title: 'Balkonkabine', price: 1049, flightIncluded: true },
    ]);
  });

  it('does not wait for the price of a sold-out card: it is left out and named (the fourth card had none)', async () => {
    const { page, innerTexts } = fakePage([
      { title: 'Innenkabine', price: 'ab 599 €' },
      { title: 'Meerblick', price: 'ab 699 €' },
      { title: 'Balkon', price: 'ab 799 €' },
      { title: 'Suite' }, // sold out: no price element at all
      { title: 'Premium Suite', price: 'ab 1.899 €' },
    ]);
    const out = await readCabinCards(page, sel);
    expect(out.unpriced).toEqual(['Suite']);
    expect(out.priced.map((c) => c.title)).toEqual(['Innenkabine', 'Meerblick', 'Balkon', 'Premium Suite']);
    expect(innerTexts).toHaveLength(4); // the sold-out card's price was never read
  });

  it('copes with every card sold out, and fails only when there are no cards at all', async () => {
    const soldOut = await readCabinCards(fakePage([{ title: 'A' }, { title: 'B' }]).page, sel);
    expect(soldOut).toEqual({ priced: [], unpriced: ['A', 'B'] });
    await expect(readCabinCards(fakePage([]).page, sel)).rejects.toThrow('No cabin categories found');
  });
});
