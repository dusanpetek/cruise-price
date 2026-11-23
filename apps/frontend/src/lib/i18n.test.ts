import { afterAll, describe, expect, it } from 'vitest';
import { useUi } from '@/store/ui';
import { translateWarning } from './i18n';

afterAll(() => useUi.setState({ language: 'de' }));

describe('translateWarning', () => {
  const cases: [string, string, string][] = [
    ['No fares collected for Innenkabine', 'Keine Tarife erfasst für Innenkabine', 'No fares collected for Innenkabine'],
    ['No booking code for Suite', 'Kein Buchungscode für Suite', 'No booking code for Suite'],
    ['PREMIUM ALL IN for Suite not offered or not readable (timeout)', 'PREMIUM ALL IN für Suite nicht angeboten oder nicht lesbar (timeout)', 'PREMIUM ALL IN for Suite not offered or not readable (timeout)'],
    ['Fares for Suite could not be read: timeout', 'Tarife für Suite konnten nicht gelesen werden: timeout', 'Fares for Suite could not be read: timeout'],
    ['Cabin Suite has no price (probably sold out)', 'Kabine Suite hat keinen Preis (vermutlich ausgebucht)', 'Cabin Suite has no price (probably sold out)'],
    ['Cabin Suite has no price with the flight (probably sold out)', 'Kabine Suite hat mit dem Flug keinen Preis (vermutlich ausgebucht)', 'Cabin Suite has no price with the flight (probably sold out)'],
    ['Tariff PLUS is currently not available', 'Tarif PLUS ist derzeit nicht verfügbar', 'Tariff PLUS is currently not available'],
    ['Tariff PLUS: no cabin prices found', 'Tarif PLUS: keine Kabinenpreise gefunden', 'Tariff PLUS: no cabin prices found'],
  ];

  it.each(cases)('translates "%s"', (stored, german, english) => {
    useUi.setState({ language: 'de' });
    expect(translateWarning(stored)).toBe(german);
    useUi.setState({ language: 'en' });
    expect(translateWarning(stored)).toBe(english);
  });

  it('shows an unknown warning as it was stored', () => {
    useUi.setState({ language: 'de' });
    expect(translateWarning('Something new happened')).toBe('Something new happened');
  });
});
