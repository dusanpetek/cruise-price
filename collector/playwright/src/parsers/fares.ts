import { fareCodeOf, type FareOption, type ProviderId } from '@cruise/domain';
import type { ServiceFlagPatterns } from '../selectors/schema';
import { normalizeText, parseEuro, re } from './text';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Fills {placeholders} in a selector template, escaping the values for use inside a regular expression. */
export const fillPattern = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_m, k: string) => esc(vars[k] ?? ''));
export const fillUrl = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_m, k: string) => encodeURIComponent(vars[k] ?? ''));

export interface ServiceLine {
  text: string;
  /** true = ticked, false = crossed out, null = the site does not say. */
  included: boolean | null;
}

/**
 * Cabin selection and refundability, only when the site's own wording says so.
 * `context` is extra text about the fare (e.g. its description) searched for the cabin-selection wording.
 */
export function deriveFlags(services: readonly ServiceLine[], context: string, flags: ServiceFlagPatterns): Pick<FareOption, 'refundable' | 'selectableCabin'> {
  const included = services.filter((s) => s.included === true).map((s) => s.text); // unknown (null) never counts as included
  const searchable = [...included, context].join('\n');
  const yes = re(flags.selectableCabin.yes);
  const no = re(flags.selectableCabin.no);
  const selectableCabin = yes.test(searchable) ? true : no.test(searchable) ? false : null;

  const refund = re(flags.refundable);
  const hit = services.find((s) => refund.test(s.text));
  return { selectableCabin, refundable: hit ? hit.included : null };
}

export interface FareDraft {
  fare: FareOption;
  available: boolean;
}

const unique = (xs: string[]) => [...new Set(xs)];

export function toFareOption(provider: ProviderId, name: string, services: readonly ServiceLine[], context: string, flags: ServiceFlagPatterns): FareOption {
  return {
    fareCode: fareCodeOf(name),
    fareName: name,
    provider,
    includedServices: unique(services.filter((s) => s.included === true).map((s) => s.text)),
    excludedServices: unique(services.filter((s) => s.included === false).map((s) => s.text)),
    ...deriveFlags(services, context, flags),
  };
}

// ---------------------------------------------------------------- AIDA

export interface AidaFareStepConfig {
  startPattern: string;
  endPattern: string;
  headingPattern: string;
  pricePattern: string;
  unavailablePattern: string;
  allInPattern: string;
  servicesIntroPattern: string;
}

export interface AidaFareBlock {
  name: string;
  available: boolean;
  /** Price of the cabin for the party, without flights. */
  cruisePrice: number | null;
  /** Services the site lists as part of the fare. AIDA lists only what is included. */
  services: string[];
  description: string;
  /** Name of the ALL IN variant that can be booked in the next step, if any. */
  allInName: string | null;
}

/** Reads the fares from the visible text of AIDA's "Wählen Sie einen Tarif" step. */
export function parseAidaFareStep(pageText: string, cfg: AidaFareStepConfig): AidaFareBlock[] {
  const lines = normalizeText(pageText).split('\n');
  const start = lines.findIndex((l) => re(cfg.startPattern).test(l));
  if (start < 0) return [];
  const endRel = lines.slice(start + 1).findIndex((l) => re(cfg.endPattern).test(l));
  const body = lines.slice(start + 1, endRel < 0 ? undefined : start + 1 + endRel);

  const heading = re(cfg.headingPattern, '');
  const blocks: { name: string; lines: string[] }[] = [];
  for (const line of body) {
    if (heading.test(line)) blocks.push({ name: line.trim(), lines: [] });
    else blocks.at(-1)?.lines.push(line);
  }

  return blocks.map(({ name, lines: ls }) => {
    const intro = ls.findIndex((l) => re(cfg.servicesIntroPattern).test(l));
    const head = intro < 0 ? ls : ls.slice(0, intro);
    const priceLine = head.map((l) => l.match(re(cfg.pricePattern))).find(Boolean);
    const allIn = head.map((l) => l.match(re(cfg.allInPattern))).find(Boolean);
    const unavailable = head.some((l) => re(cfg.unavailablePattern).test(l));
    return {
      name,
      available: !unavailable && !!priceLine,
      cruisePrice: priceLine ? parseEuro(priceLine[1]!) : null,
      services: intro < 0 ? [] : ls.slice(intro + 1),
      description: head.find((l) => l.length > 40) ?? '',
      allInName: allIn ? `${allIn[1]} ALL IN` : null,
    };
  });
}

