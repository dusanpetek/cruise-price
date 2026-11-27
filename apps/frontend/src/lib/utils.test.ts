import { afterAll, describe, expect, it } from 'vitest';
import { useUi } from '@/store/ui';
import { formatWeekdayDate, sortRoutes, stopLabel, tripDates } from './utils';

afterAll(() => useUi.setState({ language: 'de' }));

describe('trip dates with weekdays', () => {
  it('writes the weekday and the date in German', () => {
    useUi.setState({ language: 'de' });
    expect(formatWeekdayDate('2027-03-13')).toBe('Sa 13.03.2027');
    expect(formatWeekdayDate('2027-03-14')).toBe('So 14.03.2027');
    expect(formatWeekdayDate('2027-03-15')).toBe('Mo 15.03.2027');
  });

  it('writes them in English', () => {
    useUi.setState({ language: 'en' });
    expect(formatWeekdayDate('2027-03-13')).toBe('Sat 13/03/2027');
    expect(formatWeekdayDate('2027-03-15')).toBe('Mon 15/03/2027');
  });

  it('gives start and end: the end is the departure plus the nights, over month and year ends', () => {
    useUi.setState({ language: 'de' });
    expect(tripDates('2027-03-13', 7)).toEqual({ start: 'Sa 13.03.2027', end: 'Sa 20.03.2027' });
    expect(tripDates('2026-12-28', 7)).toEqual({ start: 'Mo 28.12.2026', end: 'Mo 04.01.2027' });
    expect(tripDates('2027-02-25', 5)).toEqual({ start: 'Do 25.02.2027', end: 'Di 02.03.2027' });
  });

  it('shows only the start without a duration, and nothing without a departure', () => {
    useUi.setState({ language: 'de' });
    expect(tripDates('2027-03-13', null)).toEqual({ start: 'Sa 13.03.2027', end: null });
    expect(tripDates(null, 7)).toBeNull();
  });

  it('accepts a full timestamp and is not shifted by the time of day', () => {
    useUi.setState({ language: 'de' });
    expect(formatWeekdayDate('2027-03-13T23:30:00.000Z')).toBe('Sa 13.03.2027');
  });
});

describe('weekday without full stop and comma', () => {
  it('is "Sa 13.03.2027" in German and "Sat 13/03/2027" in English, for every weekday', () => {
    for (const [lang, days] of [['de', ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']], ['en', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']]] as const) {
      useUi.setState({ language: lang });
      for (let d = 0; d < 7; d++) {
        const text = formatWeekdayDate(`2027-03-${14 + d}`);
        expect(text.startsWith(`${days[d]} `)).toBe(true);
        expect(text).not.toMatch(/[,]|\.\s/); // no comma, and no full stop after the weekday
      }
    }
  });
});

describe('sortRoutes: cruise line first, then departure', () => {
  const names: Record<string, string> = { aida: 'AIDA', 'mein-schiff': 'Mein Schiff' };
  const nameOf = (p: string) => names[p] ?? p;
  const r = (name: string, provider: string) => ({ name, provider });
  const departures: Record<string, string | null> = { A: '2027-05-01', B: '2027-03-01', C: null, D: '2027-01-10', E: '2027-01-10', F: '2027-02-02' };

  it('groups by cruise line (A-Z), then earliest departure first, routes without a date last, ties by name', () => {
    const sorted = sortRoutes([r('E', 'aida'), r('F', 'mein-schiff'), r('A', 'aida'), r('C', 'aida'), r('D', 'aida'), r('B', 'aida')], (x) => departures[x.name], nameOf);
    expect(sorted.map((x) => x.name)).toEqual(['D', 'E', 'B', 'A', 'C', 'F']);
  });

  it('keeps the input untouched and copes with nothing to sort', () => {
    const input = [r('B', 'mein-schiff'), r('A', 'aida')];
    expect(sortRoutes(input, () => undefined, nameOf).map((x) => x.name)).toEqual(['A', 'B']);
    expect(input.map((x) => x.name)).toEqual(['B', 'A']);
    expect(sortRoutes([], () => null, nameOf)).toEqual([]);
  });
});

describe('stopLabel', () => {
  const stop = { code: null, name: null, seaDay: false, arrival: null, departure: null };

  it('names a port, a sea day and a stop without a name', () => {
    useUi.setState({ language: 'en' });
    expect(stopLabel({ ...stop, name: 'Las Palmas' })).toBe('Las Palmas');
    expect(stopLabel({ ...stop, seaDay: true })).toBe('Sea day');
    expect(stopLabel(stop)).toBe('Unknown port');
    useUi.setState({ language: 'de' });
    expect(stopLabel({ ...stop, seaDay: true })).toBe('Seetag');
  });
});
