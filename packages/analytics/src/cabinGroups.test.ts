import { describe, expect, it } from 'vitest';
import { cabinGroupBreakdown } from './cabinGroups';
import { cabin, fare, fareSnapshot, opt, snapshot } from './testing';

// Party of 2: the Mein Schiff cards cost 999 and 1399 cruise in total (499.50 / 699.50 p.p.), so their trip totals differ by 400.
const meinSchiff = [cabin('SPA Balkonkabine', 699.5), cabin('Balkonkabine', 499.5)];

describe('cabinGroupBreakdown', () => {
  it('groups Mein Schiff balcony cards with delta and spread', () => {
    const [balcony] = cabinGroupBreakdown(snapshot(0, meinSchiff));
    expect(balcony!.group).toBe('balcony');
    expect(balcony!.entries.map((e) => [e.category, e.deltaToCheapest])).toEqual([['Balkonkabine', 0], ['SPA Balkonkabine', 400]]);
    expect(balcony!.entries[0]).toMatchObject({ subcategory: null, tripPerPerson: 599.5, tripTotal: 1199 });
    expect(balcony!.spread).toBe(400);
  });

  it('puts suites and junior suites in their groups, in CABIN_GROUPS order', () => {
    const s = snapshot(0, [
      cabin('Große Freiheit Suite', 3000),
      cabin('Weitblick Suite', 2500),
      cabin('Schöne Aussicht Suite', 2800),
      cabin('Junior Suite Balkon', 1800),
      cabin('Balkonkabine', 1000),
    ]);
    const result = cabinGroupBreakdown(s);
    expect(result.map((g) => g.group)).toEqual(['balcony', 'junior-suite', 'suite']);
    expect(result[1]!.entries.map((e) => e.category)).toEqual(['Junior Suite Balkon']);
    expect(result[1]!.spread).toBe(0);
    expect(result[2]!.entries.map((e) => e.category)).toEqual(['Weitblick Suite', 'Schöne Aussicht Suite', 'Große Freiheit Suite']);
  });

  it('joins the AIDA Panorama Balkonkabine with Balkonkabine', () => {
    const [balcony] = cabinGroupBreakdown(snapshot(0, [cabin('Balkonkabine', 1000), cabin('Panorama Balkonkabine', 1100)]));
    expect(balcony!.entries.map((e) => e.category)).toEqual(['Balkonkabine', 'Panorama Balkonkabine']);
  });

  it('collects unknown categories in a trailing null group', () => {
    const result = cabinGroupBreakdown(snapshot(0, [cabin('Foo', 500), cabin('Innenkabine', 900)]));
    expect(result.map((g) => g.group)).toEqual(['inside', null]);
    expect(result[1]!.entries.map((e) => e.category)).toEqual(['Foo']);
  });

  it('uses only the options of the given fare', () => {
    const fares = [fare('CLASSIC'), fare('PREMIUM')];
    const s = fareSnapshot(0, fares, [opt('Balkonkabine', 'CLASSIC', 2000), opt('Panorama Balkonkabine', 'CLASSIC', 2400), opt('Balkonkabine', 'PREMIUM', 3000)]);
    const [balcony] = cabinGroupBreakdown(s, 'CLASSIC');
    expect(balcony!.entries.map((e) => [e.category, e.tripTotal])).toEqual([['Balkonkabine', 3180], ['Panorama Balkonkabine', 3580]]);
    expect(balcony!.spread).toBe(400);
    expect(cabinGroupBreakdown(s, 'NONE')).toEqual([]);
  });

  it('returns [] for a snapshot without cabins', () => {
    expect(cabinGroupBreakdown(snapshot(0, []))).toEqual([]);
  });
});
