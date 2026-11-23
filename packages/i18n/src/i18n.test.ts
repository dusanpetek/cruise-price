import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, createT, germanMessages, interpolate, intlLocale, isLocale, serverLocale } from './index';

const root = path.resolve(import.meta.dirname, '../../..');
const SOURCES = ['apps/frontend/src', 'packages/analytics/src', 'packages/notifications/src', 'collector/playwright/src', 'apps/api/src'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' ? [] : files(p);
    return /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

/** Every t('…') call with a literal key, in all sources. */
function usedKeys(): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  for (const dir of SOURCES) {
    for (const f of files(path.join(root, dir))) {
      for (const m of readFileSync(f, 'utf8').matchAll(pattern)) {
        found.set((m[1] ?? m[2] ?? '').replace(/\\'/g, "'"), f);
      }
    }
  }
  return found;
}

// Keys that reach t() through a variable (domain labels, table headers, enum values).
const DYNAMIC = [
  'BUY', 'WAIT', 'MONITOR', 'System', 'Light', 'Dark', 'Rising', 'Falling', 'Stable',
  'Inside', 'Ocean View', 'Balcony', 'Junior Suite', 'Suite', 'Cheapest cabin',
  'New historical low', 'Percentage drop', 'Target price reached',
  '30 days', '90 days', 'All time', 'Last 24 hours', 'Last 7 days', 'Last 30 days',
  'In 7 days', 'In 30 days', 'In 60 days', 'Most volatile', 'Most stable', 'Cheapest fare', 'Most expensive fare', 'Best value fare', 'Best fare', 'Best cabin',
  'Cabin {cabin} has no price (probably sold out)', 'Cabin {cabin} has no price with the flight (probably sold out)',
  'No fares collected for {cabin}', 'No booking code for {cabin}', '{fare} for {cabin} not offered or not readable ({reason})', 'Fares for {cabin} could not be read: {reason}', 'Tariff {fare} is currently not available', 'Tariff {fare}: no cabin prices found',
  'Cheapest', 'Best value', 'Best forecast', 'Biggest recent price drop', 'Sorted by trip total, lowest first', 'Sorted by fare value score, highest first', 'Sorted by the expected saving from waiting 30 days', 'Sorted by the price fall over the last week',
  'Any duration', 'Up to 7 nights', '8-10 nights', '11-14 nights', '15 nights or more', 'Strong deal', 'Neutral', 'Poor deal', 'Daily report', 'Weekly report', 'Monthly report',
  'Recommended upgrade', 'Worth considering', 'Not worth it', 'Upgrade value: {amount} below the usual price', 'Upgrade value: {amount} above the usual price',
  'Which cruise is currently my best deal?', 'Is PREMIUM worth the surcharge?', 'Should I book now?', 'When was this route historically cheapest?', 'Which balcony offer is currently best under 3.500 €?', // the copilot examples
  'AIDA is searched in a browser window that opens for a moment; this takes up to half a minute.', 'Mein Schiff is searched in the background; this takes about ten seconds.',
  'yes', 'no', 'manual', 'scheduled', 'cli', 'live', 'mock',
  'Cabin', 'Total price', 'Fare', 'Savings', 'Now', 'Specific cabin selectable', 'Refundable',
];

describe('dictionary', () => {
  it('has a German text for every key used in the sources', () => {
    const missing = [...usedKeys()].filter(([k]) => !(k in germanMessages)).map(([k, f]) => `${k}  (${path.relative(root, f)})`);
    expect(missing).toEqual([]);
  });

  it('covers the dynamically looked-up keys', () => {
    expect(DYNAMIC.filter((k) => !(k in germanMessages))).toEqual([]);
  });

  it('keeps the placeholders of every translation identical to its key', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const broken = Object.entries(germanMessages).filter(([k, v]) => JSON.stringify(vars(k)) !== JSON.stringify(vars(v))).map(([k]) => k);
    expect(broken).toEqual([]);
  });
});

describe('createT', () => {
  it('defaults to German, translates, interpolates and falls back to the key', () => {
    expect(DEFAULT_LOCALE).toBe('de');
    const de = createT('de');
    const en = createT('en');
    expect(de('Alerts')).toBe('Alarme');
    expect(en('Alerts')).toBe('Alerts');
    expect(de('{n} nights', { n: 7 })).toBe('7 Nächte');
    expect(en('{n} nights', { n: 7 })).toBe('7 nights');
    expect(de('Not a known key {x}', { x: 1 })).toBe('Not a known key 1');
  });

  it('interpolates only known placeholders', () => {
    expect(interpolate('a {x} {y}', { x: 1 })).toBe('a 1 {y}');
    expect(interpolate('a {x}')).toBe('a {x}');
  });

  it('knows the locales', () => {
    expect(isLocale('de')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(intlLocale('de')).toBe('de-DE');
    expect(intlLocale('en')).toBe('en-GB');
    expect(serverLocale({})).toBe('de');
    expect(serverLocale({ CRUISE_LANGUAGE: 'en' })).toBe('en');
    expect(serverLocale({ CRUISE_LANGUAGE: 'xx' })).toBe('de');
  });
});
