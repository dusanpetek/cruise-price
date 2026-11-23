import { CABIN_GROUPS, cabinGroupOf, type CabinGroup, type CruiseSnapshot, type ProviderId } from '@cruise/domain';

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type UpgradeVerdict = 'RECOMMENDED' | 'CONSIDER' | 'NOT_WORTH';

/** An upgrade is recommended when it costs at most this share of the cheaper cabin, whatever the history says. */
export const CHEAP_UPGRADE_PCT = 5;
/** The history needs at least this many collections with both cabins to define the "typical" upgrade price. */
export const MIN_UPGRADE_SAMPLES = 3;

export interface UpgradeSide {
  cabinCategory: string;
  group: CabinGroup;
  /** Trip total (cruise + flight + fees) and its parts. */
  total: number;
  cruise: number;
  flight: number;
}

export interface UpgradeOpportunity {
  routeId: string;
  routeName: string;
  provider: ProviderId;
  /** The fare both cabins are compared at; null when the snapshot has no fare data (then the cheapest price per cabin is used). */
  fareCode: string | null;
  fareName: string | null;
  from: UpgradeSide;
  to: UpgradeSide;
  /** Trip total of the better cabin minus that of the cheaper cabin. */
  costDifference: number;
  /** costDifference as a share of the cheaper cabin's trip total. */
  pctDifference: number;
  /** What this upgrade has cost on average in the history; null with too little history. */
  typicalDifference: number | null;
  /** typicalDifference - costDifference: what today's upgrade price saves against the usual one (null without history). */
  upgradeValue: number | null;
  /** 0..100: how cheap the upgrade is compared with its usual price (50 = usual, 100 = free). */
  upgradeScore: number;
  verdict: UpgradeVerdict;
  samples: number;
}

interface Priced {
  cabinCategory: string;
  fareCode: string | null;
  total: number;
  cruise: number;
  flight: number;
}

/** The cheapest option of every cabin group in one snapshot, for one fare (null = cabin-level prices without fares). */
function cheapestByGroup(snapshot: CruiseSnapshot, fareCode: string | null): Map<CabinGroup, Priced> {
  const entries: Priced[] =
    fareCode === null
      ? snapshot.cabins.map((c) => ({ cabinCategory: c.category, fareCode: null, total: c.tripTotal, cruise: c.packageTotal, flight: c.flightTotal }))
      : snapshot.options.filter((o) => o.fareCode === fareCode).map((o) => ({ cabinCategory: o.cabinCategory, fareCode, total: o.totalPrice, cruise: o.cruisePrice, flight: o.flightPrice }));
  const out = new Map<CabinGroup, Priced>();
  for (const e of entries) {
    const group = cabinGroupOf(e.cabinCategory);
    if (!group) continue;
    const cur = out.get(group);
    if (!cur || e.total < cur.total) out.set(group, e);
  }
  return out;
}

const side = (p: Priced, group: CabinGroup): UpgradeSide => ({ cabinCategory: p.cabinCategory, group, total: p.total, cruise: p.cruise, flight: p.flight });

/**
 * Is moving up one cabin group worth it? For every fare (or the cheapest prices without fare data) each neighbouring pair of
 * cabin groups is compared on the TRIP total: what the upgrade costs today, as a share, and against what it has usually cost.
 */
export function analyzeUpgrades(route: { id: string; name: string; provider: ProviderId }, snapshots: readonly CruiseSnapshot[]): UpgradeOpportunity[] {
  const sorted = [...snapshots].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const latest = sorted.at(-1);
  if (!latest) return [];
  const hasFares = latest.options.length > 0;
  const fareCodes: (string | null)[] = hasFares ? [...new Set(latest.options.map((o) => o.fareCode))] : [null];

  const out: UpgradeOpportunity[] = [];
  for (const fareCode of fareCodes) {
    const now = cheapestByGroup(latest, fareCode);
    const groups = CABIN_GROUPS.filter((g) => now.has(g));
    for (let i = 0; i + 1 < groups.length; i++) {
      const lowerGroup = groups[i]!;
      const upperGroup = groups[i + 1]!;
      const lower = now.get(lowerGroup)!;
      const upper = now.get(upperGroup)!;
      const cost = round2(upper.total - lower.total);

      // What the same upgrade cost in the earlier collections.
      const past: number[] = [];
      for (const s of sorted) {
        if (s === latest) continue;
        const m = cheapestByGroup(s, fareCode);
        const a = m.get(lowerGroup);
        const b = m.get(upperGroup);
        if (a && b) past.push(b.total - a.total);
      }
      const typical = past.length >= MIN_UPGRADE_SAMPLES ? round2(past.reduce((x, y) => x + y, 0) / past.length) : null;
      const pct = lower.total === 0 ? 0 : round2((cost / lower.total) * 100);
      const score =
        typical !== null && typical > 0
          ? Math.round(clamp(100 - (Math.max(cost, 0) / typical) * 50, 0, 100))
          : pct <= 0 ? 100 : pct <= 5 ? 85 : pct <= 10 ? 70 : pct <= 20 ? 50 : pct <= 35 ? 30 : 15;
      const verdict: UpgradeVerdict = pct <= CHEAP_UPGRADE_PCT || score >= 75 ? 'RECOMMENDED' : score >= 50 ? 'CONSIDER' : 'NOT_WORTH';
      out.push({
        routeId: route.id,
        routeName: route.name,
        provider: route.provider,
        fareCode,
        fareName: fareCode === null ? null : (latest.fares.find((f) => f.fareCode === fareCode)?.fareName ?? fareCode),
        from: side(lower, lowerGroup),
        to: side(upper, upperGroup),
        costDifference: cost,
        pctDifference: pct,
        typicalDifference: typical,
        upgradeValue: typical === null ? null : round2(typical - cost),
        upgradeScore: score,
        verdict,
        samples: past.length + 1,
      });
    }
  }
  return out;
}

/** The upgrade with the best score (ties go to the cheaper one); null when there is none. */
export function bestUpgradeOf(upgrades: readonly UpgradeOpportunity[]): UpgradeOpportunity | null {
  return upgrades.length === 0 ? null : upgrades.reduce((a, b) => (b.upgradeScore > a.upgradeScore || (b.upgradeScore === a.upgradeScore && b.costDifference < a.costDifference) ? b : a));
}
