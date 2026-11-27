import { describe, expect, it, vi } from 'vitest';
import type { Browser, Page } from 'playwright';
import { RouteInputSchema } from '@cruise/domain';
import type { BrowserFactory } from './browser/browserFactory';
import { aidaJourneyUrl, aidaResults, aidaStops, cacheKeyOf, cachedRouteSearch, cleanMeinSchiffUrl, fold, inRange, matchesQuery, parseMeinSchiffCard, refine, searchRoutes, SEARCH_CACHE_TTL_MS, type AidaItem, type SearchCache } from './search/routeSearch';
import { MOCK_CATALOG } from './search/mock';
import { MAX_CARDS, MEIN_SCHIFF_TIMEOUTS } from './search/meinSchiff';
import { AIDA_TIMEOUTS, findAidaItinerary } from './search/aida';

// ---- fixtures taken from the real sites (shortened) ----
const AIDA_ITEMS: AidaItem[] = [
  {
    title: 'Kanaren & Madeira ab Gran Canaria',
    duration: 7,
    ports: [{ name: 'LAS PALMAS/GRAN CANARIA' }, { name: 'PUERTO DEL ROSARIO' }, { name: null }, { name: 'FUNCHAL/MADEIRA' }, { name: 'LAS PALMAS/GRAN CANARIA' }],
    cruiseItemVariant: [
      { startDate: '2027-03-13', endDate: '2027-03-20', duration: 7, amountPerPerson: 649, journeyIdentifier: 'CO07270313', flightIncluded: false, ship: { marketingName: 'AIDAcosma' }, imageUrl: 'https://img/1.jpg' },
      { startDate: '2026-12-12', endDate: '2026-12-19', duration: 7, amountPerPerson: 1045, journeyIdentifier: 'CO07261212', flightIncluded: true, ship: { marketingName: 'AIDAcosma' } },
      { startDate: '2027-03-13', endDate: '2027-03-20', duration: 7, amountPerPerson: 649, journeyIdentifier: 'CO07270313', ship: { marketingName: 'AIDAcosma' } }, // the same journey again
    ],
  },
  { title: 'Südnorwegen ab Hamburg', duration: 7, ports: [{ name: 'HAMBURG' }, { name: 'STAVANGER' }], cruiseItemVariant: [{ startDate: '2027-02-13', endDate: '2027-02-20', journeyIdentifier: 'NO07270213', amountPerPerson: null, ship: { name: 'AIDAnova' } }, { journeyIdentifier: undefined }] },
];

const LIVE_PORTS: NonNullable<AidaItem['ports']> = [
  { code: 'ESLPA', name: 'LAS PALMAS/GRAN CANARIA', departureDateTime: '2026-11-28T22:00:00', arrivalDateTime: null },
  { code: 'ESSPC', name: 'SANTA CRUZ/LA PALMA', departureDateTime: '2026-11-29T20:00:00', arrivalDateTime: '2026-11-29T10:00:00' },
  { code: 'SEE', name: null, departureDateTime: null, arrivalDateTime: null },
  { code: 'MAAGA', name: 'AGADIR', departureDateTime: '2026-12-01T18:00:00', arrivalDateTime: '2026-12-01T08:00:00' },
  { code: 'SEE', name: null, departureDateTime: null, arrivalDateTime: null },
  { code: 'ESFUE', name: 'PUERTO DEL ROSARIO', departureDateTime: '2026-12-04T00:00:00', arrivalDateTime: '2026-12-03T08:00:00' },
  { code: 'ESACE', name: 'ARRECIFE/LANZAROTE', departureDateTime: '2026-12-04T22:00:00', arrivalDateTime: '2026-12-04T09:00:00' },
  { code: 'ESLPA', name: 'LAS PALMAS/GRAN CANARIA', departureDateTime: null, arrivalDateTime: '2026-12-05T05:00:00' },
];

const MS_CARD = (over: Partial<{ text: string; href: string; img: string | null }> = {}) => ({
  href: 'https://www.meinschiff.com/de/trips/7-naechte-kanaren-mit-madeira-abbis-las-palmas-MSI2709SEE?cabinCategoryType=INUS2V&priceMode=perPerson&tariff=PLUS&list_code=338308954&list_name=orderBy%3Dnextdate-asc&list_position=3',
  text: 'Mein Schiff 7\n7 Nächte - Kanaren mit Madeira - ab/bis Las Palmas\nLas Palmas (Gran Canaria)→Funchal (Madeira)→Santa Cruz (Teneriffa)→Las Palmas (Gran Canaria)\nDo, 04.03.\nDo, 11.03.27\nab899 €p.P.\nz.B. Innenkabine\nmit Flug ab 1.469 €\nReisedetails',
  img: 'https://assets.meinschiff.com/images/x/karte.avif',
  ...over,
});

