export const newId = (): string => crypto.randomUUID();

export const round2 = (n: number): number => Math.round(n * 100) / 100;

let moneyLocale = 'de-DE';
/** The number format of prices follows the language of the UI (set by the frontend). */
export const setMoneyLocale = (locale: string): void => {
  moneyLocale = locale;
};

export function formatMoney(value: number, currency = 'EUR', locale = moneyLocale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}