export interface AidaAllInConfig {
  introPattern: string;
  endPattern: string;
  pricePattern: string;
}

/** The "switch to ALL IN?" step: the ALL IN price of the cabin and what it adds. */
export function parseAidaAllInStep(pageText: string, cfg: AidaAllInConfig): { cruisePrice: number | null; services: string[] } {
  const lines = normalizeText(pageText).split('\n');
  const priceLine = lines.map((l) => l.match(re(cfg.pricePattern))).find(Boolean);
  const intro = lines.findIndex((l) => re(cfg.introPattern).test(l));
  const endRel = intro < 0 ? -1 : lines.slice(intro).findIndex((l) => re(cfg.endPattern).test(l));
  const section = intro < 0 ? [] : lines.slice(intro, endRel < 0 ? undefined : intro + endRel);
  const services = section
    .map((l) => l.replace(/^Im Reisepreis inklusive:\s*/i, '').trim())
    .filter((l) => l && !/:$/.test(l) && l !== 'ab' && !/€/.test(l) && l !== 'Kabinenpreis');
  return { cruisePrice: priceLine ? parseEuro(priceLine[1]!) : null, services };
}

export interface AidaCabinCode {
  code: string;
  name: string;
}

/** Cabin codes (I, M, B, ...) from AIDA's cruise detail response, to deep-link into each cabin's fare step. */
export function parseAidaCabinCodes(raw: unknown): AidaCabinCode[] {
  const items = (raw as { cabinItemsVariant?: unknown })?.cabinItemsVariant;
  if (!Array.isArray(items)) return [];
  return items.flatMap((i) => (typeof i?.cabinCode === 'string' && typeof i?.cabinName === 'string' ? [{ code: i.cabinCode, name: i.cabinName }] : []));
}

export function aidaJourneyId(url: string, journeyPattern: string): string | null {
  return new URL(url).pathname.match(re(journeyPattern))?.[1] ?? null;
}

// ---------------------------------------------------------------- Mein Schiff

/** What the browser reports for one column of the tariff tab. */
export interface TariffColumn {
  name: string;
  /** Visible text of the column (heading, price, availability). */
  text: string;
  items: { text: string; mark: 'check' | 'cross' | 'unknown' }[];
}

export interface TariffDraft {
  fare: FareOption;
  available: boolean;
  /** "ab" price per person for the cabin that is currently selected in the dialog. */
  fromPricePerPerson: number | null;
}

/** Turns the tariff tab's columns into fares. A service whose icon is not recognised stays unknown. */
export function buildMeinSchiffFares(
  columns: readonly TariffColumn[],
  cfg: { tariffPricePattern: string; tariffUnavailablePattern: string; serviceFlags: ServiceFlagPatterns },
): TariffDraft[] {
  return columns.map((c) => {
    const text = normalizeText(c.text); // the page uses no-break spaces in prices
    const price = text.match(re(cfg.tariffPricePattern))?.[1];
    const services: ServiceLine[] = c.items.map((i) => ({ text: i.text, included: i.mark === 'check' ? true : i.mark === 'cross' ? false : null }));
    return {
      fare: toFareOption('mein-schiff', c.name, services, '', cfg.serviceFlags),
      available: !re(cfg.tariffUnavailablePattern).test(text) && price !== undefined,
      fromPricePerPerson: price ? parseEuro(price) : null,
    };
  });
}