describe('text and date filters', () => {
  it('folds case, umlauts and accents', () => {
    expect(fold('  Südnorwegen  ÜBER Köln Ça ')).toBe('suednorwegen ueber koeln ca');
  });

  it('matches when every word occurs, in any order; an empty query matches everything', () => {
    expect(matchesQuery('Kanaren & Madeira ab Gran Canaria', 'madeira kanaren')).toBe(true);
    expect(matchesQuery('Südnorwegen ab Hamburg', 'suednorwegen')).toBe(true);
    expect(matchesQuery('Südnorwegen ab Hamburg', 'Südnorwegen')).toBe(true);
    expect(matchesQuery('Kanaren', 'kanaren karibik')).toBe(false);
    expect(matchesQuery('anything', '   ')).toBe(true);
    expect(matchesQuery('anything', null)).toBe(true);
  });

  it('checks the departure range, both ends inclusive; a result without a date never matches a range', () => {
    expect(inRange('2027-03-13', '2027-03-01', '2027-03-31')).toBe(true);
    expect(inRange('2027-03-01', '2027-03-01', '2027-03-31')).toBe(true);
    expect(inRange('2027-03-31', '2027-03-01', '2027-03-31')).toBe(true);
    expect(inRange('2027-04-01', '2027-03-01', '2027-03-31')).toBe(false);
    expect(inRange('2027-02-28', '2027-03-01', null)).toBe(false);
    expect(inRange('2027-02-28', null, '2027-03-31')).toBe(true);
    expect(inRange(null, '2027-03-01', null)).toBe(false);
    expect(inRange(null, null, null)).toBe(true);
  });
});

