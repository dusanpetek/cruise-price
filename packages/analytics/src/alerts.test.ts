import { describe, expect, it } from 'vitest';
import { evaluateAlerts, groupSeries, tripParts } from './alerts';
import { cabin, priced, rule, snapshot } from './testing';

const two = (day: number, inside: number, balcony: number) => snapshot(day, [cabin('Innenkabine', inside), cabin('Balkonkabine', balcony), cabin('Verandakabine Deluxe', balcony + 50)]);

describe('groupSeries', () => {
  const snaps = [two(2, 600, 900), priced(1, 1500), two(0, 650, 950)];

  it('uses the headline TRIP total without a group, oldest first, with its parts', () => {
    expect(groupSeries(snaps, null).map((p) => p.price)).toEqual([1500, 1500, 1400]); // inside cabin: cruise 1300 + flight 200, ...
    expect(groupSeries(snaps, null)[2]).toMatchObject({ price: 1400, cruise: 1200, flight: 200 });
  });

  it('uses the cheapest trip of the group (cruise + flight) and skips snapshots without one', () => {
    expect(groupSeries(snaps, 'balcony').map((p) => [p.snapshotId, p.price])).toEqual([['s0', 2100], ['s2', 2000]]);
    expect(groupSeries(snaps, 'suite')).toEqual([]);
  });
});

describe('trip parts', () => {
  it('splits an observation into cruise and flight, and treats a missing breakdown as cruise only', () => {
    expect(tripParts({ snapshotId: 's', collectedAt: '', price: 3500, cruise: 2300, flight: 1200 })).toEqual({ cruise: 2300, flight: 1200 });
    expect(tripParts({ snapshotId: 's', collectedAt: '', price: 2300 })).toEqual({ cruise: 2300, flight: 0 });
  });

  it('carries the flight of the cheapest cabin of a group, whichever order the cabins come in', () => {
    const cheaperLast = snapshot(0, [cabin('Balkonkabine', 1000, 100), cabin('Verandakabine Deluxe', 800, 150)]);
    const cheaperFirst = snapshot(1, [cabin('Verandakabine Deluxe', 800, 150), cabin('Balkonkabine', 1000, 100)]);
    for (const s of [cheaperLast, cheaperFirst]) expect(groupSeries([s], 'balcony')[0]).toMatchObject({ price: 1900, cruise: 1600, flight: 300 }); // 800 pp + 150 pp flight beats 1000 pp + 100 pp
    expect(groupSeries([priced(2, 1200)], null)[0]).toMatchObject({ price: 1200, cruise: 1200, flight: 0 });
  });
});

describe('NEW_LOW', () => {
  const newLow = [rule({ type: 'NEW_LOW' })];

  it('fires when the newest price is below every earlier one', () => {
    const [a] = evaluateAlerts({ routeId: 'r1', rules: newLow, snapshots: [priced(0, 2499), priced(1, 2600), priced(2, 2399)] });
    expect(a).toMatchObject({ type: 'NEW_LOW', category: 'Cheapest cabin', currentPrice: 2399, referencePrice: 2499, snapshotId: 's2' });
    expect(a!.message).toContain('New historical low detected');
    expect(a!.message).toContain('2.399');
  });

  it('does not fire for an equal price, a higher price or a first snapshot', () => {
    expect(evaluateAlerts({ routeId: 'r1', rules: newLow, snapshots: [priced(0, 2400), priced(1, 2400)] })).toEqual([]);
    expect(evaluateAlerts({ routeId: 'r1', rules: newLow, snapshots: [priced(0, 2400), priced(1, 2500)] })).toEqual([]);
    expect(evaluateAlerts({ routeId: 'r1', rules: newLow, snapshots: [priced(0, 2400)] })).toEqual([]);
  });

  it('only looks at the newest snapshot, so an old low does not alert again', () => {
    expect(evaluateAlerts({ routeId: 'r1', rules: newLow, snapshots: [priced(0, 2500), priced(1, 2300), priced(2, 2400)] })).toEqual([]);
  });
});

describe('PERCENT_DROP', () => {
  const drop = (percent: number) => [rule({ type: 'PERCENT_DROP', percent })];

  it('fires when the price fell by at least the threshold versus the previous collection', () => {
    const snaps = [priced(0, 1000), priced(1, 880)];
    expect(evaluateAlerts({ routeId: 'r1', rules: drop(10), snapshots: snaps })[0]).toMatchObject({ type: 'PERCENT_DROP', referencePrice: 1000, currentPrice: 880 });
    expect(evaluateAlerts({ routeId: 'r1', rules: drop(10), snapshots: snaps })[0]!.message).toContain('12.0%');
    expect(evaluateAlerts({ routeId: 'r1', rules: drop(5), snapshots: snaps })).toHaveLength(1);
  });

  it.each([15, 20])('stays quiet for a 12%% drop at a %d%% threshold', (t) => {
    expect(evaluateAlerts({ routeId: 'r1', rules: drop(t), snapshots: [priced(0, 1000), priced(1, 880)] })).toEqual([]);
  });

  it('fires exactly at the threshold and ignores rises and a missing predecessor', () => {
    expect(evaluateAlerts({ routeId: 'r1', rules: drop(10), snapshots: [priced(0, 1000), priced(1, 900)] })).toHaveLength(1);
    expect(evaluateAlerts({ routeId: 'r1', rules: drop(5), snapshots: [priced(0, 1000), priced(1, 1100)] })).toEqual([]);
    expect(evaluateAlerts({ routeId: 'r1', rules: drop(5), snapshots: [priced(0, 1000)] })).toEqual([]);
  });
});

