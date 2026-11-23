import type { DateRange } from '@cruise/analytics';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useUi } from '@/store/ui';

const RANGES: { id: DateRange; label: string }[] = [
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
];

/**
 * What the route page shows: one fare (or the cheapest), one cabin (or the cheapest), and for the charts a time range.
 * Switching the fare switches the statistics, forecast, recommendation and charts together.
 */
export function ChartFilters({ cabins, fares }: { cabins: string[]; fares: { code: string; name: string }[] }) {
  const { chartRange, setChartRange, chartCabin, setChartCabin, chartFare, setChartFare } = useUi();
  return (
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label={t('View')} data-testid="view-filters">
      {fares.length > 0 ? (
        <div className="flex items-center gap-2">
          <Label htmlFor="view-fare">{t('Fare')}</Label>
          <Select id="view-fare" className="w-56" value={chartFare ?? ''} onChange={(e) => setChartFare(e.target.value || null)}>
            <option value="">{t('All fares (cheapest)')}</option>
            {fares.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground" title={t('Collected before fares were tracked')}>
          {t('Fare: unknown')}
        </span>
      )}
      <div className="flex items-center gap-2">
        <Label htmlFor="view-cabin">{t('Cabin')}</Label>
        <Select id="view-cabin" aria-label={t('Cabin category')} className="w-56" value={chartCabin ?? ''} onChange={(e) => setChartCabin(e.target.value || null)}>
          <option value="">{t('Cheapest cabin (headline)')}</option>
          {cabins.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-1" role="group" aria-label={t('Time range of the charts')}>
        {RANGES.map((r) => (
          <Button
            key={r.id}
            size="sm"
            variant="outline"
            aria-pressed={chartRange === r.id}
            className={cn(chartRange === r.id && 'border-primary text-primary')}
            onClick={() => setChartRange(r.id)}
          >
            {t(r.label)}
          </Button>
        ))}
      </div>
    </div>
  );
}