describe('AIDA results', () => {
  const results = aidaResults(AIDA_ITEMS);

  it('makes one result per sailing (variant), once per journey', () => {
    expect(results.map((r) => r.url)).toEqual([aidaJourneyUrl('CO07270313'), aidaJourneyUrl('CO07261212'), aidaJourneyUrl('NO07270213')]);
  });

  it('carries title, ship, dates, nights, price, flight and ports (readable, without gaps)', () => {
    expect(results[0]).toEqual({
      provider: 'aida',
      url: 'https://aida.de/finden/CO07270313/CLASSIC?pax[adults]=2&pax[juveniles]=0&pax[children]=0&pax[babies]=0',
      title: 'Kanaren & Madeira ab Gran Canaria',
      ship: 'AIDAcosma',
      startDate: '2027-03-13',
      endDate: '2027-03-20',
      nights: 7,
      pricePerPerson: 649,
      flightIncluded: false,
      ports: ['Las Palmas/Gran Canaria', 'Puerto Del Rosario', 'Funchal/Madeira'],
      itinerary: [
        { code: null, name: 'Las Palmas/Gran Canaria', seaDay: false, arrival: null, departure: null, lat: null, lng: null },
        { code: null, name: 'Puerto Del Rosario', seaDay: false, arrival: null, departure: null, lat: null, lng: null },
        { code: null, name: null, seaDay: true, arrival: null, departure: null, lat: null, lng: null },
        { code: null, name: 'Funchal/Madeira', seaDay: false, arrival: null, departure: null, lat: null, lng: null },
        { code: null, name: 'Las Palmas/Gran Canaria', seaDay: false, arrival: null, departure: null, lat: null, lng: null },
      ],
      imageUrl: 'https://img/1.jpg',
    });
    expect(results[1]).toMatchObject({ flightIncluded: true, pricePerPerson: 1045, imageUrl: null });
    expect(results[2]).toMatchObject({ ship: 'AIDAnova', pricePerPerson: null, nights: 7 });
  });

  it('turns the ports of the response into itinerary stops, times passed through as given', () => {
    const stops = aidaStops(LIVE_PORTS);
    expect(stops).toHaveLength(8);
    expect(stops[0]).toEqual({ code: 'ESLPA', name: 'Las Palmas/Gran Canaria', seaDay: false, arrival: null, departure: '2026-11-28T22:00:00', lat: null, lng: null });
    expect(stops[1]).toEqual({ code: 'ESSPC', name: 'Santa Cruz/La Palma', seaDay: false, arrival: '2026-11-29T10:00:00', departure: '2026-11-29T20:00:00', lat: null, lng: null });
    expect(stops[2]).toEqual({ code: null, name: null, seaDay: true, arrival: null, departure: null, lat: null, lng: null });
    expect(stops[7]).toEqual({ code: 'ESLPA', name: 'Las Palmas/Gran Canaria', seaDay: false, arrival: '2026-12-05T05:00:00', departure: null, lat: null, lng: null });
  });

  it('maps empty or malformed times to null so the search never fails on them', () => {
    const [a, b] = aidaStops([
      { code: 'ESLPA', name: 'LAS PALMAS', arrivalDateTime: '', departureDateTime: '2026-11-28T22:00' },
      { code: '', name: '', arrivalDateTime: undefined, departureDateTime: 'soon' },
    ]);
    expect(a).toMatchObject({ code: 'ESLPA', seaDay: false, arrival: null, departure: null });
    expect(b).toEqual({ code: null, name: null, seaDay: true, arrival: null, departure: null, lat: null, lng: null });
  });

  it('keeps the code of a port that has no name (it is still a port, drawable by its code)', () => {
    const [a] = aidaStops([{ code: 'ESLPA', name: '', arrivalDateTime: '', departureDateTime: '' }]);
    expect(a).toEqual({ code: 'ESLPA', name: null, seaDay: false, arrival: null, departure: null, lat: null, lng: null });
  });

  it('shifts the times to a sailing start by whole days, time of day kept', () => {
    const times = (start?: string | null) => aidaStops(LIVE_PORTS, start).map((x) => [x.arrival, x.departure]);
    expect(times('2026-11-28')).toEqual(times());
    expect(times('2026-12-19')).toEqual([
      [null, '2026-12-19T22:00:00'],
      ['2026-12-20T10:00:00', '2026-12-20T20:00:00'],
      [null, null],
      ['2026-12-22T08:00:00', '2026-12-22T18:00:00'],
      [null, null],
      ['2026-12-24T08:00:00', '2026-12-25T00:00:00'],
      ['2026-12-25T09:00:00', '2026-12-25T22:00:00'],
      ['2026-12-26T05:00:00', null],
    ]);
    const crossing = aidaStops(LIVE_PORTS, '2027-01-24');
    expect(crossing[0]).toMatchObject({ arrival: null, departure: '2027-01-24T22:00:00' });
    expect(crossing[3]).toMatchObject({ arrival: '2027-01-27T08:00:00', departure: '2027-01-27T18:00:00' });
    expect(crossing[7]).toMatchObject({ arrival: '2027-01-31T05:00:00', departure: null });
    expect(crossing[2]).toEqual({ code: null, name: null, seaDay: true, arrival: null, departure: null, lat: null, lng: null });
  });

  it('sets all times to null when the shift cannot be worked out', () => {
    const allNull = (stops: ReturnType<typeof aidaStops>) => stops.every((x) => x.arrival === null && x.departure === null);
    const noDeparture = LIVE_PORTS.map((p) => ({ ...p, departureDateTime: null }));
    expect(aidaStops(noDeparture, '2026-12-19')).toHaveLength(8);
    expect(allNull(aidaStops(noDeparture, '2026-12-19'))).toBe(true);
    expect(allNull(aidaStops(LIVE_PORTS, '19.12.2026'))).toBe(true);
    expect(allNull(aidaStops(LIVE_PORTS, null))).toBe(true);
    expect(allNull(aidaStops(LIVE_PORTS, ''))).toBe(true);
  });

  it('gives every variant the stops of its own dates', () => {
    const [a, b, c] = aidaResults([
      { title: 'x', ports: LIVE_PORTS, cruiseItemVariant: [{ journeyIdentifier: 'J1', startDate: '2026-11-28' }, { journeyIdentifier: 'J2', startDate: '2027-03-13' }, { journeyIdentifier: 'J3' }] },
    ]);
    expect(a!.itinerary![0]!.departure).toBe('2026-11-28T22:00:00');
    expect(b!.itinerary![0]!.departure).toBe('2027-03-13T22:00:00');
    expect(b!.itinerary![7]!.arrival).toBe('2027-03-20T05:00:00');
    expect(c!.itinerary!.every((x) => x.arrival === null && x.departure === null)).toBe(true);
  });

  it('attaches the stops to every result and leaves ports unchanged', () => {
    const r = aidaResults([{ title: 'x', ports: LIVE_PORTS, cruiseItemVariant: [{ journeyIdentifier: 'J1' }] }])[0]!;
    expect(r.itinerary).toHaveLength(8);
    expect(r.ports).toEqual(['Las Palmas/Gran Canaria', 'Santa Cruz/La Palma', 'Agadir', 'Puerto Del Rosario', 'Arrecife/Lanzarote']);
  });

  it('makes URLs the route form accepts for the AIDA provider', () => {
    for (const r of results) expect(RouteInputSchema.safeParse({ name: r.title, provider: 'aida', url: r.url }).success).toBe(true);
  });
});

