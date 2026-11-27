import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CollectedCruise } from './collection/types';
import { SnapshotInputSchema } from '@cruise/domain';
import { buildSnapshotInput } from './collection/snapshotBuilder';
import {
  aidaJourneyId,
  buildMeinSchiffFares,
  deriveFlags,
  fillPattern,
  fillUrl,
  parseAidaAllInStep,
  parseAidaCabinCodes,
  parseAidaFareStep,
  toFareOption,
  type TariffColumn,
} from './parsers/fares';
import { loadAidaSelectors, loadMeinSchiffSelectors } from './selectors';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const aida = loadAidaSelectors();
const ms = loadMeinSchiffSelectors();

describe('AIDA fare step (real page text)', () => {
  it('reads every fare of the balcony cabin with its party price, services and ALL IN upgrade', () => {
    const blocks = parseAidaFareStep(fixture('aidaFareStep-B.txt'), aida.fareStep);
    expect(blocks.map((b) => [b.name, b.available, b.cruisePrice, b.allInName])).toEqual([
      ['CLASSIC', true, 2058, 'CLASSIC ALL IN'],
      ['PREMIUM', true, 2190, 'PREMIUM ALL IN'],
      ['COMFORT ALL IN', true, 2980, null],
    ]);
    const premium = blocks[1]!;
    expect(premium.services).toContain('Wunschkabine');
    expect(premium.services).toContain('Einmalig auf einen neuen Reisetermin, oder ein anderes Zielgebiet oder Schiff umbuchen');
    expect(premium.services.length).toBe(10);
    expect(blocks[0]!.services).toEqual(['Wahl der Kabinenkategorie', 'Speisen in allen Buffet-Restaurants inklusive', 'Speisen in allen Spezialitäten-Restaurants inklusive', 'Ausgewählte Getränke in den Buffet-Restaurants', 'Alle AIDA Inklusivleistungen']);
  });

  it('works for the inside cabin, where COMFORT ALL IN is not offered', () => {
    const blocks = parseAidaFareStep(fixture('aidaFareStep-I.txt'), aida.fareStep);
    expect(blocks.map((b) => [b.name, b.available, b.cruisePrice])).toEqual([['CLASSIC', true, 1298], ['PREMIUM', true, 1450], ['COMFORT ALL IN', false, null]]);
  });

  it('marks a fare that is not available (CLASSIC on suites) and keeps the others', () => {
    const blocks = parseAidaFareStep(fixture('aidaFareStep-S.txt'), aida.fareStep);
    expect(blocks.map((b) => [b.name, b.available, b.cruisePrice])).toEqual([['CLASSIC', false, null], ['PREMIUM', true, 4920], ['COMFORT ALL IN', true, 5710]]);
  });

  it('returns nothing for a page that is not the fare step', () => {
    expect(parseAidaFareStep('Startseite\nKreuzfahrten', aida.fareStep)).toEqual([]);
    expect(parseAidaFareStep('Wählen Sie einen Tarif', aida.fareStep)).toEqual([]);
  });

  it('reads the ALL IN upgrade: its price and what it adds', () => {
    const up = parseAidaAllInStep(fixture('aidaAllInStep.txt'), aida.allInStep);
    expect(up.cruisePrice).toBe(2590);
    expect(up.services).toEqual([
      'Getränkepaket ALL IN (ab 25 J.) bzw. Kids & Teens ALL IN (2 bis 24 J.)',
      'Alkoholfreie Cocktails',
      'Ausgewählte Softdrinks und Säfte',
      'Heißgetränke',
      'Kids & Teens Drinks sowie Milchshakes',
      'Cocktails & Mixgetränke (mit Alkohol)',
      'Spritz-Getränke',
      'Frisch gezapfte Biere & Flaschenbier',
      'Wein & Sekt im Glas',
      'Alkoholfreie Sprizz-Getränke',
      'Kaffeespezialitäten',
    ]);
    expect(parseAidaAllInStep('nothing', aida.allInStep)).toEqual({ cruisePrice: null, services: [] });
  });

  it('reads cabin codes and the journey id for the deep links', () => {
    expect(parseAidaCabinCodes({ cabinItemsVariant: [{ cabinCode: 'I', cabinName: 'Innenkabine' }, { cabinCode: 'B', cabinName: 'Balkonkabine' }, { nope: 1 }] })).toEqual([{ code: 'I', name: 'Innenkabine' }, { code: 'B', name: 'Balkonkabine' }]);
    expect(parseAidaCabinCodes(null)).toEqual([]);
    expect(parseAidaCabinCodes({ cabinItemsVariant: 'x' })).toEqual([]);
    expect(aidaJourneyId('https://aida.de/finden/CO07270313/CLASSIC?pax[adults]=2', aida.journeyPattern)).toBe('CO07270313');
    expect(aidaJourneyId('https://aida.de/other', aida.journeyPattern)).toBeNull();
  });

  it('builds the booking deep link and the select-fare pattern from the registry', () => {
    const url = fillUrl(aida.bookingUrl, { journey: 'CO07270313', adults: '2', cabin: 'B', airport: 'FRA' });
    expect(url).toBe('https://aida.de/buchen/CO07270313/CLASSIC/meine-reise/kabine?adults=2&juveniles=0&children=0&babies=0&cabin=B&flightType=air&depAirport=FRA&arrAirport=FRA');
    expect(fillPattern(aida.selectFare.text!, { fare: 'COMFORT (A+B)' })).toBe('^COMFORT \\(A\\+B\\) auswählen$');
    expect(new RegExp(fillPattern(aida.selectFare.text!, { fare: 'PREMIUM' }), 'i').test('PREMIUM auswählen')).toBe(true);
  });
});

