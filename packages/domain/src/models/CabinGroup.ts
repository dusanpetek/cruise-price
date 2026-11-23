export const CABIN_GROUPS = ['inside', 'ocean-view', 'balcony', 'junior-suite', 'suite'] as const;
export type CabinGroup = (typeof CABIN_GROUPS)[number];

export const CABIN_GROUP_LABELS: Record<CabinGroup, string> = {
  inside: 'Inside',
  'ocean-view': 'Ocean View',
  balcony: 'Balcony',
  'junior-suite': 'Junior Suite',
  suite: 'Suite',
};

/**
 * Maps a provider's cabin category name onto the five groups used for alerts and recommendations.
 * Order matters: "Junior Suite Balkon" is a junior suite, "Verandakabine" is a balcony cabin.
 */
export function cabinGroupOf(category: string): CabinGroup | null {
  const c = category.toLowerCase();
  if (/junior/.test(c)) return 'junior-suite';
  if (/suite/.test(c)) return 'suite';
  if (/innen|inside|interior/.test(c)) return 'inside';
  if (/balkon|veranda|balcony/.test(c)) return 'balcony';
  if (/meerblick|außen|aussen|ocean|outside/.test(c)) return 'ocean-view';
  return null;
}