describe('Mein Schiff cards', () => {
  it('reads ship, title, nights, ports, dates, price and flight from the card text', () => {
    expect(parseMeinSchiffCard(MS_CARD())).toEqual({
      provider: 'mein-schiff',
      url: 'https://www.meinschiff.com/de/trips/7-naechte-kanaren-mit-madeira-abbis-las-palmas-MSI2709SEE?cabinCategoryType=INUS2V&priceMode=perPerson&tariff=PLUS',
      title: '7 Nächte - Kanaren mit Madeira - ab/bis Las Palmas',
      ship: 'Mein Schiff 7',
      startDate: '2027-03-04',
      endDate: '2027-03-11',
      nights: 7,
      pricePerPerson: 899,
      flightIncluded: false,
      ports: ['Las Palmas', 'Funchal', 'Santa Cruz', 'Las Palmas'],
      imageUrl: 'https://assets.meinschiff.com/images/x/karte.avif',
    });
  });

  it('knows when the flight is included and ignores the placeholder map image', () => {
    const r = parseMeinSchiffCard(MS_CARD({ text: 'Mein Schiff 1\n14 Nächte - Best of Mittelamerika - ab/bis Montego Bay\nMo, 01.03.\nMo, 15.03.27\nab3.349 €p.P.\nz.B. Innenkabine\n(Inklusive Flug)', img: 'https://x/Platzhalter_keine_Karte.svg' }))!;
    expect(r).toMatchObject({ ship: 'Mein Schiff 1', nights: 14, pricePerPerson: 3349, flightIncluded: true, imageUrl: null, startDate: '2027-03-01', endDate: '2027-03-15', ports: [] });
  });

  it('puts a start date late in the year into the year before the end date', () => {
    const r = parseMeinSchiffCard(MS_CARD({ text: 'Mein Schiff 2\n7 Nächte - Weihnachten - ab/bis Kiel\nSa, 26.12.\nSa, 02.01.27\nab1.999 €p.P.' }))!;
    expect(r).toMatchObject({ startDate: '2026-12-26', endDate: '2027-01-02' });
  });

  it('copes with missing parts, and skips cards that are not trips', () => {
    const r = parseMeinSchiffCard(MS_CARD({ text: 'Mein Schiff Relax\n3 Nächte - Kurztrip\nreservieren' }))!;
    expect(r).toMatchObject({ startDate: null, endDate: null, pricePerPerson: null, nights: 3, ship: 'Mein Schiff Relax' });
    expect(parseMeinSchiffCard(MS_CARD({ text: 'Newsletter\nJetzt anmelden' }))).toBeNull();
  });

  it('removes the list tracking from the URL and keeps everything else', () => {
    expect(cleanMeinSchiffUrl(MS_CARD().href)).not.toMatch(/list_/);
    expect(cleanMeinSchiffUrl('/de/trips/x-MSA1?tariff=PLUS&list_code=1')).toBe('https://www.meinschiff.com/de/trips/x-MSA1?tariff=PLUS');
    expect(RouteInputSchema.safeParse({ name: 'x', provider: 'mein-schiff', url: cleanMeinSchiffUrl(MS_CARD().href) }).success).toBe(true);
  });
});

