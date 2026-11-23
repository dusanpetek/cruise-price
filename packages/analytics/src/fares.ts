import {
  cabinGroupOf,
  makePricing,
  type CabinGroup,
  type CruiseSnapshot,
  type FareOption,
  type PricingOption,
  type ProviderId,
} from '@cruise/domain';
import { createT, type Locale } from '@cruise/i18n';
import type { PriceObservation } from './alerts';
import { forecastSeries } from './forecast';
import { valueLabelOf } from './recommendation';

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const DAY_MS = 86_400_000;

/** Trip total = cruise + flight + mandatory fees. */
export const tripTotal = (cruise: number, flight: number, fees = 0): number => round2(cruise + flight + fees);

/** One cabin x fare x flight option with every price derived consistently from the party totals. */
export function pricingOption(args: {
  cabinCategory: string;
  fareCode: string;
  flightCode: string | null;
  passengers: number;
  cruisePrice: number;
  flightPrice: number;
  mandatoryFees?: number;
}): PricingOption {
  const p = makePricing({ passengers: args.passengers, cruiseTotal: args.cruisePrice, flightTotal: args.flightPrice, ...(args.mandatoryFees !== undefined ? { mandatoryFees: args.mandatoryFees } : {}) });
  return {
    cabinCategory: args.cabinCategory,
    fareCode: args.fareCode,
    flightCode: args.flightCode,
    cruisePerPerson: p.cruisePerPerson,
    cruisePrice: p.cruiseTotal,
    flightPerPerson: p.flightPerPerson,
    flightPrice: p.flightTotal,
    mandatoryFees: p.mandatoryFees,
    tripPerPerson: p.tripPerPerson,
    totalPrice: p.tripTotal,
  };
}

export const optionKey = (o: { cabinCategory: string; fareCode: string }) => `${o.cabinCategory}||${o.fareCode}`;

export function fareName(snapshot: Pick<CruiseSnapshot, 'fares'>, fareCode: string): string {
  return snapshot.fares.find((f) => f.fareCode === fareCode)?.fareName ?? fareCode;
}

// ---------- comparison within a cabin ----------

export interface FareRow {
  fare: FareOption;
  option: PricingOption;
  /** Total minus the cheapest fare's total in the same cabin. */
  difference: number;
  /** difference as a share of the cheapest total. */
  differencePct: number;
  /** What this fare saves compared with the most expensive fare of the cabin. */
  savingsVsMostExpensive: number;
  servicesKnown: boolean;
}

const hasServiceInfo = (f: FareOption) => f.includedServices.length > 0 || f.excludedServices.length > 0;

/** Fares of one cabin, cheapest total first. Options without a fare description are shown with an "unknown" fare. */
export function compareFares(snapshot: CruiseSnapshot, cabinCategory: string): FareRow[] {
  const options = snapshot.options.filter((o) => o.cabinCategory === cabinCategory).sort((a, b) => a.totalPrice - b.totalPrice || a.fareCode.localeCompare(b.fareCode));
  if (options.length === 0) return [];
  const cheapest = options[0]!.totalPrice;
  const dearest = options[options.length - 1]!.totalPrice;
  return options.map((option) => {
    const fare = snapshot.fares.find((f) => f.fareCode === option.fareCode) ?? { fareCode: option.fareCode, fareName: option.fareCode, provider: snapshot.provider ?? 'aida', includedServices: [], excludedServices: [], refundable: null, selectableCabin: null };
    return {
      fare,
      option,
      difference: round2(option.totalPrice - cheapest),
      differencePct: cheapest === 0 ? 0 : round2(((option.totalPrice - cheapest) / cheapest) * 100),
      savingsVsMostExpensive: round2(dearest - option.totalPrice),
      servicesKnown: hasServiceInfo(fare),
    };
  });
}

export interface FareSaving {
  from: PricingOption;
  to: PricingOption;
  amount: number;
  /** Share of what you pay now (the dearer option). */
  pct: number;
}

