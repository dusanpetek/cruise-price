import { describe, expect, it } from 'vitest';
import { groupSeries } from './alerts';
import { LAST_MINUTE_MARKS, MIN_TIMING_SAMPLES, lastMinuteIntelligence, recommendBookingWindow } from './timing';
import { series as makeSeries } from './testing';

/** One collection per day from 2026-01-01; the departure is 100 days later (2026-04-11), so day d is 100 - d days before it. */
const DEPARTURE = '2026-04-11';
const obs = (days: number, price: (daysBefore: number) => number) => groupSeries(makeSeries(days, (d) => price(100 - d), DEPARTURE), null);
/** Cheap in the last two to three weeks before departure. */
const lastMinuteDeal = (daysBefore: number) => (daysBefore >= 11 && daysBefore <= 18 ? 800 : 1000);

describe('lastMinuteIntelligence', () => {
  it('finds when the lowest prices occurred: 11-18 days before departure', () => {
    const r = lastMinuteIntelligence(obs(90, lastMinuteDeal), DEPARTURE);
    expect(r.available).toBe(true);
    expect(r.lowestPrice).toBe(800);
    expect(r.lowestWindow).toEqual({ from: 11, to: 18 });
    expect(r.note).toBe('Historical lowest prices occurred 11-18 days before departure.');
  });

  it('tracks the price around 180/120/90/60/30/14/7 days before departure', () => {
    const r = lastMinuteIntelligence(obs(95, lastMinuteDeal), DEPARTURE);
    expect(r.marks.map((m) => m.daysBefore)).toEqual([...LAST_MINUTE_MARKS]);
    const at = (days: number) => r.marks.find((m) => m.daysBefore === days)!;
    expect(at(14).price).toBeLessThan(900); // the cheap stretch dominates the collections around 14 days
    expect(at(14).samples).toBeGreaterThan(3);
    expect(at(14).priceIndex).toBeLessThan(1);
    expect(at(60).price).toBe(1000);
    expect(at(180)).toMatchObject({ price: null, samples: 0, priceIndex: null }); // history starts 100 days before departure
  });

  it('reports the average price drop and rise between collections and the stability', () => {
    const zigzag = lastMinuteIntelligence(obs(60, (b) => (b % 2 === 0 ? 1000 : 1100)), DEPARTURE);
    expect(zigzag.avgDropPct).toBeCloseTo(9.09, 1);
    expect(zigzag.avgRisePct).toBeCloseTo(10, 1);
    expect(zigzag.volatilityPct).toBeGreaterThan(0);
    expect(zigzag.stabilityScore).toBeLessThan(100);
    const flat = lastMinuteIntelligence(obs(60, () => 1000), DEPARTURE);
    expect(flat).toMatchObject({ avgDropPct: null, avgRisePct: null, stabilityScore: 100 });
  });

  it('includes the best booking window', () => {
    const r = lastMinuteIntelligence(obs(90, lastMinuteDeal), DEPARTURE);
    expect(r.bestWindow).toEqual({ from: 10, to: 20 });
  });

  it('is unavailable without a departure date or with too little history', () => {
    const none = lastMinuteIntelligence(obs(90, lastMinuteDeal), null);
    expect(none).toMatchObject({ available: false, lowestWindow: null, bestWindow: null, note: 'No departure date known for this route.' });
    expect(none.marks).toHaveLength(LAST_MINUTE_MARKS.length);
    const few = lastMinuteIntelligence(obs(MIN_TIMING_SAMPLES - 1, lastMinuteDeal), DEPARTURE);
    expect(few.available).toBe(false);
    expect(few.note).toContain('at least 10 collections');
    expect(lastMinuteIntelligence([], DEPARTURE).stabilityScore).toBe(100);
  });

  it('ignores collections after the departure', () => {
    const r = lastMinuteIntelligence(groupSeries(makeSeries(120, (d) => (d > 100 ? 1 : 1000), DEPARTURE), null), DEPARTURE);
    expect(r.lowestPrice).toBe(1000);
  });
});

describe('recommendBookingWindow', () => {
  it('recommends the stretch around the historical lows, rounded outwards to 5 days', () => {
    const r = recommendBookingWindow(obs(90, lastMinuteDeal), DEPARTURE)!;
    expect(r).toMatchObject({ from: 10, to: 20, insideWindow: true, currentDaysBefore: 11 });
    expect(r.note).toBe('Recommended booking window: 10-20 days before departure.');
    expect(r.confidence).toBeGreaterThan(0.3);
    expect(r.confidence).toBeLessThanOrEqual(0.95);
    expect(r.basis).toMatchObject({ samples: 90, volatilityPct: expect.any(Number) });
    expect(r.basis.historicalLowDaysBefore).toBeGreaterThanOrEqual(11);
    expect(r.basis.historicalLowDaysBefore).toBeLessThanOrEqual(18);
  });

  it('is open when today is inside the window', () => {
    const r = recommendBookingWindow(obs(85, lastMinuteDeal), DEPARTURE)!; // last collection 16 days before departure
    expect(r.currentDaysBefore).toBe(16);
    expect(r.insideWindow).toBe(true);
    const missed = recommendBookingWindow(obs(99, lastMinuteDeal), DEPARTURE)!; // last collection 2 days before departure
    expect(missed.insideWindow).toBe(false);
  });

  it('is at least 10 days wide, even for a single cheap day', () => {
    const r = recommendBookingWindow(obs(90, (b) => (b === 40 ? 500 : 1000)), DEPARTURE)!;
    expect(r.to - r.from).toBeGreaterThanOrEqual(10);
    expect(r.from).toBeLessThanOrEqual(40);
    expect(r.to).toBeGreaterThanOrEqual(40);
  });

  it('reports whether the forecast agrees', () => {
    const base = obs(90, lastMinuteDeal);
    const f = (change: number, confidence = 0.9) => ({ currentPrice: 1000, forecast30Day: 1000 * (1 + change), confidence }) as never;
    expect(recommendBookingWindow(base, DEPARTURE, f(-0.1))!.basis.forecast).toBe('drop');
    expect(recommendBookingWindow(base, DEPARTURE, f(0.1))!.basis.forecast).toBe('rise');
    expect(recommendBookingWindow(base, DEPARTURE, f(0.01))!.basis.forecast).toBe('flat');
    expect(recommendBookingWindow(base, DEPARTURE, f(-0.1, 0.2))!.basis.forecast).toBe('unknown');
    expect(recommendBookingWindow(base, DEPARTURE, null)!.basis.forecast).toBe('unknown');
  });

  it('is null without a departure date or with too little history', () => {
    expect(recommendBookingWindow(obs(90, lastMinuteDeal), null)).toBeNull();
    expect(recommendBookingWindow(obs(5, lastMinuteDeal), DEPARTURE)).toBeNull();
  });
});