describe('refine', () => {
  const all = [...aidaResults(AIDA_ITEMS), parseMeinSchiffCard(MS_CARD())!];

  it('filters by query and dates and sorts by departure (earliest first)', () => {
    expect(refine(all, {}).results.map((r) => r.startDate)).toEqual(['2026-12-12', '2027-02-13', '2027-03-04', '2027-03-13']);
    expect(refine(all, { query: 'kanaren' }).results.map((r) => r.startDate)).toEqual(['2026-12-12', '2027-03-04', '2027-03-13']);
    expect(refine(all, { query: 'norwegen', from: '2027-01-01', to: '2027-03-01' }).results).toHaveLength(1);
    expect(refine(all, { query: 'avidanova' }).results).toEqual([]);
  });

  it('finds by ship and by port as well as by title', () => {
    expect(refine(all, { query: 'aidanova' }).results.map((r) => r.ship)).toEqual(['AIDAnova']);
    expect(refine(all, { query: 'stavanger' }).results).toHaveLength(1);
    expect(refine(all, { query: 'mein schiff 7' }).results).toHaveLength(1);
  });

  it('limits the result but reports the total; the limit is between 1 and 100', () => {
    expect(refine(all, { limit: 2 })).toMatchObject({ total: 4, results: expect.any(Array) });
    expect(refine(all, { limit: 2 }).results).toHaveLength(2);
    expect(refine(all, { limit: 0 }).results).toHaveLength(1);
    expect(refine(Array.from({ length: 150 }, () => all[0]!), { limit: 1000 }).results).toHaveLength(100);
  });
});

/** A browser double: the pages are what the real pages evaluate to. */
function fakeBrowser(handlers: { evaluate: (call: number) => unknown }) {
  let calls = 0;
  const page = {
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForSelector: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    getByRole: vi.fn(() => ({ first: () => ({ click: async () => undefined }) })),
    mouse: { wheel: vi.fn(async () => undefined) },
    evaluate: vi.fn(async () => handlers.evaluate(calls++)),
  } as unknown as Page;
  const close = vi.fn(async () => undefined);
  const browser = { newPage: vi.fn(async () => page), close } as unknown as Browser;
  const launch = vi.fn(async () => browser);
  const factory: BrowserFactory = { launch };
  const wheel = (page as unknown as { mouse: { wheel: ReturnType<typeof vi.fn> } }).mouse.wheel;
  return { factory, page: page as unknown as Record<string, ReturnType<typeof vi.fn>>, wheel, close, launch };
}