describe('TARGET_PRICE', () => {
  const target = [rule({ type: 'TARGET_PRICE', targetPrice: 2499 })];

  it('fires when the price crosses the target', () => {
    const [a] = evaluateAlerts({ routeId: 'r1', rules: target, snapshots: [priced(0, 2600), priced(1, 2499)] });
    expect(a).toMatchObject({ type: 'TARGET_PRICE', referencePrice: 2499, currentPrice: 2499 });
    expect(a!.message).toContain('Target price reached');
  });

  it('fires on the first snapshot if it is already below, but not on every later collection', () => {
    expect(evaluateAlerts({ routeId: 'r1', rules: target, snapshots: [priced(0, 2000)] })).toHaveLength(1);
    expect(evaluateAlerts({ routeId: 'r1', rules: target, snapshots: [priced(0, 2400), priced(1, 2300)] })).toEqual([]);
    expect(evaluateAlerts({ routeId: 'r1', rules: target, snapshots: [priced(0, 2600), priced(1, 2550)] })).toEqual([]);
  });
});

describe('cabin-specific rules', () => {
  const balconyTarget = [rule({ type: 'TARGET_PRICE', cabin: 'balcony', targetPrice: 2000 })];

  it('evaluates only the cabin group', () => {
    const snaps = [two(0, 600, 1000), two(1, 500, 880)]; // balcony trip 2200 -> 1960 (cruise 1760 + flight 200), inside is irrelevant
    const [a] = evaluateAlerts({ routeId: 'r1', rules: balconyTarget, snapshots: snaps });
    expect(a).toMatchObject({ category: 'Balcony', cabinGroup: 'balcony', currentPrice: 1960, cruisePrice: 1760, flightPrice: 200, totalPrice: 1960 });
  });

  it('skips when the newest snapshot has no such cabin', () => {
    const snaps = [two(0, 600, 1000), priced(1, 100)];
    expect(evaluateAlerts({ routeId: 'r1', rules: balconyTarget, snapshots: snaps })).toEqual([]);
  });
});

describe('rule selection', () => {
  const snaps = [priced(0, 1000), priced(1, 700)];

  it('ignores disabled rules and rules for other routes, and applies global and matching ones', () => {
    const rules = [
      rule({ id: 'off', type: 'NEW_LOW', enabled: false }),
      rule({ id: 'other', type: 'NEW_LOW', routeId: 'r2' }),
      rule({ id: 'mine', type: 'NEW_LOW', routeId: 'r1' }),
      rule({ id: 'global', type: 'PERCENT_DROP', percent: 20 }),
    ];
    expect(evaluateAlerts({ routeId: 'r1', rules, snapshots: snaps }).map((a) => a.ruleId).sort()).toEqual(['global', 'mine']);
  });

  it('returns nothing without snapshots or rules', () => {
    expect(evaluateAlerts({ routeId: 'r1', rules: [rule({ type: 'NEW_LOW' })], snapshots: [] })).toEqual([]);
    expect(evaluateAlerts({ routeId: 'r1', rules: [], snapshots: snaps })).toEqual([]);
  });
});

describe('alerts are decided on the trip total', () => {
  const trip = (day: number, cruise: number, flight: number) => snapshot(day, [cabin('Innenkabine', cruise / 2, flight / 2)]);

  it('does not fire a new low when the cruise got cheaper but the flight got dearer', () => {
    const snaps = [trip(0, 1000, 100), trip(1, 900, 400)]; // cruise -100, flight +300: the trip is 200 dearer
    expect(evaluateAlerts({ routeId: 'r1', rules: [rule({ type: 'NEW_LOW' })], snapshots: snaps })).toEqual([]);
    expect(evaluateAlerts({ routeId: 'r1', rules: [rule({ type: 'PERCENT_DROP', percent: 5 })], snapshots: snaps })).toEqual([]);
  });

  it('fires a new low when a cheaper flight makes the trip cheaper, though the cruise did not move', () => {
    const snaps = [trip(0, 1000, 400), trip(1, 1000, 100)];
    const [a] = evaluateAlerts({ routeId: 'r1', rules: [rule({ type: 'NEW_LOW' })], snapshots: snaps });
    expect(a).toMatchObject({ currentPrice: 1100, referencePrice: 1400, cruisePrice: 1000, flightPrice: 100, totalPrice: 1100 });
    expect(a!.message).toContain('1.100 €');
    expect(a!.message).toContain('Trip total: 1.100 € (cruise 1.000 € + flight 100 €).');
  });

  it('checks a target against the trip total', () => {
    const rules = [rule({ type: 'TARGET_PRICE', targetPrice: 1200 })];
    expect(evaluateAlerts({ routeId: 'r1', rules, snapshots: [trip(0, 1500, 100), trip(1, 1100, 200)] })).toEqual([]); // 1300 > 1200
    expect(evaluateAlerts({ routeId: 'r1', rules, snapshots: [trip(0, 1500, 100), trip(1, 1000, 100)] })).toHaveLength(1); // 1100 <= 1200
  });
});
