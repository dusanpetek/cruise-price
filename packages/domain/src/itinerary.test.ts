import { describe, expect, it } from 'vitest';
import { ItinerarySchema, ItineraryStopSchema, drawableStops, formatStopTime, portCoordinate, type ItineraryStop } from './index';

const stop = (over: Partial<ItineraryStop>): ItineraryStop => ({
  code: null,
  name: null,
  seaDay: false,
  arrival: null,
  departure: null,
  lat: null,
  lng: null,
  ...over,
});

describe('portCoordinate', () => {
  it('resolves a known UN/LOCODE and returns null for an unknown one', () => {
    expect(portCoordinate({ code: 'ESSPC', name: null })).not.toBeNull();
    expect(portCoordinate({ code: 'XXXXX', name: null })).toBeNull();
  });

  it('falls back to the normalized name alias for stops without a code', () => {
    expect(portCoordinate({ code: null, name: 'Funchal/Madeira' })).toEqual(portCoordinate({ code: 'PTFNC', name: null }));
    expect(portCoordinate({ code: null, name: 'Funchal/Madeira' })).not.toBeNull();
  });
});

describe('printed Mein Schiff port names', () => {
  const printed = ['Las Palmas', 'Funchal', 'Santa Cruz', 'Las Palmas'].map((name) => stop({ name }));

  it('resolves Las Palmas and Funchal, leaves the ambiguous Santa Cruz undrawn', () => {
    expect(portCoordinate({ code: null, name: 'Las Palmas' })).not.toBeNull();
    expect(portCoordinate({ code: null, name: 'Funchal' })).not.toBeNull();
    expect(portCoordinate({ code: null, name: 'Santa Cruz' })).toBeNull();
    expect(drawableStops(printed).map((d) => d.stop.name)).toEqual(['Las Palmas', 'Funchal', 'Las Palmas']);
  });
});

describe('drawableStops', () => {
  it('drops sea days and unknown ports and keeps the order', () => {
    const stops = [
      stop({ code: 'ESLPA', arrival: '2026-11-29T08:00:00' }),
      stop({ code: 'SEE', seaDay: true }),
      stop({ code: 'ESLPA', arrival: '2026-12-01T08:00:00' }),
      stop({ code: 'XXXXX' }),
      stop({ code: 'ESLPA', arrival: '2026-12-05T08:00:00' }),
    ];
    const drawn = drawableStops(stops);
    expect(drawn).toHaveLength(3);
    expect(drawn.map((d) => d.stop.arrival)).toEqual(['2026-11-29T08:00:00', '2026-12-01T08:00:00', '2026-12-05T08:00:00']);
    expect(drawn.every((d) => typeof d.lat === 'number' && typeof d.lng === 'number')).toBe(true);
  });
});

describe('formatStopTime', () => {
  it('slices date and time, null stays null', () => {
    expect(formatStopTime('2026-11-29T10:00:00')).toEqual({ date: '2026-11-29', time: '10:00' });
    expect(formatStopTime(null)).toBeNull();
  });
});

describe('ItineraryStopSchema', () => {
  it('accepts a null arrival and rejects a date without time', () => {
    expect(ItineraryStopSchema.safeParse(stop({ arrival: null })).success).toBe(true);
    expect(ItineraryStopSchema.safeParse(stop({ arrival: '2026-11-29' })).success).toBe(false);
  });
});

describe('Mein Schiff names with an island qualifier', () => {
  it('Santa Cruz (La Palma) and (Teneriffa) resolve to their own ports, plain Santa Cruz stays unknown', () => {
    expect(portCoordinate({ code: null, name: 'Santa Cruz (La Palma)' })).toEqual(portCoordinate({ code: 'ESSPC', name: null }));
    expect(portCoordinate({ code: null, name: 'Santa Cruz (Teneriffa)' })).toEqual(portCoordinate({ code: 'ESSCT', name: null }));
    expect(portCoordinate({ code: null, name: 'Santa Cruz (Teneriffa)' })).not.toBeNull();
    expect(portCoordinate({ code: null, name: 'Santa Cruz' })).toBeNull();
  });

  it.each([
    ['Las Palmas (Gran Canaria)', 'ESLPA'],
    ['Funchal (Madeira)', 'PTFNC'],
    ['Arrecife (Lanzarote)', 'ESACE'],
  ])('%s resolves like %s', (name, code) => {
    expect(portCoordinate({ code: null, name })).toEqual(portCoordinate({ code, name: null }));
    expect(portCoordinate({ code: null, name })).not.toBeNull();
  });
});