describe('searchRoutes', () => {
  it('searches AIDA in a visible browser through the site\'s own search, then filters', async () => {
    const b = fakeBrowser({ evaluate: () => ({ items: AIDA_ITEMS, capped: false }) });
    const out = await searchRoutes('aida', { query: 'kanaren', from: '2027-01-01', to: '2027-12-31' }, { browserFactory: b.factory });
    expect(b.launch).toHaveBeenCalledWith({ headless: false });
    expect(b.page.goto).toHaveBeenCalledWith('https://aida.de/finden', expect.anything());
    expect(out).toMatchObject({ provider: 'aida', total: 1, capped: false });
    expect(out.results[0]).toMatchObject({ ship: 'AIDAcosma', startDate: '2027-03-13' });
    expect(b.close).toHaveBeenCalled();
  });

  it('gives the AIDA page generous time (3 minutes to load, 2 minutes per request) and tries a second time before it gives up', async () => {
    expect(AIDA_TIMEOUTS).toMatchObject({ navigationMs: 180_000, requestMs: 120_000, attempts: 2 });
    expect(AIDA_TIMEOUTS.settleMs).toBeGreaterThanOrEqual(15_000);
    let tries = 0;
    const b = fakeBrowser({ evaluate: () => { if (++tries === 1) throw new Error('Timeout 180000ms exceeded'); return { items: AIDA_ITEMS, capped: false }; } });
    const out = await searchRoutes('aida', { query: 'norwegen' }, { browserFactory: b.factory });
    expect(out.total).toBe(1);
    expect(b.page.goto).toHaveBeenCalledTimes(2);
    expect(b.page.goto).toHaveBeenCalledWith('https://aida.de/finden', expect.objectContaining({ timeout: 180_000 }));
    expect(b.page.waitForLoadState).toHaveBeenCalledWith('networkidle', expect.objectContaining({ timeout: AIDA_TIMEOUTS.settleMs }));
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it('reports the last error when both AIDA attempts fail', async () => {
    const b = fakeBrowser({ evaluate: () => { throw new Error('Timeout 120000ms exceeded'); } });
    await expect(searchRoutes('aida', {}, { browserFactory: b.factory })).rejects.toThrow('Timeout 120000ms exceeded');
    expect(b.page.goto).toHaveBeenCalledTimes(AIDA_TIMEOUTS.attempts);
  });

  it('gives Mein Schiff two minutes to load and one minute for the first cards', async () => {
    expect(MEIN_SCHIFF_TIMEOUTS).toEqual({ navigationMs: 120_000, cardsMs: 60_000 });
    const b = fakeBrowser({ evaluate: () => [MS_CARD()] });
    await searchRoutes('mein-schiff', {}, { browserFactory: b.factory });
    expect(b.page.goto).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 120_000 }));
    expect(b.page.waitForSelector).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 60_000 }));
  });

  it('searches Mein Schiff headless with the date range in the URL, and scrolls until nothing new loads', async () => {
    const cards = [MS_CARD(), MS_CARD({ href: MS_CARD().href.replace('MSI2709SEE', 'OTHER'), text: 'Mein Schiff 1\n14 Nächte - Karibik - ab/bis La Romana\nMi, 03.03.\nMi, 17.03.27\nab2.899 €p.P.' })];
    const b = fakeBrowser({ evaluate: (call) => (call === 0 ? [cards[0]] : cards) });
    const out = await searchRoutes('mein-schiff', { query: 'kanaren', from: '2027-03-01', to: '2027-03-31' }, { browserFactory: b.factory });
    expect(b.launch).toHaveBeenCalledWith({ headless: true });
    expect(b.page.goto).toHaveBeenCalledWith(expect.stringContaining('datesSelection=2027-03-01%2C2027-03-31'), expect.anything());
    expect(b.wheel).toHaveBeenCalled();
    expect(out.results.map((r) => r.ship)).toEqual(['Mein Schiff 7']);
    expect(out).toMatchObject({ total: 1, capped: false });
    expect(b.close).toHaveBeenCalled();
  });

  it('opens the list without a date range when none is given, and reports when the card cap stopped it', async () => {
    const many = Array.from({ length: MAX_CARDS }, (_, i) => MS_CARD({ href: `https://www.meinschiff.com/de/trips/t-${i}`, text: `Mein Schiff 1\n7 Nächte - Reise ${i} - ab/bis Kiel\nMo, 01.03.\nMo, 08.03.27\nab999 €p.P.` }));
    const b = fakeBrowser({ evaluate: () => many });
    const out = await searchRoutes('mein-schiff', { limit: 5 }, { browserFactory: b.factory });
    expect(b.page.goto).toHaveBeenCalledWith('https://www.meinschiff.com/de/trips', expect.anything());
    expect(out).toMatchObject({ capped: true, total: MAX_CARDS });
    expect(out.results).toHaveLength(5);
  });

  it('closes the browser even when the website fails', async () => {
    const b = fakeBrowser({ evaluate: () => { throw new Error('AIDA search answered 403'); } });
    await expect(searchRoutes('aida', {}, { browserFactory: b.factory })).rejects.toThrow('403');
    expect(b.close).toHaveBeenCalled();
  });

  it('answers from a fixed catalogue in mock mode, without a browser', async () => {
    const b = fakeBrowser({ evaluate: () => [] });
    const aida = await searchRoutes('aida', { query: 'kanaren' }, { mode: 'mock', browserFactory: b.factory });
    expect(aida.results.map((r) => r.provider)).toEqual(['aida', 'aida']);
    expect(aida.results.every((r) => /kanaren/i.test(r.title))).toBe(true);
    const ms = await searchRoutes('mein-schiff', { from: '2027-06-01' }, { mode: 'mock' });
    expect(ms.results.map((r) => r.ship)).toEqual(['Mein Schiff Relax']);
    expect(b.launch).not.toHaveBeenCalled();
    for (const r of MOCK_CATALOG) expect(RouteInputSchema.safeParse({ name: r.title, provider: r.provider, url: r.url }).success).toBe(true);
  });
});

/** A cache in memory, like the store in the data directory. */
function memoryCache(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  const cache: SearchCache & { data: Map<string, unknown> } = {
    data,
    read: vi.fn(async (key: string) => data.get(key) ?? null),
    write: vi.fn(async (key: string, entry: unknown) => void data.set(key, entry)),
    prune: vi.fn(async () => 0),
  };
  return cache;
}

