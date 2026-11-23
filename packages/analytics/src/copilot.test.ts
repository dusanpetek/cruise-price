import { describe, expect, it } from 'vitest';
import type { CruiseSnapshot } from '@cruise/domain';
import { COPILOT_EXAMPLES, askCopilot, detectIntent, parseBudget } from './copilot';
import { analyzePortfolio } from './intelligence';
import { fare, fareSnapshot, opt } from './testing';

const FARES = [
  fare('VARIO', { fareName: 'VARIO', includedServices: ['Buffet'] }),
  fare('PREMIUM', { includedServices: ['Buffet', 'Wunschkabine', 'Umbuchung', 'Getränke'], refundable: true, selectableCabin: true }),
];
const history = (id: string, base: number, trend: number, departure: string, ship: string): CruiseSnapshot[] =>
  Array.from({ length: 60 }, (_, d) => {
    const s = fareSnapshot(d, FARES, [opt('Meerblickkabine', 'VARIO', base + trend * d), opt('Balkonkabine', 'VARIO', base + 300 + trend * d), opt('Balkonkabine', 'PREMIUM', base + 1400 + trend * d), opt('Suite', 'VARIO', base + 2500 + trend * d)], departure);
    return { ...s, id: `${id}-${s.id}`, routeId: id, cruise: { ...s.cruise, ship } };
  });

const items = [
  { route: { id: 'canaries', name: 'Canary Islands', provider: 'aida' as const, url: 'https://aida.de/x' }, snapshots: history('canaries', 2400, -6, '2026-04-20', 'AIDA Nova') },
  { route: { id: 'norway', name: 'Norwegian Fjords', provider: 'mein-schiff' as const, url: 'https://meinschiff.com/x' }, snapshots: history('norway', 3000, 4, '2026-05-20', 'Mein Schiff Relax') },
  { route: { id: 'empty', name: 'No data yet', provider: 'aida' as const, url: 'https://aida.de/y' }, snapshots: [] },
];
const portfolio = analyzePortfolio(items, '2026-03-01T00:00:00.000Z');
/** The API builds the analysis in the language of the request, so the copilot's reasoning follows it. */
const portfolioDe = analyzePortfolio(items, '2026-03-01T00:00:00.000Z', 'de');

describe('parseBudget', () => {
  it.each([
    ['best balcony under 3.500 €', 3500],
    ['unter 3500 Euro', 3500],
    ['balcony below €3000', 3000],
    ['bis 2.750,50 €', 2750],
    ['something for 4000 eur', 4000],
    ['max 5 000 €', 5000],
    ['no number here', null],
    ['7 nights', null],
  ])('%s -> %s', (q, expected) => expect(parseBudget(q)).toBe(expected));
});

describe('detectIntent', () => {
  it.each([
    ['Which cruise is currently my best deal?', false, 'best_deal'],
    ['Welches ist gerade mein bestes Angebot?', false, 'best_deal'],
    ['Is PREMIUM worth the surcharge?', true, 'fare_worth'],
    ['Lohnt sich der Aufpreis für PREMIUM?', true, 'fare_worth'],
    ['Should I book now?', false, 'book_now'],
    ['Soll ich jetzt buchen?', false, 'book_now'],
    ['When was this route historically cheapest?', false, 'historically_cheapest'],
    ['Wann war diese Route am günstigsten?', false, 'historically_cheapest'],
    ['Which balcony offer is currently best under 3.500 €?', false, 'best_under_budget'],
    ['Welches Balkonangebot ist unter 3.500 € am besten?', false, 'best_under_budget'],
    ['tell me a joke', false, 'unknown'],
    ['Is it worth it?', false, 'unknown'],
  ])('%s -> %s', (q, fareMentioned, intent) => expect(detectIntent(q, fareMentioned)).toBe(intent));
});