/** What switching from one option to another saves (negative = costs more). */
export function fareSaving(from: PricingOption, to: PricingOption): FareSaving {
  const amount = round2(from.totalPrice - to.totalPrice);
  return { from, to, amount, pct: from.totalPrice === 0 ? 0 : round2((amount / from.totalPrice) * 100) };
}

// ---------- included services ----------

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export interface ServicesComparison {
  base: FareOption;
  upgrade: FareOption;
  /** Total of the upgrade minus total of the base (same cabin). Null if either price is unknown. */
  extraCost: number | null;
  /** In the upgrade, and the base explicitly does not include it. */
  extraBenefits: string[];
  /** In the upgrade, and the base's list says nothing about it: we do not know if the base has it too. */
  unknownBenefits: string[];
  /** In the base but not in the upgrade (explicitly excluded there). */
  lostBenefits: string[];
  /** In the base, and the upgrade's list says nothing about it. */
  unknownLosses: string[];
  /** Cabin selection / refundability change; each side is true, false or null (unknown). */
  terms: { label: string; base: boolean | null; upgrade: boolean | null }[];
}

/** What you get for the extra money when moving from `base` to `upgrade`. Unlisted services stay unknown, never "not included". */
export function compareServices(base: FareOption, upgrade: FareOption, extraCost: number | null): ServicesComparison {
  const baseIn = new Set(base.includedServices.map(norm));
  const baseOut = new Set(base.excludedServices.map(norm));
  const upIn = new Set(upgrade.includedServices.map(norm));
  const upOut = new Set(upgrade.excludedServices.map(norm));

  const extraBenefits: string[] = [];
  const unknownBenefits: string[] = [];
  for (const s of upgrade.includedServices) {
    if (baseIn.has(norm(s))) continue;
    (baseOut.has(norm(s)) ? extraBenefits : unknownBenefits).push(s);
  }
  const lostBenefits: string[] = [];
  const unknownLosses: string[] = [];
  for (const s of base.includedServices) {
    if (upIn.has(norm(s))) continue;
    (upOut.has(norm(s)) ? lostBenefits : unknownLosses).push(s);
  }
  return {
    base,
    upgrade,
    extraCost: extraCost === null ? null : round2(extraCost),
    extraBenefits,
    unknownBenefits,
    lostBenefits,
    unknownLosses,
    terms: [
      { label: 'Specific cabin selectable', base: base.selectableCabin, upgrade: upgrade.selectableCabin },
      { label: 'Refundable', base: base.refundable, upgrade: upgrade.refundable },
    ],
  };
}

// ---------- scoring ----------

const FLEX_POINTS = (v: boolean | null) => (v === null ? 50 : v ? 100 : 0);

/**
 * Best-fare score within one cabin, 0..100, following the selection criteria in their order of weight:
 *  50% lowest trip total (the cheapest fare = 100, others scaled by cheapest / this),
 *  20% forecast trend (a trip total expected to rise favours booking this fare now; 50 without a forecast),
 *  20% included services (share of the most inclusive fare; 50 when the fare's services are unknown),
 *  10% flexibility (refundable and specific-cabin choice; unknown counts 50).
 */
export function fareScore(row: FareRow, rows: readonly FareRow[], outlook?: Pick<OptionOutlook, 'expected30dChangePct' | 'confidence'>): number {
  const cheapest = Math.min(...rows.map((r) => r.option.totalPrice));
  const price = row.option.totalPrice === 0 ? 100 : (cheapest / row.option.totalPrice) * 100;
  const forecast = outlook ? forecastOpportunity(outlook) : 50;
  const most = Math.max(...rows.map((r) => r.fare.includedServices.length));
  const services = !row.servicesKnown || most === 0 ? 50 : (row.fare.includedServices.length / most) * 100;
  const flexibility = (FLEX_POINTS(row.fare.refundable) + FLEX_POINTS(row.fare.selectableCabin)) / 2;
  return Math.round(0.5 * price + 0.2 * forecast + 0.2 * services + 0.1 * flexibility);
}