describe('service flags', () => {
  const line = (text: string, included: boolean | null) => ({ text, included });

  it('reads cabin selection from the fare wording, and leaves refundability unknown when never mentioned', () => {
    expect(deriveFlags([line('Wunschkabine', true)], '', aida.serviceFlags)).toEqual({ selectableCabin: true, refundable: null });
    expect(deriveFlags([line('Wahl der Kabinenkategorie', true)], 'wir wählen Deck und Kabine für Sie aus', aida.serviceFlags)).toEqual({ selectableCabin: false, refundable: null });
    expect(deriveFlags([line('Speisen', true)], '', aida.serviceFlags)).toEqual({ selectableCabin: null, refundable: null });
  });

  it('reads refundability from a tick or a cross, and not from a limited "3 days" wording', () => {
    const f = (l: ReturnType<typeof line>[]) => deriveFlags(l, '', ms.serviceFlags).refundable;
    expect(f([line('Bis zu 50 Tage vor der Reise: Kostenfrei stornierbar', true)])).toBe(true);
    expect(f([line('Bis zu 50 Tage vor der Reise: Kostenfrei stornierbar', false)])).toBe(false);
    expect(f([line('Bis zu 50 Tage vor der Reise: 3 Tage kostenfrei stornierbar', true)])).toBeNull();
    expect(f([line('Kostenfrei stornierbar', null)])).toBeNull();
  });

  it('does not count an unticked service as included when looking for cabin selection', () => {
    expect(deriveFlags([line('Wunschkabine', false)], '', aida.serviceFlags).selectableCabin).toBeNull();
    expect(deriveFlags([line('Wunschkabine', null)], '', aida.serviceFlags).selectableCabin).toBeNull();
  });

  it('builds a fare option with included, excluded and unknown services kept apart', () => {
    const fare = toFareOption('mein-schiff', 'PLUS', [line('A', true), line('A', true), line('B', false), line('C', null)], '', ms.serviceFlags);
    expect(fare).toMatchObject({ fareCode: 'PLUS', fareName: 'PLUS', provider: 'mein-schiff', includedServices: ['A'], excludedServices: ['B'] });
  });
});

describe('Mein Schiff tariff tab', () => {
  // As read from the live tariff tab (services shortened).
  const columns: TariffColumn[] = [
    { name: 'PRO', text: 'PRO\nab 979 € p.P.\nTarif auswählen', items: [{ text: 'Kabinenkategorie und Nummer frei wählbar', mark: 'check' }, { text: 'Bis zu 50 Tage vor der Reise: Kostenfrei stornierbar', mark: 'check' }] },
    { name: 'PLUS', text: 'PLUS\nab 849 € p.P.\nTarif ausgewählt', items: [{ text: 'Innen-, Außen-, Balkon- oder Balkonkabine Plus wählbar', mark: 'check' }, { text: 'Frühbucher-Ermäßigung', mark: 'cross' }, { text: 'Bis zu 50 Tage vor der Reise: Kostenfrei stornierbar', mark: 'cross' }] },
    { name: 'PUR', text: 'PUR\nZur Zeit nicht verfügbar\nTarif auswählen', items: [{ text: 'Rail&Fly kostenlos', mark: 'cross' }, { text: 'Neues Icon', mark: 'unknown' }] },
  ];
  const drafts = buildMeinSchiffFares(columns, ms);

  it('turns the columns into fares with their availability and from-price', () => {
    expect(drafts.map((d) => [d.fare.fareCode, d.available, d.fromPricePerPerson])).toEqual([['PRO', true, 979], ['PLUS', true, 849], ['PUR', false, null]]);
  });

  it('reads prices the way the page writes them, with no-break spaces', () => {
    const [d] = buildMeinSchiffFares([{ name: 'PRO', text: 'PRO\nab 1.049\u00a0€ p.P.\nTarif auswählen', items: [] }], ms);
    expect(d).toMatchObject({ available: true, fromPricePerPerson: 1049 });
  });

  it('keeps ticked, crossed and unrecognised services apart', () => {
    expect(drafts[1]!.fare).toMatchObject({ includedServices: ['Innen-, Außen-, Balkon- oder Balkonkabine Plus wählbar'], excludedServices: ['Frühbucher-Ermäßigung', 'Bis zu 50 Tage vor der Reise: Kostenfrei stornierbar'] });
    expect(drafts[2]!.fare.includedServices).toEqual([]);
    expect(drafts[2]!.fare.excludedServices).toEqual(['Rail&Fly kostenlos']); // the unrecognised icon is neither
  });

  it('derives cabin selection and refundability from what the site says', () => {
    expect(drafts[0]!.fare).toMatchObject({ selectableCabin: true, refundable: true });
    expect(drafts[1]!.fare).toMatchObject({ selectableCabin: false, refundable: false });
    expect(drafts[2]!.fare).toMatchObject({ selectableCabin: null, refundable: null });
  });
});

