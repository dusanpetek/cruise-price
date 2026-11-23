import { createT, intlLocale, isLocale, type Locale, type Vars } from '@cruise/i18n';
import { setMoneyLocale } from '@cruise/shared';
import { useUi } from '@/store/ui';

/** The language the user chose (German by default). */
export const currentLocale = (): Locale => useUi.getState().language;

/**
 * Translates a text written in English. It reads the current language when it is called; changing the language rebuilds the
 * page (see main.tsx), so every screen picks it up.
 */
export const t = (key: string, vars?: Vars): string => createT(currentLocale())(key, vars);

export const dateLocale = (): string => intlLocale(currentLocale());

/** Keeps number formats and the page's lang attribute in step with the language. */
export function syncLanguage(language: Locale = currentLocale()): void {
  setMoneyLocale(intlLocale(language));
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

export { isLocale };

/**
 * Collection warnings are stored with the snapshot in English (snapshots are immutable). They follow fixed patterns,
 * so they are translated when shown; an unknown warning is shown as it was stored.
 */
const WARNINGS: [RegExp, (m: RegExpMatchArray) => [string, Vars]][] = [
  [/^No fares collected for (.+)$/, (m) => ['No fares collected for {cabin}', { cabin: m[1]! }]],
  [/^No booking code for (.+)$/, (m) => ['No booking code for {cabin}', { cabin: m[1]! }]],
  [/^(.+) for (.+) not offered or not readable \((.*)\)$/, (m) => ['{fare} for {cabin} not offered or not readable ({reason})', { fare: m[1]!, cabin: m[2]!, reason: m[3]! }]],
  [/^Fares for (.+) could not be read: (.*)$/, (m) => ['Fares for {cabin} could not be read: {reason}', { cabin: m[1]!, reason: m[2]! }]],
  [/^Cabin (.+) has no price \(probably sold out\)$/, (m) => ['Cabin {cabin} has no price (probably sold out)', { cabin: m[1]! }]],
  [/^Cabin (.+) has no price with the flight \(probably sold out\)$/, (m) => ['Cabin {cabin} has no price with the flight (probably sold out)', { cabin: m[1]! }]],
  [/^Tariff (.+) is currently not available$/, (m) => ['Tariff {fare} is currently not available', { fare: m[1]! }]],
  [/^Tariff (.+): no cabin prices found$/, (m) => ['Tariff {fare}: no cabin prices found', { fare: m[1]! }]],
];

export function translateWarning(warning: string): string {
  for (const [pattern, build] of WARNINGS) {
    const m = warning.match(pattern);
    if (m) return t(...build(m));
  }
  return warning;
}