/** 0..100: 50 = no expected move; a trip total expected to RISE scores higher (book now), scaled by how confident the trend is. */
export function forecastOpportunity(outlook: Pick<OptionOutlook, 'expected30dChangePct' | 'confidence'>): number {
  const tilt = clamp(50 + (outlook.expected30dChangePct ?? 0) * 5, 0, 100);
  return 50 + (tilt - 50) * outlook.confidence;
}

export interface DealScoreBreakdown {
  /** 100 at the lowest trip total ever seen, 0 at the highest (50 with a single collection). */
  historicalPosition: number;
  /** See `forecastOpportunity`. */
  forecastOpportunity: number;
  /** Recent price movement: a trip total that has just fallen is a better deal now (50 = unchanged, 10% lower = 100). */
  trend: number;
  /** Fare value score (0..100) when the series is a fare option, else null. */
  fareValue: number | null;
  /** Upgrade score (0..100) when moving up to this cabin is an upgrade opportunity, else null. */
  upgradeValue: number | null;
  score: number;
}

const RECENT_DAYS = 7;

/** Percent change of the latest price against the price a week earlier (or the first price); null with fewer than two points. */
export function recentChange(series: readonly PriceObservation[], days = RECENT_DAYS): { amount: number; pct: number } | null {
  if (series.length < 2) return null;
  const sorted = [...series].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const latest = sorted[sorted.length - 1]!;
  const cutoff = Date.parse(latest.collectedAt) - days * DAY_MS;
  const base = sorted.findLast((p) => Date.parse(p.collectedAt) <= cutoff) ?? sorted[0]!;
  if (base === latest || base.price === 0) return null;
  return { amount: round2(latest.price - base.price), pct: round2(((latest.price - base.price) / base.price) * 100) };
}

/** The mean of the components that exist: historical position, forecast opportunity, trend, fare value, upgrade value. */
export function dealScoreFrom(c: Omit<DealScoreBreakdown, 'score'>): number {
  const parts = [c.historicalPosition, c.forecastOpportunity, c.trend, ...(c.fareValue === null ? [] : [c.fareValue]), ...(c.upgradeValue === null ? [] : [c.upgradeValue])];
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

/**
 * The unified Deal Score, 0..100 = mean of historical position, forecast opportunity, price trend and, when known, fare value
 * and upgrade value, all on the TRIP total.
 */
export function dealScoreBreakdown(series: readonly PriceObservation[], outlook: Pick<OptionOutlook, 'expected30dChangePct' | 'confidence'>, extras: { fareValue?: number | null; upgradeValue?: number | null } = {}): DealScoreBreakdown {
  const prices = series.map((p) => p.price);
  const current = prices[prices.length - 1]!;
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const historicalPosition = prices.length < 2 ? 50 : high === low ? 100 : ((high - current) / (high - low)) * 100;
  const change = recentChange(series);
  const parts = {
    historicalPosition: round2(historicalPosition),
    forecastOpportunity: round2(forecastOpportunity(outlook)),
    trend: change ? round2(clamp(50 - change.pct * 5, 0, 100)) : 50,
    fareValue: extras.fareValue ?? null,
    upgradeValue: extras.upgradeValue ?? null,
  };
  return { ...parts, score: dealScoreFrom(parts) };
}

export const dealScoreOf = (series: readonly PriceObservation[], outlook: Pick<OptionOutlook, 'expected30dChangePct' | 'confidence'>, extras: { fareValue?: number | null; upgradeValue?: number | null } = {}): number => dealScoreBreakdown(series, outlook, extras).score;

// ---------- fare value ----------

export interface FareValue {
  /** 0..100: 90+ excellent, 75-89 good, 60-74 neutral, below 60 poor. */
  score: number;
  label: 'Excellent value' | 'Good value' | 'Neutral value' | 'Poor value';
  factors: { price: number; benefits: number; history: number; forecast: number; flexibility: number; availability: number };
}

/**
 * Fare Value Score for one fare within its cabin: is the fare worth what it costs?
 *  35% price difference (the cheapest fare = 100; every percent above it costs 4 points),
 *  20% additional included benefits (share of the most inclusive fare; unknown services count 50),
 *  15% historical pricing (100 at the fare's own lowest total, 5 points less per percent above it),
 *  10% forecast (a total expected to rise favours booking now),
 *  10% flexibility (refundable, specific cabin; unknown counts 50),
 *  10% availability (share of the collections in which the fare was offered).
 */
export function fareValueScore(
  row: FareRow,
  rows: readonly FareRow[],
  context: { pctAboveLow: number; samples: number; totalSnapshots: number; outlook?: Pick<OptionOutlook, 'expected30dChangePct' | 'confidence'> },
): FareValue {
  const most = Math.max(...rows.map((r) => r.fare.includedServices.length));
  const factors = {
    price: clamp(100 - row.differencePct * 4, 0, 100),
    benefits: !row.servicesKnown || most === 0 ? 50 : (row.fare.includedServices.length / most) * 100,
    history: clamp(100 - context.pctAboveLow * 5, 0, 100),
    forecast: context.outlook ? forecastOpportunity(context.outlook) : 50,
    flexibility: (FLEX_POINTS(row.fare.refundable) + FLEX_POINTS(row.fare.selectableCabin)) / 2,
    availability: context.totalSnapshots === 0 ? 100 : clamp((context.samples / context.totalSnapshots) * 100, 0, 100),
  };
  const score = Math.round(0.35 * factors.price + 0.2 * factors.benefits + 0.15 * factors.history + 0.1 * factors.forecast + 0.1 * factors.flexibility + 0.1 * factors.availability);
  const rounded = Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, Math.round(v)])) as FareValue['factors'];
  return { score, label: valueLabelOf(score), factors: rounded };
}

