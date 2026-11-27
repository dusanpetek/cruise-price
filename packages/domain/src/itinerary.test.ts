import { describe, expect, it } from 'vitest';
import { ItineraryStopSchema, drawableStops, formatStopTime, portCoordinate, type ItineraryStop } from './index';

const stop = (over: Partial<ItineraryStop>): ItineraryStop => ({
  code: null,
  name: null,
  seaDay: false,
  arrival: null,
  departure: null,
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
