import { describe, expect, it } from 'vitest';
import { PROVIDER_IDS } from '@cruise/domain';
import { PROVIDER_LOGO_SRC, PROVIDER_LOGO_SVG } from './providerLogos';

describe('provider logos', () => {
  it('has a logo for every provider, embedded as a base64 SVG data URI that decodes to the SVG source', () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_LOGO_SRC[id]).toMatch(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/);
      expect(atob(PROVIDER_LOGO_SRC[id].split(',')[1]!)).toBe(PROVIDER_LOGO_SVG[id]);
    }
  });

  it('is plain, safe SVG: only paths, no script, no external references, no text', () => {
    for (const id of PROVIDER_IDS) {
      const svg = PROVIDER_LOGO_SVG[id];
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
      for (const forbidden of ['<script', '<style', '<image', '<foreignObject', 'href', 'onload', 'javascript:', '<text', 'http://www.w3.org/1999/xlink']) expect(svg).not.toContain(forbidden);
      expect([...svg.matchAll(/<(\w+)/g)].map((m) => m[1]).every((tag) => tag === 'svg' || tag === 'path')).toBe(true);
    }
  });

  it('shows only the mark: AIDA without the coloured lettering, TUI Cruises without "TUI" and "Cruises"', () => {
    for (const letterColour of ['#0094CA', '#CC3300', '#FFCC00', '#009F48']) expect(PROVIDER_LOGO_SVG.aida).not.toContain(letterColour);
    expect(PROVIDER_LOGO_SVG.aida).toContain('#E53212');
    expect(PROVIDER_LOGO_SVG['mein-schiff']).not.toContain('#002C58'); // the navy "Cruises"
    expect(PROVIDER_LOGO_SVG['mein-schiff']).toContain('#D41318');
    expect(PROVIDER_LOGO_SVG['mein-schiff'].match(/M/g)!.length).toBe(2); // the smile and the dot, not the letters of "TUI"
    expect(PROVIDER_LOGO_SVG.aida.length).toBeLessThan(5000);
  });
});