export type Outlook = 'drops' | 'rises' | 'stable' | 'unclear';

export interface OptionOutlook {
  outlook: Outlook;
  /** Expected change of the total over 30 days, in percent; null without a forecast. */
  expected30dChangePct: number | null;
  confidence: number;
  text: string;
}

/** "likely stable" / "likely drops 8%" / "likely rises 5%": stable below 2% or when the trend fit is weak. */
export function outlookOf(label: string, series: readonly PriceObservation[], provider: string | null, locale: Locale = 'en'): OptionOutlook {
  const t = createT(locale);
  const f = forecastSeries(series, { cabin: null, provider, departure: null });
  if (!f || f.currentPrice === 0) return { outlook: 'unclear', expected30dChangePct: null, confidence: 0, text: t('{label}: not enough history for an outlook', { label }) };
  const pct = round2(((f.forecast30Day - f.currentPrice) / f.currentPrice) * 100);
  if (f.confidence < 0.4 || Math.abs(pct) < 2) return { outlook: 'stable', expected30dChangePct: pct, confidence: f.confidence, text: t('{label} likely stable', { label }) };
  return pct < 0
    ? { outlook: 'drops', expected30dChangePct: pct, confidence: f.confidence, text: t('{label} likely drops {pct}%', { label, pct: Math.abs(pct).toFixed(0) }) }
    : { outlook: 'rises', expected30dChangePct: pct, confidence: f.confidence, text: t('{label} likely rises {pct}%', { label, pct: pct.toFixed(0) }) };
}

// ---------- history of one option ----------

/** Total trip price of one cabin x fare over time (oldest first). */
export function optionSeries(snapshots: readonly CruiseSnapshot[], cabinCategory: string, fareCode: string): PriceObservation[] {
  return snapshots
    .flatMap((s) => {
      const o = s.options.find((x) => x.cabinCategory === cabinCategory && x.fareCode === fareCode);
      return o ? [{ snapshotId: s.id, collectedAt: s.collectedAt, price: o.totalPrice, cruise: o.cruisePrice, flight: o.flightPrice }] : [];
    })
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}

