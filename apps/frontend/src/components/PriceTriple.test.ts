import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { useUi } from '@/store/ui';
import { PriceCells, PriceHeaders, PriceTriple } from './PriceTriple';

beforeEach(() => useUi.setState({ language: 'en' }));
afterAll(() => useUi.setState({ language: 'de' }));

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const norm = (s: string) => s.replace(/ /g, ' ');

describe('PriceTriple: cruise, flight and total are always shown together', () => {
  let markup = '';
  beforeEach(() => {
    markup = norm(html(createElement(PriceTriple, { cruise: 2999, flight: 399 })));
  });

  it('shows all three labels and the three numbers', () => {
    expect(markup).toContain('Cruise 2.999 €');
    expect(markup).toContain('Flight 399 €');
    expect(markup).toContain('3.398 €');
    expect(markup).toContain('Total');
  });

  it('makes the total the largest number', () => {
    const total = markup.match(/<div class="([^"]*)" data-testid="price-total">/)![1]!;
    const parts = markup.match(/<div class="([^"]*)" data-testid="price-parts">/)![1]!;
    expect(total).toMatch(/text-(base|xl|2xl)/);
    expect(total).toContain('font-semibold');
    expect(parts).toContain('text-xs');
    expect(parts).not.toContain('font-semibold');
  });

  it('computes the total itself, so it cannot disagree with its parts', () => {
    expect(norm(html(createElement(PriceTriple, { cruise: 0.1, flight: 0.2 })))).toContain('0 €'); // 0.30 rounds to 0
    expect(norm(html(createElement(PriceTriple, { cruise: 1000, flight: 0 })))).toContain('Flight 0 €'); // no flight is still shown
  });

  it('supports sizes and other currencies', () => {
    expect(html(createElement(PriceTriple, { cruise: 1, flight: 1, size: 'lg' }))).toContain('text-2xl');
    expect(html(createElement(PriceTriple, { cruise: 1, flight: 1, size: 'sm' }))).toContain('text-base');
    expect(norm(html(createElement(PriceTriple, { cruise: 1000, flight: 100, currency: 'USD' })))).toContain('$');
  });
});

describe('price columns for tables', () => {
  it('always come as cruise, flight, total', () => {
    expect(html(createElement(PriceHeaders))).toMatch(/Cruise.*Flight.*Total/);
    const row = norm(html(createElement('table', null, createElement('tbody', null, createElement('tr', null, createElement(PriceCells, { cruise: 2058, flight: 1180 }))))));
    expect(row).toMatch(/2\.058 €.*1\.180 €.*3\.238 €/);
    expect(row).toContain('font-semibold'); // the total
  });
});

describe('in German (the default language)', () => {
  it('labels the three prices Kreuzfahrt, Flug and Gesamt', () => {
    useUi.setState({ language: 'de' });
    const markup = norm(html(createElement(PriceTriple, { cruise: 2999, flight: 399 })));
    expect(markup).toContain('Kreuzfahrt');
    expect(markup).toContain('Flug');
    expect(markup).toContain('Gesamt');
    expect(html(createElement(PriceHeaders))).toMatch(/Kreuzfahrt.*Flug.*Gesamt/);
  });
});
