import { cabinGroupOf, CABIN_GROUPS, type CabinGroup } from '@cruise/domain';
import { createT, type Locale } from '@cruise/i18n';
import { euro } from './alerts';
import { searchDeals, type DealFilters } from './dealSearch';
import type { OptionIntelligence } from './fares';
import type { Portfolio, RankedRoute } from './intelligence';

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type CopilotIntent = 'best_deal' | 'fare_worth' | 'book_now' | 'historically_cheapest' | 'best_under_budget' | 'unknown';

export interface CopilotMetric {
  label: string;
  value: string;
}

export interface CopilotDeal {
  routeId: string;
  routeName: string;
  ship: string | null;
  cabinCategory: string;
  fareName: string;
  cruise: number;
  flight: number;
  total: number;
  dealScore: number;
  valueScore: number;
}

export interface CopilotAnswer {
  question: string;
  intent: CopilotIntent;
  /** False when the question could not be matched to anything the copilot can answer. */
  understood: boolean;
  /** The answer in one sentence. */
  recommendation: string;
  reasoning: string[];
  /** 0..1 */
  confidence: number;
  /** The numbers behind the answer. */
  metrics: CopilotMetric[];
  /** Offers the answer refers to (best first). */
  deals: CopilotDeal[];
  /** Example questions, when the question was not understood. */
  suggestions: string[];
}

export const COPILOT_EXAMPLES = [
  'Which cruise is currently my best deal?',
  'Is PREMIUM worth the surcharge?',
  'Should I book now?',
  'When was this route historically cheapest?',
  'Which balcony offer is currently best under 3.500 €?',
] as const;

// ---------- understanding the question ----------

const normalise = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9€.,\s-]+/g, ' ').replace(/\s+/g, ' ').trim();

const CABIN_WORDS: [RegExp, CabinGroup][] = [
  [/junior/, 'junior-suite'],
  [/suite/, 'suite'],
  [/\b(inside|interior|innen\w*)\b/, 'inside'],
  [/\b(balcon\w*|balkon\w*|veranda\w*)\b/, 'balcony'],
  [/\b(ocean\s*view|outside|meerblick\w*|aussen\w*|oceanview)\b/, 'ocean-view'],
];

/** Words that name the same place or trip in English and German. */
const ROUTE_ALIASES = [['canar', 'kanar'], ['mediterr', 'mittelmeer'], ['norw', 'fjord'], ['baltic', 'ostsee'], ['caribb', 'karib']];
const GENERIC = new Set(['demo', 'mock', 'data', 'aida', 'mein', 'schiff', 'cruise', 'reise', 'with', 'from', 'nights', 'naechte']);

function matchRoutes(q: string, routes: readonly RankedRoute[]): RankedRoute[] {
  return routes.filter((r) => {
    const name = normalise(r.routeName);
    const tokens = name.split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !GENERIC.has(w));
    if (tokens.some((w) => q.includes(w))) return true;
    if (ROUTE_ALIASES.some((group) => group.some((a) => name.includes(a)) && group.some((a) => q.includes(a)))) return true;
    return !!r.ship && q.includes(normalise(r.ship));
  });
}