/**
 * Cheapest total per snapshot among options of a cabin group (null = any cabin) with the given fare. Used by fare alerts.
 * Snapshots without a matching option are skipped.
 */
export function fareGroupSeries(snapshots: readonly CruiseSnapshot[], group: CabinGroup | null, fareCode: string): PriceObservation[] {
  return snapshots
    .flatMap((s) => {
      const matching = s.options.filter((o) => o.fareCode === fareCode && (group === null || cabinGroupOf(o.cabinCategory) === group));
      if (matching.length === 0) return [];
      const best = matching.reduce((a, b) => (b.totalPrice < a.totalPrice ? b : a));
      return [{ snapshotId: s.id, collectedAt: s.collectedAt, price: best.totalPrice, cruise: best.cruisePrice, flight: best.flightPrice }];
    })
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}

export const cabinCategoriesWithFares = (snapshot: CruiseSnapshot): string[] => [...new Set(snapshot.options.map((o) => o.cabinCategory))];

// ---------- per-option intelligence ----------

export interface RouteRefLite {
  id: string;
  name: string;
  provider: ProviderId;
}

export interface OptionIntelligence {
  routeId: string;
  routeName: string;
  provider: ProviderId;
  cabinCategory: string;
  cabinGroup: CabinGroup | null;
  fare: FareOption;
  fareName: string;
  option: PricingOption;
  /** Lowest / highest total this combination has had, and where today's total sits. */
  historicalLow: number;
  historicalHigh: number;
  pctAboveLow: number;
  samples: number;
  outlook: OptionOutlook;
  /** Best-fare score within the cabin (trip total, forecast, services, flexibility), 0..100. */
  fareScore: number;
  /** Deal score 0..100 (see `dealScoreBreakdown`). */
  dealScore: number;
  dealComponents: Omit<DealScoreBreakdown, 'score'>;
  /** Fare Value Score 0..100 within the cabin, with its label and factors. */
  valueScore: number;
  valueLabel: FareValue['label'];
  valueFactors: FareValue['factors'];
  /** True for the fare with the best value score in its cabin (ties go to the cheaper trip). */
  recommendedFare: boolean;
  servicesKnown: boolean;
  servicesCount: number;
  /** What the route's trip is: for filtering and ranking. */
  ship: string | null;
  departure: string | null;
  durationNights: number | null;
  /** Mean total this combination has had. */
  historicalAverage: number;
  /** Expected saving by waiting 30 days (positive = the total is expected to fall); null without a forecast. */
  expectedSavings: number | null;
  /** Change of the total over the last week (amount and percent; negative = it fell); null with a single collection. */
  recentChange: { amount: number; pct: number } | null;
}

