import { describe, expect, it, vi } from 'vitest';
import { mediaQueryMatches } from './useMediaQuery';

describe('mediaQueryMatches', () => {
  it('returns the matches value from the given matchMedia implementation', () => {
    const matches = vi.fn().mockReturnValue({ matches: true });
    expect(mediaQueryMatches('(min-width: 1024px)', matches)).toBe(true);
    expect(matches).toHaveBeenCalledWith('(min-width: 1024px)');
  });
  it('returns false when the query does not match', () => {
    expect(mediaQueryMatches('(min-width: 1024px)', () => ({ matches: false }))).toBe(false);
  });
});
