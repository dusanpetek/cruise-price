import { useEffect, useState } from 'react';

/** Pure: whether `query` currently matches, using the given matchMedia implementation (defaults to `window.matchMedia`). */
export function mediaQueryMatches(query: string, matchMediaImpl: (query: string) => { matches: boolean } = (q) => window.matchMedia(q)): boolean {
  return matchMediaImpl(query).matches;
}

/** Re-renders when `query`'s match state changes. `false` when there is no `window` (mirrors the guard in lib/i18n.ts). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : mediaQueryMatches(query)));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = () => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