/** Every cabin x fare combination of a route's latest snapshot, with history, outlook and scores. Empty without fare data. */
export function analyzeOptions(route: RouteRefLite, snapshots: readonly CruiseSnapshot[], locale: Locale = 'en'): OptionIntelligence[] {
  const sorted = [...snapshots].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const latest = sorted.at(-1);
  if (!latest || latest.options.length === 0) return [];

  const out: OptionIntelligence[] = [];
  for (const cabinCategory of cabinCategoriesWithFares(latest)) {
    const rows = compareFares(latest, cabinCategory);
    for (const row of rows) {
      const series = optionSeries(sorted, cabinCategory, row.fare.fareCode);
      const prices = series.map((p) => p.price);
      const label = `${row.fare.fareName}`;
      const outlook = outlookOf(label, series, route.provider, locale);
      const low = Math.min(...prices);
      const pctAboveLow = low === 0 ? 0 : round2(((row.option.totalPrice - low) / low) * 100);
      const value = fareValueScore(row, rows, { pctAboveLow, samples: series.length, totalSnapshots: sorted.length, outlook });
      const deal = dealScoreBreakdown(series, outlook, { fareValue: value.score });
      const { score: dealScore, ...dealComponents } = deal;
      out.push({
        routeId: route.id,
        routeName: route.name,
        provider: route.provider,
        cabinCategory,
        cabinGroup: cabinGroupOf(cabinCategory),
        fare: row.fare,
        fareName: row.fare.fareName,
        option: row.option,
        historicalLow: low,
        historicalHigh: Math.max(...prices),
        pctAboveLow,
        samples: series.length,
        outlook,
        fareScore: fareScore(row, rows, outlook),
        dealScore,
        dealComponents,
        valueScore: value.score,
        valueLabel: value.label,
        valueFactors: value.factors,
        recommendedFare: false,
        servicesKnown: row.servicesKnown,
        servicesCount: row.fare.includedServices.length,
        ship: latest.cruise.ship,
        departure: latest.cruise.departure,
        durationNights: latest.cruise.durationNights,
        historicalAverage: round2(prices.reduce((a, b) => a + b, 0) / prices.length),
        expectedSavings: outlook.expected30dChangePct === null ? null : round2((-outlook.expected30dChangePct / 100) * row.option.totalPrice),
        recentChange: recentChange(series),
      });
    }
  }
  // The recommended fare of a cabin is the one with the best value score (ties go to the cheaper trip).
  for (const cabinCategory of cabinCategoriesWithFares(latest)) {
    const inCabin = out.filter((o) => o.cabinCategory === cabinCategory);
    const best = inCabin.reduce((a, b) => (b.valueScore > a.valueScore || (b.valueScore === a.valueScore && b.option.totalPrice < a.option.totalPrice) ? b : a));
    best.recommendedFare = true;
  }
  return out;
}

// ---------- dashboards and rankings ----------

export interface FareDashboard {
  cabinCategory: string;
  cheapest: FareRow;
  mostExpensive: FareRow;
  bestValue: { row: FareRow; fareScore: number };
  /** Moving from the most expensive fare to the cheapest. Null when the cabin has a single fare. */
  largestSaving: FareSaving | null;
}

/** The four dashboard widgets for one cabin. Null when the cabin has no fare data. */
export function fareDashboard(snapshot: CruiseSnapshot, cabinCategory: string): FareDashboard | null {
  const rows = compareFares(snapshot, cabinCategory);
  if (rows.length === 0) return null;
  const scored = rows.map((row) => ({ row, fareScore: fareScore(row, rows) }));
  const best = scored.reduce((a, b) => (b.fareScore > a.fareScore || (b.fareScore === a.fareScore && b.row.option.totalPrice < a.row.option.totalPrice) ? b : a));
  const cheapest = rows[0]!;
  const dearest = rows[rows.length - 1]!;
  return {
    cabinCategory,
    cheapest,
    mostExpensive: dearest,
    bestValue: best,
    largestSaving: rows.length > 1 ? fareSaving(dearest.option, cheapest.option) : null,
  };
}

export type MatrixSort = 'total' | 'fare' | 'cabin' | 'savings';

export interface MatrixCell {
  option: PricingOption | null;
  /** Savings versus the most expensive fare in this cabin. */
  savings: number | null;
}

export interface FareMatrix {
  fares: FareOption[];
  rows: { cabinCategory: string; cells: Record<string, MatrixCell>; cheapestTotal: number | null; maxSavings: number }[];
}

