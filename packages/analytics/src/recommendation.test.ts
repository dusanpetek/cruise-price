import { describe, expect, it } from 'vitest';
import { groupSeries } from './alerts';
import { forecastSeries } from './forecast';
import { AVOID_ABOVE_PCT, RECOMMENDATION_ACTIONS, isBuyAction, isWaitAction, recommend, recommendationAccuracy, recommendationTimeline, valueLabelOf } from './recommendation';
import { rng, series as makeSeries } from './testing';

const obs = (days: number, price: (d: number) => number) => groupSeries(makeSeries(days, price), null);
/** Plateau at 700, then a jump to 1600 and a steady fall: well above the low, trending down. */
const fallingFromHigh = obs(100, (d) => (d < 10 ? 700 : 1600 - 8 * (d - 10)));

describe('recommend', () => {
  it('monitors without history and with too little history', () => {
    expect(recommend([])).toMatchObject({ action: 'MONITOR', confidence: 0, reason: 'No price history yet.', explanation: ['No price history yet.'] });
    const few = recommend(obs(7, (d) => 1000 + d));
    expect(few.action).toBe('MONITOR');
    expect(few.confidence).toBeCloseTo(0.15);
    expect(few.reason).toContain('Only 7 price snapshots');
  });

  it('says BUY_NOW when the price is close to the historical minimum', () => {
    const noise = rng(5);
    const r = recommend(obs(40, (d) => 2450 + (d === 20 ? 0 : 20 + noise() * 5) + (d === 39 ? -15 : 0)));
    expect(r.action).toBe('BUY_NOW');
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.reason).toContain('above the historical minimum');
  });

  it('is most confident right at the low, and less so a little above it', () => {
    const base = obs(40, () => 2500);
    const atLow = recommend([...base.slice(0, 39), { ...base[39]!, price: 2400 }]);
    const nearLow = recommend([...base.slice(0, 38), { ...base[38]!, price: 2400 }, { ...base[39]!, price: 2460 }]);
    expect(atLow.action).toBe('BUY_NOW');
    expect(nearLow.action).toBe('BUY_NOW');
    expect(atLow.confidence).toBeGreaterThan(nearLow.confidence);
  });

  it('has less confidence in BUY_NOW when a confident forecast expects a further drop', () => {
    const falling = obs(60, (d) => 2000 - 10 * d); // always at its low, trending down
    const withForecast = recommend(falling);
    const withoutForecast = recommend(falling, null);
    expect(withForecast.action).toBe('BUY_NOW');
    expect(withForecast.confidence).toBeLessThan(withoutForecast.confidence);
    expect(withForecast.reason).toContain('further');
  });

  it('says WAIT_FOR_DROP when well above the low with a confident downward forecast', () => {
    const r = recommend(fallingFromHigh);
    expect(r.action).toBe('WAIT_FOR_DROP');
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.confidence).toBeLessThanOrEqual(0.95);
    expect(r.reason).toContain('trending down');
  });

  it('monitors when the price is above its low and the trend is unclear', () => {
    const r = recommend(obs(40, (d) => (d % 2 === 0 ? 1000 : 1100)));
    expect(r.action).toBe('MONITOR');
    expect(r.confidence).toBeGreaterThanOrEqual(0.3);
    expect(r.confidence).toBeLessThanOrEqual(0.6);
    expect(r.reason).toContain('no confident signal');
  });

  it('never says WAIT_FOR_DROP when the forecast is confident but predicts a rise', () => {
    const r = recommend(obs(40, (d) => 1000 + 10 * d)); // always at its high, still climbing: far above the low, so avoid
    expect(r.action).toBe('AVOID');
    expect(r.factors.expectedChange30dPct).toBeGreaterThan(3);
    const mild = recommend(obs(40, (d) => 1000 + 2 * d)); // 8% above... still rising
    expect(mild.action).not.toBe('WAIT_FOR_DROP');
  });

  it('computes its own forecast when none is passed', () => {
    const s = fallingFromHigh;
    expect(recommend(s)).toEqual(recommend(s, forecastSeries(s)));
  });

  it('always returns a confidence between 0 and 1', () => {
    const noise = rng(9);
    for (let i = 0; i < 25; i++) {
      const c = recommend(obs(20 + i * 3, (d) => 1000 + noise() * 400 - d * (i - 12))).confidence;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe('recommendation engine 2.0', () => {
  /** Flat 1000, then a spike to `top` for the last 10 days (no downward trend), so the price sits `top`/1000 above its low. */
  const plateau = (top: number) => obs(40, (d) => (d < 30 ? 1000 : top));

  it('says LIKELY_GOOD a little above the low when no drop is expected', () => {
    const r = recommend(plateau(1050), null);
    expect(r.action).toBe('LIKELY_GOOD');
    expect(r.confidence).toBeGreaterThan(0.3);
    expect(r.reason).toContain('booking soon looks good');
  });

  it('says WAIT when the price is well above its usual level and no drop is forecast', () => {
    const r = recommend(plateau(1200), null);
    expect(r.action).toBe('WAIT');
    expect(r.reason).toContain('Waiting is likely to pay off');
  });

  it('says AVOID when the price is far above its historical range', () => {
    const r = recommend(plateau(1000 * (1 + (AVOID_ABOVE_PCT + 15) / 100)), null);
    expect(r.action).toBe('AVOID');
    expect(r.reason).toContain('not advised');
  });

  it('lets the fare value change the call: poor value downgrades BUY_NOW, very poor value avoids a dear price', () => {
    const atLow = obs(40, () => 2000);
    expect(recommend(atLow, null, 'en', { fareValue: 90 }).action).toBe('BUY_NOW');
    const poor = recommend(atLow, null, 'en', { fareValue: 50 });
    expect(poor.action).toBe('LIKELY_GOOD');
    expect(poor.reason).toContain('poor value');
    const dear = recommend(plateau(1100), null, 'en', { fareValue: 30 });
    expect(dear.action).toBe('AVOID');
    expect(dear.reason).toContain('poor value for the surcharge');
  });

  it('explains every recommendation: reason first, then the factors and the supporting numbers', () => {
    const cases = [recommend([]), recommend(obs(5, () => 1)), recommend(plateau(1050), null), recommend(plateau(1200), null), recommend(fallingFromHigh), recommend(obs(40, () => 1000), null, 'en', { fareValue: 88, upgradeScore: 77 })];
    for (const r of cases) {
      expect(r.explanation.length).toBeGreaterThan(0);
      expect(r.explanation[0]).toBe(r.reason);
      expect(r.reason.length).toBeGreaterThan(10);
    }
    const full = cases[5]!;
    expect(full.explanation.join('\n')).toMatch(/Price position: current .* above the historical minimum/);
    expect(full.explanation.join('\n')).toContain('Forecast: no confident trend signal.');
    expect(full.explanation.join('\n')).toContain('Volatility:');
    expect(full.explanation.join('\n')).toContain('Fare value score: 88/100 (Good value).');
    expect(full.explanation.join('\n')).toContain('Upgrade score: 77/100.');
    expect(full.explanation.join('\n')).toContain('Based on 40 price snapshots.');
    expect(full.factors).toMatchObject({ samples: 40, pctAboveLow: 0, fareValue: 88, upgradeScore: 77 });
  });

  it('describes the forecast in the explanation when it is confident', () => {
    const text = recommend(fallingFromHigh).explanation.join('\n');
    expect(text).toMatch(/Forecast: the trend model expects .* in 30 days \(.*% lower\), confidence \d+%\./);
  });

  it('classifies the actions and the value bands', () => {
    expect(RECOMMENDATION_ACTIONS.filter(isBuyAction)).toEqual(['BUY_NOW', 'LIKELY_GOOD']);
    expect(RECOMMENDATION_ACTIONS.filter(isWaitAction)).toEqual(['WAIT', 'WAIT_FOR_DROP', 'AVOID']);
    expect(valueLabelOf(92)).toBe('Excellent value');
    expect(valueLabelOf(61)).toBe('Neutral value');
  });
});

describe('recommendationTimeline', () => {
  it('replays the recommendation at past collections, only once 14 snapshots exist', () => {
    const t = recommendationTimeline(fallingFromHigh);
    expect(t.length).toBeGreaterThan(5);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t[0]!.t).toBe(Date.parse(fallingFromHigh[13]!.collectedAt));
    expect(t.every((p) => RECOMMENDATION_ACTIONS.includes(p.action) && p.confidence >= 0 && p.confidence <= 1)).toBe(true);
    expect(t.at(-1)!.action).toBe('WAIT_FOR_DROP');
  });

  it('thins out long histories', () => {
    expect(recommendationTimeline(obs(300, (d) => 1000 + d), 20).length).toBeLessThanOrEqual(20);
  });

  it('is empty for short histories', () => {
    expect(recommendationTimeline(obs(10, () => 1))).toEqual([]);
  });
});

describe('recommendationAccuracy', () => {
  it('scores BUY calls wrong when the price kept falling', () => {
    const r = recommendationAccuracy(obs(120, (d) => 3000 - 10 * d)); // always "at the low", then lower again
    expect(r.samples).toBeGreaterThan(5);
    expect(r.accuracy).toBe(0);
  });

  it('scores BUY calls right when no better price followed', () => {
    const r = recommendationAccuracy(obs(120, (d) => 2000 + (d % 3))); // flat: nothing 3% cheaper ever comes
    expect(r.samples).toBeGreaterThan(5);
    expect(r.accuracy).toBe(1);
  });

  it('scores WAIT calls by whether the price then fell', () => {
    // long enough that WAIT calls made mid-fall have a known 30-day outcome
    const r = recommendationAccuracy(obs(160, (d) => (d < 10 ? 700 : 1600 - 8 * (d - 10))));
    expect(r.samples).toBeGreaterThan(5);
    // WAIT calls were right (it kept falling); the late BUY calls near the bottom were not, so the score is high but not perfect
    expect(r.accuracy).toBeGreaterThan(0.6);
    expect(r.accuracy).toBeLessThan(1);
  });

  it('skips calls whose 30-day outcome is not known yet, and monitor calls', () => {
    expect(recommendationAccuracy(obs(20, (d) => 1000 + d))).toEqual({ samples: 0, accuracy: null });
    expect(recommendationAccuracy([])).toEqual({ samples: 0, accuracy: null });
  });
});
