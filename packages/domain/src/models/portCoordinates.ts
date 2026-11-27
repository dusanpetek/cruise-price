import type { ItineraryStop } from './Itinerary';

type Coordinate = { lat: number; lng: number };

/**
 * Port coordinates in decimal degrees, keyed by UN/LOCODE. Sources:
 * - UN/LOCODE code list (datasets/un-locode, degrees and minutes): ESLPA, ESSPC, ESACE, PTFNC
 * - Wikidata records carrying the UN/LOCODE (P1937) and coordinates (P625): ESFUE (Q540185), MAAGA (Q170525)
 */
const PORT_COORDINATES: Record<string, Coordinate> = {
  ESLPA: { lat: 28.1, lng: -15.4167 }, // Las Palmas de Gran Canaria, 28°06'N 15°25'W
  ESSPC: { lat: 28.6833, lng: -17.7667 }, // Santa Cruz de La Palma, 28°41'N 17°46'W
  MAAGA: { lat: 30.4214, lng: -9.5831 }, // Agadir
  ESFUE: { lat: 28.5, lng: -13.8667 }, // Puerto del Rosario
  ESACE: { lat: 28.9667, lng: -13.5333 }, // Arrecife (Lanzarote), 28°58'N 13°32'W
  PTFNC: { lat: 32.6333, lng: -16.9 }, // Funchal (Madeira), 32°38'N 16°54'W
};

/** Normalized port name to UN/LOCODE, for providers that give names only (Mein Schiff). */
const NAME_ALIASES: Record<string, string> = {
  'las palmas': 'ESLPA',
  'santa cruz de la palma': 'ESSPC',
  agadir: 'MAAGA',
  'puerto del rosario': 'ESFUE',
  arrecife: 'ESACE',
  funchal: 'PTFNC',
};

/** Lowercase, diacritics folded, anything after "/" or "(" dropped. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[/(].*$/, '')
    .trim();
}

/** Coordinates of a stop: by UN/LOCODE first, then by normalized name. Null when the port is unknown. */
export function portCoordinate(stop: Pick<ItineraryStop, 'code' | 'name'>): Coordinate | null {
  const byCode = stop.code ? PORT_COORDINATES[stop.code] : undefined;
  if (byCode) return byCode;
  const alias = stop.name ? NAME_ALIASES[normalizeName(stop.name)] : undefined;
  return (alias ? PORT_COORDINATES[alias] : undefined) ?? null;
}
