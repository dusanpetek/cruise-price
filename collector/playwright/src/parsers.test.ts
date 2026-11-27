import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAidaCruiseDetail } from './parsers/aida';
import { parseMeinSchiffItinerary } from './parsers/meinSchiffItinerary';
import { parseCabins, parseDateRange, parseGuests, parseMeinSchiffCruiseInfo, parseTotal } from './parsers/meinSchiff';
import { nightsBetween, normalizeText, parseEuro, parseGermanDate } from './parsers/text';
import { loadAidaSelectors, loadMeinSchiffSelectors, AidaSelectorsSchema, LocatorSpecSchema, MeinSchiffSelectorsSchema } from './selectors';
import { locate } from './selectors/locate';

// Captured from the live "Reise anpassen" dialog (visible text), trimmed.
const dialogText = readFileSync(new URL('./__fixtures__/meinSchiffDialog.txt', import.meta.url), 'utf8');
const ms = loadMeinSchiffSelectors();

describe('text parsers', () => {
  it.each([
    ['1.239 €', 1239],
    ['ab 849 €', 849],
    ['1.234,50 €', 1234.5],
    ['6.999 €', 6999],
    ['p. P. 12 €', 12],
  ])('parseEuro(%j) = %d', (text, expected) => {
    expect(parseEuro(text)).toBe(expected);
  });

  it('parseEuro rejects text without an amount', () => {
    expect(() => parseEuro('kostenlos')).toThrow(/No amount/);
  });

  it('parses German dates and night counts', () => {
    expect(parseGermanDate('vom 13.03.2027 bis')).toBe('2027-03-13');
    expect(() => parseGermanDate('soon')).toThrow(/No date/);
    expect(nightsBetween('2027-03-13', '2027-03-20')).toBe(7);
  });

  it('normalises visible text', () => {
    expect(normalizeText('  a b \n\n  c  \n')).toBe('a b\nc');
  });
});

describe('AIDA cruise detail', () => {
  it('maps the detail.cruise.json payload', () => {
    expect(parseAidaCruiseDetail({ title: 'Kanaren', ship: 'AIDAcosma', startDate: '13.03.2027', endDate: '20.03.2027', duration: 7, extra: 1 })).toEqual({
      name: 'Kanaren',
      ship: 'AIDAcosma',
      departure: '2027-03-13',
      durationNights: 7,
    });
  });

  it('derives the duration from the dates and tolerates missing fields', () => {
    expect(parseAidaCruiseDetail({ startDate: '13.03.2027', endDate: '20.03.2027' }).durationNights).toBe(7);
    expect(parseAidaCruiseDetail({})).toEqual({ name: null, ship: null, departure: null, durationNights: null });
  });

  it('rejects a payload of the wrong shape', () => {
    expect(() => parseAidaCruiseDetail({ duration: 'seven' })).toThrow();
  });
});

describe('Mein Schiff dialog parsing', () => {
  it('reads every cabin card, with and without the "mit Flug ab" line', () => {
    expect(parseCabins(dialogText, ms.cabinPattern)).toEqual([
      { category: 'Innenkabine', pricePerPerson: 849, withFlightFrom: 1419 },
      { category: 'Außenkabine', pricePerPerson: 929, withFlightFrom: 1499 },
      { category: 'Junior Suite Balkon', pricePerPerson: 1899, withFlightFrom: 2469 },
      { category: 'Große Freiheit Suite', pricePerPerson: 6999, withFlightFrom: null },
    ]);
  });

  it('reads the total, the guests and the dates', () => {
    expect(parseTotal(dialogText, ms.totalPattern)).toBe(1698);
    expect(parseGuests(dialogText, ms.guestsPattern)).toBe(2);
    expect(parseDateRange(dialogText, ms.dateRangePattern)).toEqual({ departure: '2027-03-14', nights: 7 });
  });

  it('infers the previous year when a trip crosses New Year', () => {
    expect(parseDateRange('28.12. – 04.01.2027', ms.dateRangePattern)).toEqual({ departure: '2026-12-28', nights: 7 });
  });

  it('reports what is missing', () => {
    expect(parseCabins('nothing here', ms.cabinPattern)).toEqual([]);
    expect(() => parseTotal('nothing here', ms.totalPattern)).toThrow(/Gesamtpreis/);
    expect(() => parseGuests('nothing here', ms.guestsPattern)).toThrow(/Guest count/);
    expect(parseDateRange('nothing here', ms.dateRangePattern)).toBeNull();
  });

  it('builds cruise info from the title, ship and page text', () => {
    const info = parseMeinSchiffCruiseInfo(
      { title: ' 7 Nächte - Kanaren mit Madeira - ab/bis Las Palmas ', ship: 'Mein Schiff Relax', pageText: dialogText },
      ms,
    );
    expect(info).toEqual({ name: '7 Nächte - Kanaren mit Madeira - ab/bis Las Palmas', ship: 'Mein Schiff Relax', departure: '2027-03-14', durationNights: 7 });
    expect(parseMeinSchiffCruiseInfo({ title: null, ship: null, pageText: '' }, ms)).toEqual({ name: null, ship: null, departure: null, durationNights: null });
    expect(parseMeinSchiffCruiseInfo({ title: 'Reise', ship: null, pageText: '10.03. – 15.03.2027' }, ms).durationNights).toBe(5);
  });
});

