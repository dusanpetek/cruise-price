/** German-formatted euro amount: "1.239 €", "ab 849 €", "1.234,50 €" -> number. */
export function parseEuro(text: string): number {
  const m = text.replace(/ /g, ' ').match(/\d[\d.]*(?:,\d+)?/);
  if (!m) throw new Error(`No amount found in "${text}"`);
  const n = Number(m[0].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Invalid amount in "${text}"`);
  return n;
}

/** "13.03.2027" -> "2027-03-13" */
export function parseGermanDate(text: string): string {
  const m = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) throw new Error(`No date found in "${text}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function nightsBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/** Visible page text, normalised: no-break spaces, trimmed lines, no blank lines. */
export function normalizeText(text: string): string {
  return text
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export const re = (source: string, flags = 'im') => new RegExp(source, flags);
