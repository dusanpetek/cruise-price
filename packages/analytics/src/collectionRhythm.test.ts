import { describe, expect, it } from 'vitest';
import { FAR_FUTURE_INTERVAL_DAYS, FAR_FUTURE_MONTHS, addDays, addMonths, isFarFuture } from './collectionRhythm';

describe('collection rhythm: how far away a cruise is', () => {
  it('uses six months and one week', () => {
    expect([FAR_FUTURE_MONTHS, FAR_FUTURE_INTERVAL_DAYS]).toEqual([6, 7]);
  });

  it('adds months to a calendar day, ending on the last day of a shorter month', () => {
    expect(addMonths('2026-11-20', 6)).toBe('2027-05-20');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('adds days over month and year ends', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2026-11-20', 0)).toBe('2026-11-20');
  });

  it('is "far" when the departure is more than six months after today; exactly six months, unknown or past is not', () => {
    expect(isFarFuture('2027-05-21', '2026-11-20')).toBe(true);
    expect(isFarFuture('2028-01-01T00:00:00Z', '2026-11-20')).toBe(true);
    expect(isFarFuture('2027-05-20', '2026-11-20')).toBe(false);
    expect(isFarFuture('2026-01-01', '2026-11-20')).toBe(false);
    expect(isFarFuture(null, '2026-11-20')).toBe(false);
    expect(isFarFuture(undefined, '2026-11-20')).toBe(false);
  });
});
