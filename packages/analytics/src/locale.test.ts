import { describe, expect, it } from 'vitest';
import { alertMessage } from './alerts';
import { recommend } from './recommendation';

describe('German texts', () => {
  const alert = { currentPrice: 1000, referencePrice: 1200, cruisePrice: 800, flightPrice: 200 };

  it('writes alert messages in German and English from the same numbers', () => {
    expect(alertMessage('de', { type: 'NEW_LOW', ...alert })).toContain('Neuer historischer Tiefstpreis');
    expect(alertMessage('en', { type: 'NEW_LOW', ...alert })).toContain('New historical low');
    expect(alertMessage('de', { type: 'PERCENT_DROP', ...alert })).toContain('gefallen');
    expect(alertMessage('de', { type: 'TARGET_PRICE', ...alert })).toContain('Zielpreis erreicht');
    expect(alertMessage('de', { type: 'NEW_LOW', ...alert })).toContain('Kreuzfahrt');
  });

  it('explains a missing history in German', () => {
    expect(recommend([], null, 'de').reason).toBe('Noch kein Preisverlauf.');
    expect(recommend([], null).reason).toBe('No price history yet.');
  });
});
