import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_LOCALE, type Locale } from '@cruise/i18n';
import type { DateRange } from '@cruise/analytics';
import type { ProviderId } from '@cruise/domain';

export type Theme = 'light' | 'dark' | 'system';

interface UiState {
  /** UI language; German unless the user chose otherwise. */
  language: Locale;
  setLanguage: (language: Locale) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Chart filters on the route detail page. `chartCabin` null = headline (cheapest cabin). */
  chartRange: DateRange;
  chartCabin: string | null;
  /** The fare shown on the route page (null = the cheapest fare). */
  chartFare: string | null;
  setChartFare: (fare: string | null) => void;
  setChartRange: (range: DateRange) => void;
  setChartCabin: (cabin: string | null) => void;
  /** Provider filter on the collection dashboard. */
  provider: ProviderId | null;
  setProvider: (provider: ProviderId | null) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      language: DEFAULT_LOCALE,
      setLanguage: (language) => set({ language }),
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      chartRange: 'all',
      chartCabin: null,
      chartFare: null,
      setChartFare: (chartFare) => set({ chartFare }),
      setChartRange: (chartRange) => set({ chartRange }),
      setChartCabin: (chartCabin) => set({ chartCabin }),
      provider: null,
      setProvider: (provider) => set({ provider }),
    }),
    { name: 'cruise-ui', partialize: (s) => ({ language: s.language, theme: s.theme, chartRange: s.chartRange, provider: s.provider }) },
  ),
);

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
