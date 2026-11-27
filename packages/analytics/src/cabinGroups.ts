import { CABIN_GROUPS, cabinGroupOf, type CabinGroup, type CruiseSnapshot } from '@cruise/domain';

export interface CabinGroupEntry {
  category: string;
  subcategory: string | null;
  tripPerPerson: number;
  tripTotal: number;
  /** Trip total minus the cheapest entry's total in the same group. */
  deltaToCheapest: number;
}

export interface CabinGroupBreakdown {
  /** `null` collects categories no group recognises. */
  group: CabinGroup | null;
  /** Ascending by trip total. */
  entries: CabinGroupEntry[];
  /** Most expensive minus cheapest trip total (0 for a single entry). */
  spread: number;
}

type CabinGroupEntryBase = Omit<CabinGroupEntry, 'deltaToCheapest'>;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Options of one fare reduced to the cheapest (flight variant) per cabin category. */
function cabinRowsOfFare(snapshot: CruiseSnapshot, fareCode: string) {
  const cheapest = new Map<string, CabinGroupEntryBase>();
  for (const o of snapshot.options) {
    if (o.fareCode !== fareCode) continue;
    const known = cheapest.get(o.cabinCategory);
    if (!known || o.totalPrice < known.tripTotal) cheapest.set(o.cabinCategory, { category: o.cabinCategory, subcategory: o.subcategory, tripPerPerson: o.tripPerPerson, tripTotal: o.totalPrice });
  }
  return [...cheapest.values()];
}

/**
 * Cabin categories of a snapshot grouped by cabin group (TRIP totals): at each cabin's cheapest fare, or, with `fareCode`,
 * at that fare's options. Groups follow CABIN_GROUPS order, unrecognised categories come last, empty groups are omitted.
 */
export function cabinGroupBreakdown(snapshot: CruiseSnapshot, fareCode: string | null = null): CabinGroupBreakdown[] {
  const rows = fareCode ? cabinRowsOfFare(snapshot, fareCode) : snapshot.cabins.map((c) => ({ category: c.category, subcategory: c.subcategory, tripPerPerson: c.tripPerPerson, tripTotal: c.tripTotal }));
  const order: (CabinGroup | null)[] = [...CABIN_GROUPS, null];
  return order.flatMap((group): CabinGroupBreakdown[] => {
    const members = rows.filter((r) => cabinGroupOf(r.category) === group).sort((a, b) => a.tripTotal - b.tripTotal);
    if (members.length === 0) return [];
    const cheapest = members[0]!.tripTotal;
    return [
      {
        group,
        entries: members.map((m) => ({ ...m, deltaToCheapest: round2(m.tripTotal - cheapest) })),
        spread: round2(members[members.length - 1]!.tripTotal - cheapest),
      },
    ];
  });
}