describe('Seychelles (AIDAblu "Mauritius, Seychellen & Madagaskar", route as stored on the server)', () => {
  const stop = (code: string, name: string): ItineraryStop => ({ code, name, seaDay: false, arrival: null, departure: null, lat: null, lng: null });
  it('draws every port of the route, the Seychelles included, in order', () => {
    const stops = [stop('MUPLU', 'Port Louis'), stop('RELPT', 'Le Port'), stop('SCLDI', 'La Digue'), stop('SCPOV', 'Mahe'), stop('MGDIE', 'Antsiranana'), stop('MGNOS', 'Nosy Be'), stop('MUPLU', 'Port Louis')];
    expect(drawableStops(stops).map((v) => v.stop.code)).toEqual(['MUPLU', 'RELPT', 'SCLDI', 'SCPOV', 'MGDIE', 'MGNOS', 'MUPLU']);
  });
  it('puts La Digue and Mahé in the Seychelles (south of the equator, about 55.5 degrees east)', () => {
    for (const code of ['SCLDI', 'SCPOV']) {
      const c = portCoordinate({ code, name: null })!;
      expect(c.lat).toBeLessThan(-4);
      expect(c.lat).toBeGreaterThan(-5);
      expect(c.lng).toBeGreaterThan(55);
      expect(c.lng).toBeLessThan(56);
    }
  });
});

describe('stored stop position', () => {
  it('defaults lat/lng to null and still parses an old stored itinerary', () => {
    const parsed = ItineraryStopSchema.parse({ code: 'SCPOV', name: 'Port Victoria', seaDay: false, arrival: null, departure: null });
    expect(parsed.lat).toBeNull();
    expect(parsed.lng).toBeNull();
    const old = {
      routeId: 'r1',
      provider: 'aida',
      readAt: '2026-11-27T10:00:00.000Z',
      stops: [{ code: 'ESLPA', name: 'Las Palmas', seaDay: false, arrival: null, departure: null }],
    };
    expect(ItinerarySchema.safeParse(old).success).toBe(true);
  });

  it('rejects a position with only one coordinate', () => {
    expect(ItineraryStopSchema.safeParse(stop({ lat: 10 })).success).toBe(false);
    expect(ItineraryStopSchema.safeParse(stop({ lng: 10 })).success).toBe(false);
    expect(ItineraryStopSchema.safeParse(stop({ lat: 10, lng: 20 })).success).toBe(true);
  });

  it('draws a stop with an unknown code from its stored position, in order', () => {
    const stops = [
      stop({ code: 'ESLPA' }),
      stop({ code: 'XXXXX', lat: -4.62, lng: 55.45 }),
      stop({ code: 'YYYYY' }),
    ];
    const drawn = drawableStops(stops);
    expect(drawn.map((d) => d.stop.code)).toEqual(['ESLPA', 'XXXXX']);
    expect(drawn[1]).toMatchObject({ lat: -4.62, lng: 55.45 });
  });

  it('does not draw a stop object that lacks the position fields (unparsed API JSON)', () => {
    const raw = { code: 'XXXXX', name: 'Nowhere', seaDay: false, arrival: null, departure: null } as unknown as ItineraryStop;
    expect(drawableStops([raw])).toEqual([]);
  });

  it('lets the table coordinate win over a stored position', () => {
    const table = portCoordinate({ code: 'ESLPA', name: null })!;
    const [drawn] = drawableStops([stop({ code: 'ESLPA', lat: 1, lng: 2 })]);
    expect(drawn).toMatchObject({ lat: table.lat, lng: table.lng });
  });
});