/** Cabin x fare matrix of the latest snapshot (total prices). Missing combinations are null cells. */
export function fareMatrix(snapshot: CruiseSnapshot, sort: MatrixSort = 'cabin'): FareMatrix {
  const cabins = cabinCategoriesWithFares(snapshot);
  const fareCodes = [...new Set(snapshot.options.map((o) => o.fareCode))];
  const fares = fareCodes
    .map((code) => snapshot.fares.find((f) => f.fareCode === code) ?? { fareCode: code, fareName: code, provider: snapshot.provider ?? 'aida', includedServices: [], excludedServices: [], refundable: null, selectableCabin: null })
    .sort((a, b) => {
      if (sort === 'fare') return a.fareName.localeCompare(b.fareName);
      // Order by the average premium over the cheapest fare of the same cabin, so fares that only exist in
      // expensive cabins are not ranked as dearer than they are.
      const premium = (code: string) => {
        const diffs = snapshot.options.filter((o) => o.fareCode === code).map((o) => o.totalPrice - Math.min(...snapshot.options.filter((x) => x.cabinCategory === o.cabinCategory).map((x) => x.totalPrice)));
        return diffs.reduce((x, y) => x + y, 0) / diffs.length;
      };
      return premium(a.fareCode) - premium(b.fareCode);
    });

  const rows = cabins.map((cabinCategory) => {
    const compared = compareFares(snapshot, cabinCategory);
    const cells = Object.fromEntries(
      fares.map((f) => {
        const row = compared.find((r) => r.fare.fareCode === f.fareCode);
        return [f.fareCode, { option: row?.option ?? null, savings: row ? row.savingsVsMostExpensive : null } satisfies MatrixCell];
      }),
    );
    return { cabinCategory, cells, cheapestTotal: compared[0]?.option.totalPrice ?? null, maxSavings: Math.max(...compared.map((r) => r.savingsVsMostExpensive)) };
  });

  rows.sort((a, b) => {
    if (sort === 'total') return (a.cheapestTotal ?? Infinity) - (b.cheapestTotal ?? Infinity);
    if (sort === 'savings') return b.maxSavings - a.maxSavings;
    return 0; // 'cabin' and 'fare' keep the provider's cabin order
  });
  return { fares, rows };
}

export interface DealEntry extends OptionIntelligence {}

export interface DealFinder {
  topDeals: DealEntry[];
  bestValue: DealEntry[];
  lowestTotal: DealEntry[];
  lowestFlight: DealEntry[];
  bestBalcony: DealEntry[];
  bestSuite: DealEntry[];
}

/** Rankings across every route's current fare options. Cruise, flight and total are on every entry. */
export function dealFinder(options: readonly OptionIntelligence[], limit = 10): DealFinder {
  const by = (cmp: (a: DealEntry, b: DealEntry) => number, filter: (o: DealEntry) => boolean = () => true) => options.filter(filter).sort(cmp).slice(0, limit);
  const deal = (a: DealEntry, b: DealEntry) => b.dealScore - a.dealScore || a.option.totalPrice - b.option.totalPrice;
  return {
    topDeals: by(deal),
    bestValue: by((a, b) => b.fareScore - a.fareScore || a.option.totalPrice - b.option.totalPrice),
    lowestTotal: by((a, b) => a.option.totalPrice - b.option.totalPrice),
    lowestFlight: by((a, b) => a.option.flightPrice - b.option.flightPrice || a.option.totalPrice - b.option.totalPrice),
    bestBalcony: by(deal, (o) => o.cabinGroup === 'balcony'),
    bestSuite: by(deal, (o) => o.cabinGroup === 'suite'),
  };
}

export interface FareHighlights {
  cheapest: OptionIntelligence | null;
  mostExpensive: OptionIntelligence | null;
  bestValue: OptionIntelligence | null;
  /** Switching from the dearest to the cheapest fare of the same cabin on the same route. */
  largestSaving: { routeName: string; cabinCategory: string; saving: FareSaving; fromFare: string; toFare: string } | null;
}

