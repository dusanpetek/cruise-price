import { createT, type Locale } from '@cruise/i18n';
import { fareGroupSeries, fareName } from './fares';
import {
  CABIN_GROUP_LABELS,
  cabinGroupOf,
  type AlertRule,
  type AlertType,
  type CabinGroup,
  type CruiseSnapshot,
} from '@cruise/domain';

export interface PriceObservation {
  snapshotId: string;
  collectedAt: string;
  price: number;
  /** For fare series (price = total trip price): the cruise and flight parts it is made of. */
  cruise?: number;
  flight?: number;
}

/**
 * TRIP total series for one cabin group (the cheapest trip of the group in each snapshot), or the headline trip total
 * when `group` is null. `cruise` and `flight` carry the parts. Snapshots without a cabin in the group are skipped. Oldest first.
 */
export function groupSeries(snapshots: readonly CruiseSnapshot[], group: CabinGroup | null): PriceObservation[] {
  const out = snapshots.flatMap((s): PriceObservation[] => {
    if (group === null) return [{ snapshotId: s.id, collectedAt: s.collectedAt, price: s.pricing.tripTotal, cruise: s.pricing.cruiseTotal, flight: s.pricing.flightTotal }];
    const inGroup = s.cabins.filter((c) => cabinGroupOf(c.category) === group);
    if (inGroup.length === 0) return [];
    const best = inGroup.reduce((a, b) => (b.tripTotal < a.tripTotal ? b : a));
    return [{ snapshotId: s.id, collectedAt: s.collectedAt, price: best.tripTotal, cruise: best.packageTotal, flight: best.flightTotal }];
  });
  return out.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}

export const categoryLabel = (group: CabinGroup | null) => (group ? CABIN_GROUP_LABELS[group] : 'Cheapest cabin');

/** The cruise and flight parts of an observation; an observation without a breakdown counts as cruise only. */
export const tripParts = (o: PriceObservation) => ({ cruise: o.cruise ?? o.price, flight: o.flight ?? 0 });

/**
 * The text of an alert, built from its numbers so it can be shown in any language later. Every alert says what the whole
 * trip costs: "Trip total: 3.579 € (cruise 2.399 € + flight 1.180 €)".
 */
export function alertMessage(
  locale: Locale,
  a: { type: AlertType; currentPrice: number; referencePrice: number | null; cruisePrice: number | null; flightPrice: number | null },
): string {
  const t = createT(locale);
  const cruise = a.cruisePrice ?? a.currentPrice;
  const flight = a.flightPrice ?? 0;
  const ref = a.referencePrice ?? 0;
  const head =
    a.type === 'NEW_LOW'
      ? t('New historical low detected: {current} (previous low {ref}).', { current: euro(a.currentPrice), ref: euro(ref) })
      : a.type === 'PERCENT_DROP'
        ? t('Price dropped {pct}% to {current} (from {ref}).', { pct: ref === 0 ? '0.0' : (((ref - a.currentPrice) / ref) * 100).toFixed(1), current: euro(a.currentPrice), ref: euro(ref) })
        : t('Target price reached: {current} (target {ref}).', { current: euro(a.currentPrice), ref: euro(ref) });
  return `${head} ${t('Trip total: {total} (cruise {cruise} + flight {flight}).', { total: euro(cruise + flight), cruise: euro(cruise), flight: euro(flight) })}`;
}

export const euro = (n: number) => `${Math.round(n).toLocaleString('de-DE')} €`;

export interface AlertCandidate {
  ruleId: string;
  type: AlertType;
  category: string;
  cabinGroup: CabinGroup | null;
  currentPrice: number;
  referencePrice: number | null;
  message: string;
  snapshotId: string;
  cruisePrice: number;
  flightPrice: number;
  totalPrice: number;
}

/**
 * Evaluates the rules against the newest snapshot of a route (call it right after a collection).
 * Every rule compares the TRIP total (cruise + flight + mandatory fees):
 *  - NEW_LOW: the newest trip total is strictly below every earlier one.
 *  - PERCENT_DROP: the newest trip total is at least `percent`% below the previous collection's.
 *  - TARGET_PRICE: the newest trip total is at or below the target and the previous one was not (fires on crossing).
 * A rule that targets a cabin group is skipped if the newest snapshot has no such cabin.
 */
export function evaluateAlerts(args: {
  routeId: string;
  snapshots: readonly CruiseSnapshot[];
  rules: readonly AlertRule[];
  locale?: Locale;
}): AlertCandidate[] {
  const { routeId, snapshots, rules, locale = 'en' } = args;
  const latest = [...snapshots].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).at(-1);
  if (!latest) return [];

  const out: AlertCandidate[] = [];
  for (const rule of rules) {
    if (!rule.enabled || (rule.routeId !== null && rule.routeId !== routeId)) continue;
    const series = rule.fare ? fareGroupSeries(snapshots, rule.cabin, rule.fare) : groupSeries(snapshots, rule.cabin);
    const current = series.at(-1);
    if (!current || current.snapshotId !== latest.id) continue;
    const history = series.slice(0, -1);
    const previous = history.at(-1) ?? null;
    const category = rule.fare ? `${categoryLabel(rule.cabin)} · ${fareName(latest, rule.fare)}` : categoryLabel(rule.cabin);
    const base = { ruleId: rule.id, type: rule.type, category, cabinGroup: rule.cabin, currentPrice: current.price, snapshotId: current.snapshotId, cruisePrice: tripParts(current).cruise, flightPrice: tripParts(current).flight, totalPrice: tripParts(current).cruise + tripParts(current).flight };

    if (rule.type === 'NEW_LOW' && history.length > 0) {
      const previousLow = Math.min(...history.map((h) => h.price));
      if (current.price < previousLow) {
        out.push({ ...base, referencePrice: previousLow, message: alertMessage(locale, { type: rule.type, currentPrice: current.price, referencePrice: previousLow, cruisePrice: tripParts(current).cruise, flightPrice: tripParts(current).flight }) });
      }
    } else if (rule.type === 'PERCENT_DROP' && previous && previous.price > 0 && rule.percent !== null) {
      const drop = ((previous.price - current.price) / previous.price) * 100;
      if (drop >= rule.percent) {
        out.push({ ...base, referencePrice: previous.price, message: alertMessage(locale, { type: rule.type, currentPrice: current.price, referencePrice: previous.price, cruisePrice: tripParts(current).cruise, flightPrice: tripParts(current).flight }) });
      }
    } else if (rule.type === 'TARGET_PRICE' && rule.targetPrice !== null) {
      if (current.price <= rule.targetPrice && (!previous || previous.price > rule.targetPrice)) {
        out.push({ ...base, referencePrice: rule.targetPrice, message: alertMessage(locale, { type: rule.type, currentPrice: current.price, referencePrice: rule.targetPrice, cruisePrice: tripParts(current).cruise, flightPrice: tripParts(current).flight }) });
      }
    }
  }
  return out;
}
