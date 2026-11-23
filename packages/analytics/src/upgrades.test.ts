import { describe, expect, it } from 'vitest';
import { analyzeUpgrades, bestUpgradeOf, CHEAP_UPGRADE_PCT } from './upgrades';
import { cabin, fare, fareSnapshot, opt, snapshot } from './testing';

const route = { id: 'r1', name: 'Canaries', provider: 'aida' as const };
const FARES = [fare('CLASSIC'), fare('PREMIUM')];

/** `days` snapshots where the balcony costs `gap` more than the ocean view (cruise totals; the flight is the same). */
const history = (days: number, ocean: number, gap: (d: number) => number) =>
  Array.from({ length: days }, (_, d) =>
    fareSnapshot(d, FARES, [opt('Meerblickkabine', 'CLASSIC', ocean), opt('Balkonkabine', 'CLASSIC', ocean + gap(d)), opt('Meerblickkabine', 'PREMIUM', ocean + 300), opt('Balkonkabine', 'PREMIUM', ocean + 300 + gap(d))]),
  );

describe('analyzeUpgrades', () => {
  it('recommends a tiny upgrade even without history: 50 € on top of 3.199 €', () => {
    const [up] = analyzeUpgrades(route, [fareSnapshot(0, [fare('CLASSIC')], [opt('Meerblickkabine', 'CLASSIC', 3199 - 1180), opt('Balkonkabine', 'CLASSIC', 3249 - 1180)])]);
    expect(up).toMatchObject({ fareCode: 'CLASSIC', fareName: 'CLASSIC', costDifference: 50, typicalDifference: null, upgradeValue: null, verdict: 'RECOMMENDED', samples: 1 });
    expect(up!.from).toMatchObject({ group: 'ocean-view', total: 3199 });
    expect(up!.to).toMatchObject({ group: 'balcony', total: 3249 });
    expect(up!.pctDifference).toBeLessThanOrEqual(CHEAP_UPGRADE_PCT);
    expect(up!.pctDifference).toBeCloseTo(1.56, 1);
  });

  it('compares today\'s upgrade price with the usual one', () => {
    const cheap = analyzeUpgrades(route, history(20, 2000, (d) => (d < 19 ? 400 : 50))).find((u) => u.fareCode === 'CLASSIC')!;
    expect(cheap).toMatchObject({ costDifference: 50, typicalDifference: 400, upgradeValue: 350, verdict: 'RECOMMENDED' });
    expect(cheap.upgradeScore).toBeGreaterThanOrEqual(90);

    const usual = analyzeUpgrades(route, history(20, 2000, () => 400)).find((u) => u.fareCode === 'CLASSIC')!;
    expect(usual.upgradeScore).toBe(50);
    expect(usual.verdict).toBe('CONSIDER');

    const dear = analyzeUpgrades(route, history(20, 2000, (d) => (d < 19 ? 400 : 900))).find((u) => u.fareCode === 'CLASSIC')!;
    expect(dear).toMatchObject({ costDifference: 900, upgradeValue: -500, verdict: 'NOT_WORTH', upgradeScore: 0 });
  });

  it('reports cost, percentage, score and value for every neighbouring pair at every fare', () => {
    const ups = analyzeUpgrades(route, history(10, 2000, () => 400));
    expect(ups.map((u) => `${u.fareCode}:${u.from.group}>${u.to.group}`).sort()).toEqual(['CLASSIC:ocean-view>balcony', 'PREMIUM:ocean-view>balcony']);
    for (const u of ups) {
      expect(u.costDifference).toBe(400);
      expect(u.pctDifference).toBeGreaterThan(0);
      expect(u.upgradeScore).toBeGreaterThanOrEqual(0);
      expect(u.upgradeScore).toBeLessThanOrEqual(100);
    }
  });

  it('chains neighbouring groups, uses the cheapest cabin of a group, and prices without fare data per cabin', () => {
    const snap = snapshot(0, [cabin('Innenkabine', 500), cabin('Meerblickkabine', 600), cabin('Balkonkabine', 700), cabin('Balkon Deluxe', 800), cabin('Suite', 1500)]);
    const ups = analyzeUpgrades(route, [snap]);
    expect(ups.map((u) => `${u.from.group}>${u.to.group}`)).toEqual(['inside>ocean-view', 'ocean-view>balcony', 'balcony>suite']);
    expect(ups.every((u) => u.fareCode === null && u.fareName === null)).toBe(true);
    expect(ups[1]!.to.cabinCategory).toBe('Balkonkabine'); // not the deluxe one
    expect(ups[0]!.costDifference).toBe(200); // 100 per person x 2
  });

  it('has nothing to compare with one cabin group, or without data', () => {
    expect(analyzeUpgrades(route, [])).toEqual([]);
    expect(analyzeUpgrades(route, [snapshot(0, [cabin('Balkonkabine', 700)])])).toEqual([]);
    expect(analyzeUpgrades(route, [snapshot(0, [cabin('Unbekannt', 700), cabin('Balkonkabine', 900)])])).toEqual([]);
  });

  it('picks the best upgrade: highest score, then the cheaper one', () => {
    expect(bestUpgradeOf([])).toBeNull();
    const ups = analyzeUpgrades(route, history(20, 2000, (d) => (d < 19 ? 400 : 50)));
    expect(bestUpgradeOf(ups)!.upgradeScore).toBe(Math.max(...ups.map((u) => u.upgradeScore)));
    const tie = [{ ...ups[0]!, upgradeScore: 80, costDifference: 100 }, { ...ups[1]!, upgradeScore: 80, costDifference: 40 }];
    expect(bestUpgradeOf(tie)!.costDifference).toBe(40);
  });
});