describe('snapshot builder with fares', () => {
  const premium = toFareOption('aida', 'PREMIUM', [{ text: 'Wunschkabine', included: true }], '', aida.serviceFlags);
  const classic = toFareOption('aida', 'CLASSIC', [{ text: 'Wahl der Kabinenkategorie', included: true }], '', aida.serviceFlags);
  const unused = toFareOption('aida', 'COMFORT ALL IN', [], '', aida.serviceFlags);
  const collected: CollectedCruise = {
    currency: 'EUR',
    cruise: { name: 'N', ship: 'S', departure: '2027-03-13', durationNights: 7 },
    party: { adults: 2, departureAirport: 'FRA' },
    cabins: [
      { category: 'Balkonkabine', packagePerPerson: 1029, flightPerPerson: 590 },
      { category: 'Innenkabine', packagePerPerson: 649, flightPerPerson: 590 },
      { category: 'Suite', packagePerPerson: 2460, flightPerPerson: 590 },
    ],
    fares: [premium, classic, unused],
    options: [
      { cabinCategory: 'Balkonkabine', fareCode: 'PREMIUM', cruisePrice: 2190 },
      { cabinCategory: 'Balkonkabine', fareCode: 'CLASSIC', cruisePrice: 2058 },
      { cabinCategory: 'Innenkabine', fareCode: 'CLASSIC', cruisePrice: 1280 },
      { cabinCategory: 'Penthouse', fareCode: 'CLASSIC', cruisePrice: 9000 },
    ],
    warnings: ['Fares for Suite could not be read: timeout'],
  };
  const args = { routeId: 'r', provider: 'aida', source: 'live', collectedAt: '2026-01-01T00:00:00.000Z', collected } as const;
  const input = buildSnapshotInput(args);

  it('prices every option as cruise + flight = total, with the flight of its cabin', () => {
    expect(input.options).toContainEqual({ cabinCategory: 'Balkonkabine', subcategory: null, fareCode: 'PREMIUM', flightCode: 'FRA', cruisePerPerson: 1095, cruisePrice: 2190, flightPerPerson: 590, flightPrice: 1180, mandatoryFees: 0, tripPerPerson: 1685, totalPrice: 3370 });
    expect(input.options).toContainEqual({ cabinCategory: 'Innenkabine', subcategory: null, fareCode: 'CLASSIC', flightCode: 'FRA', cruisePerPerson: 640, cruisePrice: 1280, flightPerPerson: 590, flightPrice: 1180, mandatoryFees: 0, tripPerPerson: 1230, totalPrice: 2460 });
    expect(input.options!.every((o) => o.cruisePrice + o.flightPrice + (o.mandatoryFees ?? 0) === o.totalPrice)).toBe(true);
  });

  it('drops options for unknown cabins and fares nobody uses', () => {
    expect(input.options).toHaveLength(3);
    expect(input.fares!.map((f) => f.fareCode).sort()).toEqual(['CLASSIC', 'PREMIUM']);
  });

  it('makes each cabin\'s headline the cheapest fare, falling back to the card price with a warning', () => {
    expect(input.cabins!.find((c) => c.category === 'Balkonkabine')).toMatchObject({ packagePerPerson: 1029, packageTotal: 2058 });
    expect(input.cabins!.find((c) => c.category === 'Innenkabine')).toMatchObject({ packagePerPerson: 640, packageTotal: 1280 }); // cheaper fare than the card showed
    expect(input.cabins!.find((c) => c.category === 'Suite')).toMatchObject({ packagePerPerson: 2460, tripTotal: 6100 });
    expect(input.warnings).toEqual(['Fares for Suite could not be read: timeout', 'No fares collected for Suite']);
    expect(input).toMatchObject({ packagePrice: 1280, flightSurcharge: 1180 });
    expect(SnapshotInputSchema.parse(input).pricing).toEqual({ cruisePerPerson: 640, cruiseTotal: 1280, flightPerPerson: 590, flightTotal: 1180, mandatoryFees: 0, tripPerPerson: 1230, tripTotal: 2460 });
  });

  it('stays valid without any fare data: no options, no invented warnings', () => {
    const { fares: _f, options: _o, warnings: _w, ...plain } = collected;
    expect(buildSnapshotInput({ ...args, collected: plain })).toMatchObject({ fares: [], options: [], warnings: [], packagePrice: 1298 });
  });
});
