export const PROVIDER_IDS = ['aida', 'mein-schiff'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  aida: 'AIDA',
  'mein-schiff': 'Mein Schiff',
};

const PROVIDER_HOSTS: Record<ProviderId, readonly string[]> = {
  aida: ['aida.de'],
  'mein-schiff': ['meinschiff.com', 'tuicruises.com'],
};

/** Single source of truth for "which provider does this URL belong to". */
export function detectProviderId(url: string): ProviderId | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const id of PROVIDER_IDS) {
    if (PROVIDER_HOSTS[id].some((h) => host === h || host.endsWith(`.${h}`))) return id;
  }
  return null;
}