describe('search cache', () => {
  const at = (iso: string) => () => new Date(iso);
  const aidaBrowser = () => fakeBrowser({ evaluate: () => ({ items: AIDA_ITEMS, capped: false }) });

  it('keys AIDA once, and Mein Schiff by the period that was read', () => {
    expect(cacheKeyOf('aida', { query: 'x', from: '2027-01-01' })).toBe('aida');
    expect(cacheKeyOf('mein-schiff', { from: '2027-03-01', to: '2027-03-31' })).toBe('mein-schiff_2027-03-01_2027-03-31');
    expect(cacheKeyOf('mein-schiff', {})).toBe('mein-schiff_any_any');
    expect(SEARCH_CACHE_TTL_MS).toBe(12 * 60 * 60_000);
  });

  it('keeps everything the website showed, and answers the next search from it without a browser, with other filters', async () => {
    const cache = memoryCache();
    const first = aidaBrowser();
    const fresh = await searchRoutes('aida', { query: 'kanaren' }, { browserFactory: first.factory, cache, now: at('2026-11-19T08:00:00Z') });
    expect(fresh.cachedAt).toBeNull();
    expect(first.launch).toHaveBeenCalledTimes(1);
    expect(cache.write).toHaveBeenCalledTimes(1);
    const stored = cache.data.get('aida') as { fetchedAt: string; results: unknown[] };
    expect(stored.fetchedAt).toBe('2026-11-19T08:00:00.000Z');
    expect(stored.results).toHaveLength(3); // the unfiltered list, not only the 'kanaren' hits

    const second = aidaBrowser();
    const again = await searchRoutes('aida', { query: 'norwegen' }, { browserFactory: second.factory, cache, now: at('2026-11-19T19:59:00Z') }); // 11 h 59 min later
    expect(second.launch).not.toHaveBeenCalled();
    expect(again).toMatchObject({ cachedAt: '2026-11-19T08:00:00.000Z', total: 1 });
    expect(again.results[0]!.title).toBe('Südnorwegen ab Hamburg');
  });

  it('reads the website again after twelve hours, or when asked to', async () => {
    const cache = memoryCache();
    await searchRoutes('aida', {}, { browserFactory: aidaBrowser().factory, cache, now: at('2026-11-19T08:00:00Z') });
    const late = aidaBrowser();
    const afterTtl = await searchRoutes('aida', {}, { browserFactory: late.factory, cache, now: at('2026-11-19T20:00:01Z') });
    expect(late.launch).toHaveBeenCalledTimes(1);
    expect(afterTtl.cachedAt).toBeNull();
    expect((cache.data.get('aida') as { fetchedAt: string }).fetchedAt).toBe('2026-11-19T20:00:01.000Z');

    const forced = aidaBrowser();
    await searchRoutes('aida', { refresh: true }, { browserFactory: forced.factory, cache, now: at('2026-11-19T20:05:00Z') });
    expect(forced.launch).toHaveBeenCalledTimes(1);
    const custom = aidaBrowser();
    await searchRoutes('aida', {}, { browserFactory: custom.factory, cache, ttlMs: 60_000, now: at('2026-11-19T20:07:00Z') }); // a minute is over: the entry of 20:05 is too old
    expect(custom.launch).toHaveBeenCalledTimes(1);
  });

  it('caches Mein Schiff per period, and only reuses it when it holds enough cards for the new search', async () => {
    const cards = [MS_CARD()];
    const cache = memoryCache();
    const run = (criteria: Parameters<typeof searchRoutes>[1], b = fakeBrowser({ evaluate: () => cards })) => searchRoutes('mein-schiff', criteria, { browserFactory: b.factory, cache, now: at('2026-11-19T08:00:00Z') }).then((out) => ({ out, b }));
    const march = await run({ from: '2027-03-01', to: '2027-03-31', limit: 5 });
    expect(march.b.launch).toHaveBeenCalledTimes(1);
    expect(cache.data.has('mein-schiff_2027-03-01_2027-03-31')).toBe(true);

    expect((await run({ from: '2027-03-01', to: '2027-03-31', limit: 3 })).b.launch).not.toHaveBeenCalled(); // same period, no more cards needed
    expect((await run({ from: '2027-04-01', to: '2027-04-30', limit: 5 })).b.launch).toHaveBeenCalledTimes(1); // another period
    const withQuery = await run({ query: 'kanaren', from: '2027-03-01', to: '2027-03-31' }); // a text search needs many more cards than were loaded
    expect(withQuery.b.launch).toHaveBeenCalledTimes(1);
    expect((await run({ query: 'norwegen', from: '2027-03-01', to: '2027-03-31' })).b.launch).not.toHaveBeenCalled(); // now the many cards are there
    expect((await run({ from: '2027-03-01', to: '2027-03-31', limit: 40 })).b.launch).not.toHaveBeenCalled();
  });

  it('cachedRouteSearch answers from the cache or says null, and never opens a browser', async () => {
    const cache = memoryCache();
    expect(await cachedRouteSearch('aida', {}, { cache })).toBeNull();
    await searchRoutes('aida', {}, { browserFactory: aidaBrowser().factory, cache, now: at('2026-11-19T08:00:00Z') });
    expect(await cachedRouteSearch('aida', { query: 'kanaren' }, { cache, now: at('2026-11-19T09:00:00Z') })).toMatchObject({ total: 2, cachedAt: '2026-11-19T08:00:00.000Z' });
    expect(await cachedRouteSearch('aida', { refresh: true }, { cache, now: at('2026-11-19T09:00:00Z') })).toBeNull();
    expect(await cachedRouteSearch('aida', {}, { cache, now: at('2026-11-20T09:00:00Z') })).toBeNull();
    expect(await cachedRouteSearch('aida', {}, {})).toBeNull(); // no cache at all
  });

  it('ignores a damaged entry, a cache from the future, and a cache that cannot be read or written', async () => {
    for (const bad of [null, 'text', { fetchedAt: 'yesterday', results: [], capped: false, wanted: 0 }, { fetchedAt: '2026-11-19T08:00:00Z', results: 'no', capped: false, wanted: 0 }, { fetchedAt: '2026-11-19T08:00:00Z', results: [], capped: false }, { fetchedAt: '2030-01-01T00:00:00Z', results: [], capped: false, wanted: 0 }]) {
      const b = aidaBrowser();
      const out = await searchRoutes('aida', {}, { browserFactory: b.factory, cache: memoryCache({ aida: bad }), now: at('2026-11-19T09:00:00Z') });
      expect(b.launch).toHaveBeenCalledTimes(1);
      expect(out.total).toBe(3);
    }
    const broken: SearchCache = { read: async () => { throw new Error('disk gone'); }, write: async () => { throw new Error('disk full'); }, prune: async () => { throw new Error('nope'); } };
    expect((await searchRoutes('aida', {}, { browserFactory: aidaBrowser().factory, cache: broken })).total).toBe(3); // the search still works
  });

  it('removes old entries after writing, and leaves the mock catalogue alone', async () => {
    const cache = memoryCache();
    await searchRoutes('aida', {}, { browserFactory: aidaBrowser().factory, cache, now: at('2026-11-19T08:00:00Z') });
    expect(cache.prune).toHaveBeenCalledWith(2 * SEARCH_CACHE_TTL_MS, Date.parse('2026-11-19T08:00:00Z'));
    const mock = memoryCache();
    await searchRoutes('aida', {}, { mode: 'mock', cache: mock });
    expect(mock.read).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
  });
});