describe('askCopilot', () => {
  it('finds the best deal, with reasoning, confidence, metrics and the offers behind it', () => {
    const a = askCopilot('Which cruise is currently my best deal?', portfolio);
    expect(a).toMatchObject({ intent: 'best_deal', understood: true });
    expect(a.recommendation).toMatch(/^Best deal right now: .* · .* · .* for [\d.]+ € \(cruise [\d.]+ € \+ flight [\d.]+ €\)\.$/);
    expect(a.reasoning.length).toBeGreaterThanOrEqual(3);
    expect(a.reasoning[0]).toMatch(/^Deal score \d+\/100/);
    expect(a.confidence).toBeGreaterThan(0.3);
    expect(a.confidence).toBeLessThanOrEqual(0.95);
    expect(a.metrics.map((m) => m.label)).toEqual(expect.arrayContaining(['Trip total', 'Deal score', 'Fare value score', 'Historical low']));
    expect(a.deals.length).toBeGreaterThan(1);
    expect(a.deals.map((d) => d.dealScore)).toEqual([...a.deals.map((d) => d.dealScore)].sort((x, y) => y - x));
    expect(a.deals.every((d) => d.cruise + d.flight === d.total)).toBe(true);
    expect(a.deals[0]!.routeName).toBe('Canary Islands'); // falling prices
  });

  it('answers "best balcony under 3.500 €" with a balcony inside the budget', () => {
    const a = askCopilot('Which balcony offer is currently best under 4.000 €?', portfolio);
    expect(a.intent).toBe('best_under_budget');
    expect(a.deals.length).toBeGreaterThan(0);
    expect(a.deals.every((d) => d.cabinCategory === 'Balkonkabine' && d.total <= 4000)).toBe(true);
    expect(a.reasoning.join(' ')).toMatch(/offers are within your budget of 4\.000 €/);
  });

  it('says what the cheapest match costs when the budget is too low', () => {
    const a = askCopilot('best balcony under 1.000 €', portfolio);
    expect(a.recommendation).toMatch(/^Nothing is available under 1\.000 €\. The cheapest match is .* above your budget\.$/);
    expect(a.deals).toHaveLength(1);
    expect(a.confidence).toBeGreaterThan(0);
  });

  it('narrows to a named route (also by its German name) and cabin', () => {
    const a = askCopilot('Bestes Suite-Angebot für Norwegen', portfolioDe, 'de');
    expect(a.deals.every((d) => d.routeName === 'Norwegian Fjords' && d.cabinCategory === 'Suite')).toBe(true);
    expect(a.recommendation).toContain('Bestes Angebot');
    expect(askCopilot('best deal for the Canary Islands', portfolio).deals.every((d) => d.routeName === 'Canary Islands')).toBe(true);
  });

  it('judges whether a fare is worth the surcharge', () => {
    const a = askCopilot('Is PREMIUM worth the surcharge?', portfolio);
    expect(a).toMatchObject({ intent: 'fare_worth', understood: true });
    expect(a.recommendation).toMatch(/^(Yes|No|It is a close call)/);
    expect(a.metrics.map((m) => m.label)).toEqual(['Surcharge', 'Surcharge in percent', 'Fare value score', 'Extra services']);
    expect(a.metrics[0]!.value).toMatch(/^1\.[\d.]+ €$/); // 1.400 € on top of the cheapest fare
    expect(a.reasoning.join(' ')).toContain('Recommended fare for this cabin by value');
    expect(a.deals.map((d) => d.fareName)).toEqual(['PREMIUM', 'VARIO']);
    expect(a.recommendation.startsWith('Yes')).toBe(false); // 1.400 € more for a few extras is not good value
  });

  it('knows when the asked-about fare is the cheapest one', () => {
    const a = askCopilot('Is VARIO worth the surcharge?', portfolio);
    expect(a.recommendation).toMatch(/is the cheapest fare for .* so there is no surcharge to justify/);
  });

  it('says when the fare does not exist in the chosen cabin', () => {
    const a = askCopilot('Is PREMIUM worth the surcharge for a suite?', portfolio);
    expect(a.recommendation).toBe('PREMIUM is not offered in the selected routes or cabins.');
    expect(a.confidence).toBe(0);
  });

  it('gives the explained recommendation for booking now', () => {
    const a = askCopilot('Should I book now?', portfolio);
    expect(a.intent).toBe('book_now');
    expect(a.recommendation).toMatch(/^Recommendation for .*: (BUY NOW|LIKELY GOOD|WAIT|WAIT FOR DROP|MONITOR|AVOID)\.$/);
    expect(a.reasoning.length).toBeGreaterThan(3);
    expect(a.reasoning.join('\n')).toContain('Price position');
    expect(a.reasoning.join('\n')).toContain('No route was named');
    expect(a.confidence).toBeGreaterThan(0);
    const named = askCopilot('Should I book the Norwegian Fjords now?', portfolio);
    expect(named.recommendation).toContain('Norwegian Fjords');
    expect(named.reasoning.join('\n')).not.toContain('No route was named');
    expect(named.reasoning.join('\n')).toMatch(/booking window/);
  });

  it('says when the route was cheapest, and how long before departure', () => {
    const a = askCopilot('When was the Canary Islands route historically cheapest?', portfolio);
    expect(a.intent).toBe('historically_cheapest');
    expect(a.recommendation).toMatch(/^The lowest trip total of Canary Islands was .* on 2026-\d\d-\d\d, \d+ days before departure\.$/);
    expect(a.metrics.map((m) => m.label)).toEqual(['Historical low', 'Date of the low', 'Historical high', 'Trip total']);
    expect(a.reasoning[0]).toMatch(/^Today the trip total is/);
    expect(a.reasoning.join(' ')).toMatch(/Historical lowest prices occurred \d+-\d+ days before departure/);
  });

  it('answers in German', () => {
    const a = askCopilot('Soll ich jetzt buchen?', portfolioDe, 'de');
    expect(a.recommendation).toMatch(/^Empfehlung für /);
    expect(a.reasoning.join(' ')).toContain('Preisposition');
    expect(askCopilot('Lohnt sich PREMIUM?', portfolioDe, 'de').recommendation).toMatch(/^(Ja|Nein|Es ist knapp)/);
  });

  it('does not invent answers: unknown questions get suggestions, no data gets a hint', () => {
    const u = askCopilot('Tell me a joke', portfolio);
    expect(u).toMatchObject({ intent: 'unknown', understood: false, confidence: 0, suggestions: [...COPILOT_EXAMPLES] });
    const none = askCopilot('best deal', analyzePortfolio([], 'x'));
    expect(none.recommendation).toBe('There is no price data yet. Collect your routes first.');
    expect(askCopilot('best deal in a galaxy far away at AIDA under 10 €', portfolio).recommendation).toContain('Nothing is available under 10 €');
  });

  it('never answers with a confidence outside 0..1, and answers within the 3 seconds of the brief', () => {
    const t0 = performance.now();
    for (const q of [...COPILOT_EXAMPLES, 'Soll ich warten?', 'bestes Angebot unter 2.000 €']) {
      const a = askCopilot(q, portfolio);
      expect(a.confidence).toBeGreaterThanOrEqual(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
      expect(a.recommendation.length).toBeGreaterThan(5);
    }
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