describe('Mein Schiff itinerary', () => {
  // Captured 2026-11-27 from the "Reiseverlauf" dialog of the 7-night Canary Islands trip (visible text).
  const lines = normalizeText(readFileSync(new URL('./__fixtures__/meinSchiffItinerary.txt', import.meta.url), 'utf8')).split('\n');
  const port = (name: string, arrival: string | null, departure: string | null) => ({ code: null, name, seaDay: false, arrival, departure });
  const sea = { code: null, name: null, seaDay: true, arrival: null, departure: null };

  it('reads every port and sea day in order with local times', () => {
    expect(parseMeinSchiffItinerary(lines)).toEqual([
      port('Las Palmas (Gran Canaria)', '2027-03-14T04:30:00', '2027-03-14T22:00:00'),
      sea,
      port('Funchal (Madeira)', '2027-03-16T07:00:00', '2027-03-16T22:00:00'),
      sea,
      port('Santa Cruz (La Palma)', '2027-03-18T08:00:00', '2027-03-18T18:00:00'),
      port('Santa Cruz (Teneriffa)', '2027-03-19T04:30:00', '2027-03-19T22:30:00'),
      port('Arrecife (Lanzarote)', '2027-03-20T09:00:00', '2027-03-20T19:00:00'),
      port('Las Palmas (Gran Canaria)', '2027-03-21T04:30:00', '2027-03-21T22:00:00'),
    ]);
  });

  it('does not take the neighbouring ports listed under a sea day as stops', () => {
    expect(parseMeinSchiffItinerary(lines).filter((s) => s.seaDay)).toHaveLength(2);
  });

  it('keeps a port without stated times, in order, with null times', () => {
    const noTimes = ['Reiseverlauf', 'Anreise', 'So., 14. März 2027', 'Las Palmas (Gran Canaria)', 'Tag 1', 'Mo., 15. März 2027', 'Seetag', 'Tag 2', 'Di., 16. März 2027', 'Funchal (Madeira)'];
    expect(parseMeinSchiffItinerary(noTimes)).toEqual([port('Las Palmas (Gran Canaria)', null, null), sea, port('Funchal (Madeira)', null, null)]);
  });

  it('never takes a time or a footnote after Ankunft/Abfahrt for a port', () => {
    const day = (...rest: string[]) => ['Anreise', 'So., 14. März 2027', 'Las Palmas (Gran Canaria)', ...rest];
    // times in other formats than HH:MM
    expect(parseMeinSchiffItinerary(day('Ankunft', '04:30 Uhr', 'Abfahrt', '4:30 PM'))).toEqual([port('Las Palmas (Gran Canaria)', null, null)]);
    // a stray time line without a label
    expect(parseMeinSchiffItinerary(day('04:30 Uhr'))).toEqual([port('Las Palmas (Gran Canaria)', null, null)]);
    // a footnote while a label still waits for its time is ignored, the time after it is still used
    expect(parseMeinSchiffItinerary(day('Ankunft', '* Änderungen vorbehalten', '04:30', 'Abfahrt', '22:00'))).toEqual([
      port('Las Palmas (Gran Canaria)', '2027-03-14T04:30:00', '2027-03-14T22:00:00'),
    ]);
  });

  it('leaves the times null when the day cannot be dated', () => {
    const undated = ['Anreise', 'So., 14. Foo 2027', 'Las Palmas (Gran Canaria)', 'Ankunft', '04:30', 'Abfahrt', '22:00'];
    expect(parseMeinSchiffItinerary(undated)).toEqual([port('Las Palmas (Gran Canaria)', null, null)]);
  });

  it('returns no stops for text without an itinerary', () => {
    expect(parseMeinSchiffItinerary(['Reiseverlauf'])).toEqual([]);
  });
});

describe('selector registry', () => {
  it('loads and validates both provider files', () => {
    expect(loadAidaSelectors().provider).toBe('aida');
    expect(loadMeinSchiffSelectors().provider).toBe('mein-schiff');
  });

  it('configures the FRA airport for both providers', () => {
    expect(loadAidaSelectors().flightOptions.FRA).toBeDefined();
    expect(loadMeinSchiffSelectors().airportOptions.FRA).toBeDefined();
  });

  it('rejects broken registry files', () => {
    expect(LocatorSpecSchema.safeParse({}).success).toBe(false);
    expect(AidaSelectorsSchema.safeParse({ provider: 'aida' }).success).toBe(false);
    expect(MeinSchiffSelectorsSchema.safeParse({ ...ms, cabinPattern: '(' }).success).toBe(false);
  });
});

describe('locate', () => {
  const scope = () => {
    const calls: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    for (const name of ['getByRole', 'getByText', 'locator', 'filter']) {
      chain[name] = (...args: unknown[]) => (calls.push([name, ...args]), chain);
    }
    return { scope: chain as never, calls };
  };

  it('uses getByRole with an accessible-name regex', () => {
    const { scope: s, calls } = scope();
    locate(s, { role: 'button', name: 'Zustimmen' });
    expect(calls).toEqual([['getByRole', 'button', { name: /Zustimmen/i }]]);
  });

  it('uses css, optionally narrowed by text', () => {
    const a = scope();
    locate(a.scope, { css: 'li.card' });
    expect(a.calls).toEqual([['locator', 'li.card']]);
    const b = scope();
    locate(b.scope, { css: 'h2', text: '^Mein Schiff' });
    expect(b.calls).toEqual([['locator', 'h2'], ['filter', { hasText: /^Mein Schiff/i }]]);
  });

  it('falls back to text and to a bare role', () => {
    const a = scope();
    locate(a.scope, { text: 'Flug ab/bis' });
    expect(a.calls).toEqual([['getByText', /Flug ab\/bis/i]]);
    const b = scope();
    locate(b.scope, { role: 'option' });
    expect(b.calls).toEqual([['getByRole', 'option', {}]]);
  });
});