/** The four fare widgets over any set of options (one cabin, one route, or the whole portfolio). */
export function fareHighlights(options: readonly OptionIntelligence[]): FareHighlights {
  if (options.length === 0) return { cheapest: null, mostExpensive: null, bestValue: null, largestSaving: null };
  const total = (o: OptionIntelligence) => o.option.totalPrice;
  const cheapest = options.reduce((a, b) => (total(b) < total(a) ? b : a));
  const mostExpensive = options.reduce((a, b) => (total(b) > total(a) ? b : a));
  const bestValue = options.reduce((a, b) => (b.fareScore > a.fareScore || (b.fareScore === a.fareScore && total(b) < total(a)) ? b : a));

  const groups = new Map<string, OptionIntelligence[]>();
  for (const o of options) groups.set(`${o.routeId}||${o.cabinCategory}`, [...(groups.get(`${o.routeId}||${o.cabinCategory}`) ?? []), o]);
  let largest: FareHighlights['largestSaving'] = null;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const lo = g.reduce((a, b) => (total(b) < total(a) ? b : a));
    const hi = g.reduce((a, b) => (total(b) > total(a) ? b : a));
    const saving = fareSaving(hi.option, lo.option);
    if (!largest || saving.amount > largest.saving.amount) largest = { routeName: hi.routeName, cabinCategory: hi.cabinCategory, saving, fromFare: hi.fareName, toFare: lo.fareName };
  }
  return { cheapest, mostExpensive, bestValue, largestSaving: largest };
}

/** The fare with the best score for its cabin (ties go to the cheaper trip). */
export function bestFareOf(options: readonly OptionIntelligence[]): OptionIntelligence | null {
  return options.length === 0 ? null : options.reduce((a, b) => (b.fareScore > a.fareScore || (b.fareScore === a.fareScore && b.option.totalPrice < a.option.totalPrice) ? b : a));
}

/**
 * The best cabin: each cabin is represented by its highest-scoring option (deal score, ties to the cheaper trip),
 * and the cabin whose representative scores highest wins. Returns that option.
 */
export function bestCabinOf(options: readonly OptionIntelligence[]): OptionIntelligence | null {
  const better = (a: OptionIntelligence, b: OptionIntelligence) => b.dealScore > a.dealScore || (b.dealScore === a.dealScore && b.option.totalPrice < a.option.totalPrice);
  const byCabin = new Map<string, OptionIntelligence>();
  for (const o of options) {
    const cur = byCabin.get(o.cabinCategory);
    if (!cur || better(cur, o)) byCabin.set(o.cabinCategory, o);
  }
  const reps = [...byCabin.values()];
  return reps.length === 0 ? null : reps.reduce((a, b) => (better(a, b) ? b : a));
}

// ---------- selecting a cabin and/or a fare ----------

export interface Selection {
  /** A cabin category as the provider names it, or null for the cheapest cabin. */
  cabin: string | null;
  /** A fare code, or null for the cheapest fare. */
  fareCode: string | null;
}

/**
 * The TRIP total series of what the user picked on the route page:
 *  - nothing: the headline (cheapest trip);
 *  - a cabin: that cabin at its cheapest fare;
 *  - a fare: that fare in whichever cabin is cheapest;
 *  - both: exactly that cabin + fare.
 * Snapshots that do not have the combination (older ones, or a fare not offered then) are skipped.
 */
export function selectionSeries(snapshots: readonly CruiseSnapshot[], sel: Selection): PriceObservation[] {
  if (sel.fareCode && sel.cabin) return optionSeries(snapshots, sel.cabin, sel.fareCode);
  if (sel.fareCode) return fareGroupSeries(snapshots, null, sel.fareCode);
  if (sel.cabin) {
    return snapshots
      .flatMap((s) => {
        const c = s.cabins.find((x) => x.category === sel.cabin);
        return c ? [{ snapshotId: s.id, collectedAt: s.collectedAt, price: c.tripTotal, cruise: c.packageTotal, flight: c.flightTotal }] : [];
      })
      .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  }
  return snapshots
    .map((s) => ({ snapshotId: s.id, collectedAt: s.collectedAt, price: s.pricing.tripTotal, cruise: s.pricing.cruiseTotal, flight: s.pricing.flightTotal }))
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}

/** Observations as chart / statistics points (cruise + flight parts kept). */
export function observationsToPoints(series: readonly PriceObservation[]): { collectedAt: string; packagePrice: number; flightSurcharge: number }[] {
  return series.map((o) => ({ collectedAt: o.collectedAt, packagePrice: o.cruise ?? o.price, flightSurcharge: o.flight ?? 0 }));
}
