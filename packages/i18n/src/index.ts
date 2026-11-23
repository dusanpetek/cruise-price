import { de } from './de';

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
/** The app is German first. Library functions default to English so that callers must opt in to German explicitly. */
export const DEFAULT_LOCALE: Locale = 'de';

export const LOCALE_LABELS: Record<Locale, string> = { de: 'Deutsch', en: 'English' };

export type Vars = Record<string, string | number>;
export type TFunction = (key: string, vars?: Vars) => string;

export const isLocale = (v: unknown): v is Locale => v === 'de' || v === 'en';

/** Language of text the server writes by itself (notifications, the PDF report): CRUISE_LANGUAGE, default German. */
export function serverLocale(env: Record<string, string | undefined> = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}): Locale {
  return isLocale(env.CRUISE_LANGUAGE) ? env.CRUISE_LANGUAGE : DEFAULT_LOCALE;
}

/** Replaces {name} placeholders. Unknown placeholders are left as they are. */
export function interpolate(template: string, vars?: Vars): string {
  return vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template;
}

/**
 * Messages are keyed by their English text; English needs no dictionary. A German text that is missing falls back
 * to English (a test makes sure none is missing), so a gap never breaks the screen.
 */
export function createT(locale: Locale): TFunction {
  return (key, vars) => interpolate(locale === 'de' ? (de[key] ?? key) : (en[key] ?? key), vars);
}

/** The few English texts that differ from their key: codes that are shown to people. */
const en: Record<string, string> = { BUY_NOW: 'BUY NOW', LIKELY_GOOD: 'LIKELY GOOD', WAIT_FOR_DROP: 'WAIT FOR DROP' };

/** BCP-47 tag for number and date formatting. */
export const intlLocale = (locale: Locale): string => (locale === 'de' ? 'de-DE' : 'en-GB');

export { de as germanMessages };
