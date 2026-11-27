import { describe, expect, it } from 'vitest';
import { makePricing, type CruiseSnapshot } from '@cruise/domain';
import { FAR_FUTURE_INTERVAL_DAYS, FAR_FUTURE_MONTHS, addDays, addMonths, isFarFuture, skipDecision } from './collection/frequency';

const snap = (day: string, departure: string | null, source: CruiseSnapshot['source'] = 'live'): CruiseSnapshot => ({
  schemaVersion: 5,
  id: `s-${day}-${source}`,
  routeId: 'r',
  provider: 'aida',
  collectedAt: `${day}T07:00:00.000Z`,
  source,
  currency: 'EUR',
  cruise: { name: null, ship: null, departure, durationNights: 7 },
  party: { adults: 2, departureAirport: 'FRA' },
  cabins: [],
  packagePrice: 1000,
  flightSurcharge: 0,
  pricing: makePricing({ passengers: 2, cruiseTotal: 1000 }),
  fares: [],
  options: [],
  warnings: [],
});

describe('calendar helpers', () => {
  it('adds months, ending on the last day of a shorter month', () => {
    expect(addMonths('2026-11-20', 6)).toBe('2027-05-20');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29'); // a leap year
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-20', 18)).toBe('2028-05-20');
  });

  it('adds days over month and year ends', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2027-02-25', 5)).toBe('2027-03-02');
    expect(addDays('2026-11-20', 0)).toBe('2026-11-20');
  });

  it('calls a cruise far in the future when it leaves more than six months from today (exactly six months is not more)', () => {
    expect([FAR_FUTURE_MONTHS, FAR_FUTURE_INTERVAL_DAYS]).toEqual([6, 7]);
    expect(isFarFuture('2027-05-21', '2026-11-20')).toBe(true);
    expect(isFarFuture('2027-05-20', '2026-11-20')).toBe(false);
    expect(isFarFuture('2027-03-13', '2026-11-20')).toBe(false);
    expect(isFarFuture('2026-12-01', '2026-11-20')).toBe(false);
    expect(isFarFuture('2028-01-01T00:00:00Z', '2026-11-20')).toBe(true);
    expect(isFarFuture(null, '2026-11-20')).toBe(false);
    expect(isFarFuture(undefined, '2026-11-20')).toBe(false);
  });
});

describe('skipDecision', () => {
  const today = '2026-11-20';

  it('collects a route that has no real price yet', () => {
    expect(skipDecision([], today)).toBeNull();
    expect(skipDecision([snap('2026-11-19', '2028-01-01', 'manual'), snap('2026-11-20', '2028-01-01', 'mock')], today)).toBeNull();
  });

  it('collects a cruise that leaves within six months once a day', () => {
    expect(skipDecision([snap('2026-11-20', '2027-03-13')], today)).toEqual({ reason: 'daily', lastDay: '2026-11-20', nextDay: '2026-11-21' });
    expect(skipDecision([snap('2026-11-19', '2027-03-13')], today)).toBeNull();
    expect(skipDecision([snap('2026-11-20', '2027-05-20')], today)?.reason).toBe('daily'); // exactly six months
  });

  it('collects a cruise that leaves in more than six months at most once a week', () => {
    const far = '2027-09-01';
    expect(skipDecision([snap('2026-11-20', far)], today)).toEqual({ reason: 'weekly', lastDay: '2026-11-20', nextDay: '2026-11-27' });
    expect(skipDecision([snap('2026-11-15', far)], today)).toEqual({ reason: 'weekly', lastDay: '2026-11-15', nextDay: '2026-11-22' });
    expect(skipDecision([snap('2026-11-14', far)], today)).toMatchObject({ reason: 'weekly', nextDay: '2026-11-21' }); // six days ago: tomorrow
    expect(skipDecision([snap('2026-11-13', far)], today)).toBeNull(); // seven days ago: due again
    expect(skipDecision([snap('2026-11-01', far)], today)).toBeNull();
    expect(skipDecision([snap('2026-11-15', far)], '2026-11-21')?.reason).toBe('weekly'); // still inside the week
    expect(skipDecision([snap('2026-11-15', far)], '2026-11-22')).toBeNull(); // the seventh day after: due
  });

  it('lifts only the weekly limit when asked to (a deliberate single collection), never the daily one', () => {
    const far = '2027-09-01';
    expect(skipDecision([snap('2026-11-17', far)], today, { ignoreWeekly: true })).toBeNull(); // three days ago: fine when forced
    expect(skipDecision([snap('2026-11-19', far)], today, { ignoreWeekly: true })).toBeNull(); // yesterday
    expect(skipDecision([snap('2026-11-20', far)], today, { ignoreWeekly: true })).toEqual({ reason: 'daily', lastDay: '2026-11-20', nextDay: '2026-11-21' }); // today: still no
    expect(skipDecision([snap('2026-11-17', far)], today, { ignoreWeekly: false })?.reason).toBe('weekly');
  });

  it('counts only the newest real price, and ignores failed attempts, manual and mock snapshots', () => {
    const far = '2027-09-01';
    expect(skipDecision([snap('2026-11-01', far), snap('2026-11-18', far, 'manual'), snap('2026-11-19', far, 'mock')], today)).toBeNull();
    expect(skipDecision([snap('2026-11-01', far), snap('2026-11-18', far)], today)).toMatchObject({ reason: 'weekly', lastDay: '2026-11-18', nextDay: '2026-11-25' });
  });

  it('follows the departure date of the newest snapshot that has one, and treats an unknown departure as near', () => {
    // it was far away when first collected; the date has moved closer (or the route was edited): the newest departure counts
    expect(skipDecision([snap('2026-11-10', '2027-09-01'), snap('2026-11-20', '2027-02-01')], today)?.reason).toBe('daily');
    expect(skipDecision([snap('2026-11-18', '2027-09-01'), snap('2026-11-19', null, 'manual')], today)?.reason).toBe('weekly'); // the manual one has no date
    expect(skipDecision([snap('2026-11-20', null)], today)?.reason).toBe('daily');
  });
});