/** The amount after "under" / "unter" / "bis" / "max", or before a euro sign: 3.500 -> 3500. */
export function parseBudget(question: string): number | null {
  const q = question.toLowerCase();
  const num = String.raw`(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d+)?`;
  const m = q.match(new RegExp(String.raw`(?:under|below|less than|unter|bis|max(?:imal|imum)?|hoechstens|höchstens|<)\s*(?:€\s*)?${num}`)) ?? q.match(new RegExp(`${num}\\s*(?:€|eur\\b|euro)`));
  if (!m) return null;
  const value = Number(m[1]!.replace(/[.\s]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const has = (q: string, re: RegExp) => re.test(q);

/** Which question was asked. Deterministic keyword rules (English and German), no language model. */
export function detectIntent(question: string, mentionsFare: boolean): CopilotIntent {
  const q = normalise(question);
  if (has(q, /(when|wann|wie lange).*(cheap|guenstig|billig|lowest|niedrig|tiefst|best price|bester preis)|historic|historisch|all.?time low/)) return 'historically_cheapest';
  if (has(q, /worth|lohnt|wert|surcharge|aufpreis|mehrpreis|upgrade to .*fare/) && mentionsFare) return 'fare_worth';
  if (has(q, /should i (book|buy|wait)|soll ich|book now|jetzt buchen|buchen|warten|\bwait\b|kaufen/)) return 'book_now';
  if (parseBudget(question) !== null && has(q, /best|beste|top|offer|angebot|deal|cheapest|guenstig|show|zeig|welche/)) return 'best_under_budget';
  if (has(q, /best|beste|top|deal|angebot|schnaeppchen|guenstig|cheap/)) return 'best_deal';
  return 'unknown';
}

// ---------- building the answer ----------

const toDeal = (o: OptionIntelligence): CopilotDeal => ({
  routeId: o.routeId,
  routeName: o.routeName,
  ship: o.ship,
  cabinCategory: o.cabinCategory,
  fareName: o.fareName,
  cruise: o.option.cruisePrice,
  flight: o.option.flightPrice,
  total: o.option.totalPrice,
  dealScore: o.dealScore,
  valueScore: o.valueScore,
});

const byDeal = (a: OptionIntelligence, b: OptionIntelligence) => b.dealScore - a.dealScore || a.option.totalPrice - b.option.totalPrice;

/** Confidence in an answer about one option: how much history there is and how sure its forecast is. */
const optionConfidence = (o: OptionIntelligence) => round2(clamp(0.35 + 0.4 * Math.min(1, o.samples / 40) + 0.2 * o.outlook.confidence, 0.1, 0.95));

/**
 * Answers a question about the tracked cruises from the analysis that is already there (deal scores, fare value, forecasts,
 * recommendations, booking windows). Every answer has a recommendation, the reasoning, a confidence and supporting metrics.
 */
export function askCopilot(question: string, portfolio: Portfolio, locale: Locale = 'en'): CopilotAnswer {
  const t = createT(locale);
  const q = normalise(question);
  const base = { question, deals: [] as CopilotDeal[], suggestions: [] as string[] };

  const routes = portfolio.routes.filter((r) => r.snapshotCount > 0);
  const named = matchRoutes(q, routes);
  const scope = named.length ? named : routes;
  const scopeIds = new Set(scope.map((r) => r.routeId));
  const scopedOptions = portfolio.options.filter((o) => scopeIds.has(o.routeId));

  const fareNames = [...new Map(portfolio.options.map((o) => [o.fare.fareCode, o.fareName])).entries()].sort((a, b) => b[1].length - a[1].length);
  const fare = fareNames.find(([, name]) => q.includes(normalise(name)));
  const cabinGroup = CABIN_WORDS.find(([re]) => re.test(q))?.[1] ?? null;
  const budget = parseBudget(question);
  const intent = detectIntent(question, !!fare);

  const filters: DealFilters = {
    ...(named.length === 1 ? { routeId: named[0]!.routeId } : {}),
    ...(cabinGroup ? { cabinGroup } : {}),
    ...(fare ? { fareCode: fare[0] } : {}),
    ...(budget !== null ? { maxBudget: budget } : {}),
    ...(/aida/.test(q) && !/mein schiff/.test(q) ? { provider: 'aida' as const } : {}),
    ...(/mein schiff|meinschiff/.test(q) ? { provider: 'mein-schiff' as const } : {}),
  };
  const limitToScope = (list: OptionIntelligence[]) => (named.length > 1 ? list.filter((o) => scopeIds.has(o.routeId)) : list);

  if (routes.length === 0) {
    return { ...base, intent, understood: true, recommendation: t('There is no price data yet. Collect your routes first.'), reasoning: [], confidence: 0, metrics: [] };
  }

  // ----- best deal / best under budget -----
  if (intent === 'best_deal' || intent === 'best_under_budget') {
    const matching = limitToScope(searchDeals(portfolio.options, filters)).sort(byDeal);
    const best = matching[0];
    if (!best) {
      const cheapest = limitToScope(searchDeals(portfolio.options, { ...filters, maxBudget: null }, 'cheapest'))[0];
      if (budget !== null && cheapest) {
        return {
          ...base,
          intent,
          understood: true,
          recommendation: t('Nothing is available under {budget}. The cheapest match is {total}, {over} above your budget.', { budget: euro(budget), total: euro(cheapest.option.totalPrice), over: euro(cheapest.option.totalPrice - budget) }),
          reasoning: [t('Trip totals include the flights: {route} · {cabin} · {fare}.', { route: cheapest.routeName, cabin: cheapest.cabinCategory, fare: cheapest.fareName })],
          confidence: optionConfidence(cheapest),
          metrics: [{ label: t('Budget'), value: euro(budget) }, { label: t('Cheapest match'), value: euro(cheapest.option.totalPrice) }],
          deals: [toDeal(cheapest)],
        };
      }
      return { ...base, intent, understood: true, recommendation: t('No offer matches this question.'), reasoning: [t('Try a different cabin, fare or budget.')], confidence: 0, metrics: [] };
    }
    const c = best.dealComponents;
    const reasoning = [
      t('Deal score {score}/100: historical position {hist}, forecast {fc}, trend {trend}{extra}.', {
        score: best.dealScore,
        hist: Math.round(c.historicalPosition),
        fc: Math.round(c.forecastOpportunity),
        trend: Math.round(c.trend),
        extra: c.fareValue === null ? '' : `, ${t('fare value')} ${Math.round(c.fareValue)}`,
      }),
      t('Fare value {value}/100 ({label}).', { value: best.valueScore, label: t(best.valueLabel) }),
      best.pctAboveLow === 0 ? t('The price is at its lowest level so far.') : t('The price is {pct}% above its own historical low of {low}.', { pct: best.pctAboveLow.toFixed(1), low: euro(best.historicalLow) }),
    ];
    if (best.expectedSavings !== null && Math.abs(best.expectedSavings) >= 1) {
      reasoning.push(best.expectedSavings > 0 ? t('The 30-day trend expects the price to fall by about {amount}.', { amount: euro(best.expectedSavings) }) : t('The 30-day trend expects the price to rise by about {amount}.', { amount: euro(-best.expectedSavings) }));
    }
    if (budget !== null) reasoning.push(t('{n} offers are within your budget of {budget}.', { n: matching.length, budget: euro(budget) }));
    return {
      ...base,
      intent,
      understood: true,
      recommendation: t('Best deal right now: {route} · {cabin} · {fare} for {total} (cruise {cruise} + flight {flight}).', { route: best.routeName, cabin: best.cabinCategory, fare: best.fareName, total: euro(best.option.totalPrice), cruise: euro(best.option.cruisePrice), flight: euro(best.option.flightPrice) }),
      reasoning,
      confidence: optionConfidence(best),
      metrics: [
        { label: t('Trip total'), value: euro(best.option.totalPrice) },
        { label: t('Deal score'), value: `${best.dealScore}/100` },
        { label: t('Fare value score'), value: `${best.valueScore}/100` },
        { label: t('Historical low'), value: euro(best.historicalLow) },
        ...(best.outlook.expected30dChangePct === null ? [] : [{ label: t('Expected 30-day change'), value: `${best.outlook.expected30dChangePct > 0 ? '+' : ''}${best.outlook.expected30dChangePct.toFixed(1)}%` }]),
      ],
      deals: matching.slice(0, 5).map(toDeal),
    };
  }

  // ----- is a fare worth the surcharge -----
  if (intent === 'fare_worth' && fare) {
    const [fareCode, fareName] = fare;
    const candidates = scopedOptions.filter((o) => o.fare.fareCode === fareCode && (!cabinGroup || o.cabinGroup === cabinGroup));
    const rows = candidates
      .map((o) => {
        const sameCabin = scopedOptions.filter((x) => x.routeId === o.routeId && x.cabinCategory === o.cabinCategory);
        const cheapest = sameCabin.reduce((a, b) => (b.option.totalPrice < a.option.totalPrice ? b : a));
        return { o, cheapest, surcharge: round2(o.option.totalPrice - cheapest.option.totalPrice) };
      })
      .sort((a, b) => b.o.valueScore - a.o.valueScore || a.surcharge - b.surcharge);
    const pick = rows[0];
    if (!pick) return { ...base, intent, understood: true, recommendation: t('{fare} is not offered in the selected routes or cabins.', { fare: fareName }), reasoning: [], confidence: 0, metrics: [] };
    const { o, cheapest, surcharge } = pick;
    const pct = cheapest.option.totalPrice === 0 ? 0 : round2((surcharge / cheapest.option.totalPrice) * 100);
    const extra = o.fare.includedServices.length - cheapest.fare.includedServices.length;
    const isCheapest = o.fare.fareCode === cheapest.fare.fareCode;
    const bestInCabin = scopedOptions.find((x) => x.routeId === o.routeId && x.cabinCategory === o.cabinCategory && x.recommendedFare)!;
    const worth = isCheapest || o.valueScore >= 75 || (pct <= 5 && extra > 0);
    const unclear = !worth && o.valueScore >= 60;
    const recommendation = isCheapest
      ? t('{fare} is the cheapest fare for {cabin} on {route}, so there is no surcharge to justify.', { fare: o.fareName, cabin: o.cabinCategory, route: o.routeName })
      : worth
        ? t('Yes, {fare} is worth the surcharge of {amount} ({pct}%) on {route} · {cabin}.', { fare: o.fareName, amount: euro(surcharge), pct: pct.toFixed(1), route: o.routeName, cabin: o.cabinCategory })
        : unclear
          ? t('It is a close call: {fare} costs {amount} ({pct}%) more than {base} on {route} · {cabin}.', { fare: o.fareName, amount: euro(surcharge), pct: pct.toFixed(1), base: cheapest.fareName, route: o.routeName, cabin: o.cabinCategory })
          : t('No, {fare} is not worth the surcharge of {amount} ({pct}%) on {route} · {cabin}; {best} offers better value.', { fare: o.fareName, amount: euro(surcharge), pct: pct.toFixed(1), route: o.routeName, cabin: o.cabinCategory, best: bestInCabin.fareName });
    const reasoning = [
      isCheapest ? t('Fare value {value}/100 ({label}).', { value: o.valueScore, label: t(o.valueLabel) }) : t('Fare value {value}/100 ({label}); {base} scores {baseValue}/100.', { value: o.valueScore, label: t(o.valueLabel), base: cheapest.fareName, baseValue: cheapest.valueScore }),
      extra > 0 ? t('{fare} includes {n} more listed services than {base}.', { fare: o.fareName, n: extra, base: cheapest.fareName }) : extra < 0 ? t('{fare} lists {n} fewer services than {base}.', { fare: o.fareName, n: -extra, base: cheapest.fareName }) : t('Both fares list the same number of services; unlisted services stay unknown.'),
      t('Recommended fare for this cabin by value: {fare}.', { fare: bestInCabin.fareName }),
    ];
    return {
      ...base,
      intent,
      understood: true,
      recommendation,
      reasoning,
      confidence: optionConfidence(o),
      metrics: [
        { label: t('Surcharge'), value: euro(surcharge) },
        { label: t('Surcharge in percent'), value: `${pct.toFixed(1)}%` },
        { label: t('Fare value score'), value: `${o.valueScore}/100` },
        { label: t('Extra services'), value: String(extra) },
      ],
      deals: [toDeal(o), ...(isCheapest ? [] : [toDeal(cheapest)])],
    };
  }

  // ----- book now? -----
  if (intent === 'book_now') {
    const pick = named.length ? named[0]! : [...routes].sort((a, b) => b.dealScore - a.dealScore)[0]!;
    const r = pick.recommendation;
    const w = pick.recommendedBookingWindow;
    const reasoning = [...r.explanation];
    if (named.length === 0) reasoning.push(t('No route was named, so this is the route with the best deal score. Others: {others}.', { others: routes.filter((x) => x.routeId !== pick.routeId).map((x) => `${x.routeName}: ${t(x.recommendation.action)}`).join('; ') || '–' }));
    if (w) reasoning.push(w.insideWindow ? t('Today is inside the recommended booking window of {from}-{to} days before departure.', { from: w.from, to: w.to }) : t('The recommended booking window is {from}-{to} days before departure; today is {days} days before.', { from: w.from, to: w.to, days: w.currentDaysBefore }));
    return {
      ...base,
      intent,
      understood: true,
      recommendation: t('Recommendation for {route}: {action}.', { route: pick.routeName, action: t(r.action) }),
      reasoning,
      confidence: r.confidence,
      metrics: [
        { label: t('Trip total'), value: pick.analytics ? euro(pick.analytics.current) : '–' },
        { label: t('Above historical low'), value: r.factors.pctAboveLow === null ? '–' : `${r.factors.pctAboveLow.toFixed(1)}%` },
        { label: t('Expected 30-day change'), value: r.factors.expectedChange30dPct === null ? '–' : `${r.factors.expectedChange30dPct > 0 ? '+' : ''}${r.factors.expectedChange30dPct.toFixed(1)}%` },
        { label: t('Deal score'), value: `${pick.dealScore}/100` },
      ],
      deals: [],
    };
  }

  // ----- when was it cheapest -----
  if (intent === 'historically_cheapest') {
    const pick = named.length ? named[0]! : [...routes].sort((a, b) => b.snapshotCount - a.snapshotCount)[0]!;
    const a = pick.analytics;
    if (!a || pick.snapshotCount < 2) return { ...base, intent, understood: true, recommendation: t('There is not enough history for {route} yet.', { route: pick.routeName }), reasoning: [], confidence: 0, metrics: [] };
    const daysBefore = pick.departure ? Math.round((Date.parse(pick.departure) - Date.parse(a.minAt)) / 86_400_000) : null;
    const lm = pick.lastMinute;
    const reasoning = [
      t('Today the trip total is {now}, {pct}% above that low.', { now: euro(a.current), pct: a.pctToMin.toFixed(1) }),
      ...(lm.available && lm.lowestWindow ? [lm.note] : []),
      ...(pick.recommendedBookingWindow ? [pick.recommendedBookingWindow.note] : []),
    ];
    if (named.length === 0) reasoning.push(t('No route was named, so this is the route with the longest history.'));
    return {
      ...base,
      intent,
      understood: true,
      recommendation: daysBefore === null
        ? t('The lowest trip total of {route} was {price} on {date}.', { route: pick.routeName, price: euro(a.min), date: a.minAt.slice(0, 10) })
        : t('The lowest trip total of {route} was {price} on {date}, {days} days before departure.', { route: pick.routeName, price: euro(a.min), date: a.minAt.slice(0, 10), days: daysBefore }),
      reasoning,
      confidence: round2(clamp(0.3 + 0.6 * Math.min(1, pick.snapshotCount / 60), 0.1, 0.95)),
      metrics: [
        { label: t('Historical low'), value: euro(a.min) },
        { label: t('Date of the low'), value: a.minAt.slice(0, 10) },
        { label: t('Historical high'), value: euro(a.max) },
        { label: t('Trip total'), value: euro(a.current) },
      ],
      deals: [],
    };
  }

  return { ...base, intent: 'unknown', understood: false, recommendation: t('I could not match this question to anything I can answer.'), reasoning: [t('I can compare deals, judge fares and upgrades, and say when to book. Try one of these questions.')], confidence: 0, metrics: [], suggestions: COPILOT_EXAMPLES.map((e) => t(e)) };
}