describe('findAidaItinerary', () => {
  const ports = [
    { code: 'ESLPA', name: 'LAS PALMAS', arrivalDateTime: null, departureDateTime: '2027-01-10T18:00:00' },
    { code: 'SEE', name: null, arrivalDateTime: null, departureDateTime: null },
    { code: 'ESSPC', name: 'SANTA CRUZ DE LA PALMA', arrivalDateTime: '2027-01-12T08:00:00', departureDateTime: '2027-01-12T17:00:00' },
  ];
  const items: AidaItem[] = [
    { title: 'Other', ports: [], cruiseItemVariant: [{ journeyIdentifier: 'X1', startDate: '2027-02-01' }] },
    { title: 'Kanaren', ports, cruiseItemVariant: [{ journeyIdentifier: 'J1', startDate: '2027-01-10' }, { journeyIdentifier: 'J2', startDate: '2027-01-24' }] },
  ];
  const pageWith = (evaluate: () => unknown) =>
    ({ goto: vi.fn(async () => undefined), waitForLoadState: vi.fn(async () => undefined), evaluate: vi.fn(async () => evaluate()) }) as unknown as Page;

  it('returns the stops of the item that has the journey', async () => {
    const stops = await findAidaItinerary(pageWith(() => ({ items, capped: false })), 'J1');
    expect(stops).toHaveLength(3);
    expect(stops![0]).toMatchObject({ code: 'ESLPA', departure: '2027-01-10T18:00:00' });
    expect(stops![1]).toMatchObject({ seaDay: true });
  });

  it('shifts the times of a later sailing to its own start date', async () => {
    const stops = await findAidaItinerary(pageWith(() => ({ items, capped: false })), 'J2');
    expect(stops![0]!.departure).toBe('2027-01-24T18:00:00');
    expect(stops![2]).toMatchObject({ arrival: '2027-01-26T08:00:00', departure: '2027-01-26T17:00:00' });
  });

  it('returns null for an unknown journey', async () => {
    expect(await findAidaItinerary(pageWith(() => ({ items, capped: false })), 'NOPE')).toBeNull();
  });
});
