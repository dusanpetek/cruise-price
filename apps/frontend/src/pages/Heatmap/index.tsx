import { Link } from 'react-router-dom';
import type { HeatLevel, RankedRoute } from '@cruise/analytics';
import { CABIN_GROUPS, CABIN_GROUP_LABELS } from '@cruise/domain';
import { Card, CardContent } from '@/components/ui/card';
import { useIntelligence } from '@/hooks/queries';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const LEVELS: Record<HeatLevel, { label: string; symbol: string; style: string }> = {
  strong: { label: 'Strong deal', symbol: '▲', style: 'bg-good/20 text-good border-good/40' },
  neutral: { label: 'Neutral', symbol: '■', style: 'bg-warn/15 text-warn border-warn/40' },
  poor: { label: 'Poor deal', symbol: '▼', style: 'bg-bad/15 text-bad border-bad/40' },
};

function Cell({ route, group }: { route: RankedRoute; group: (typeof CABIN_GROUPS)[number] }) {
  const g = route.groups.find((x) => x.group === group);
  if (!g) return <td className="px-1 py-1 text-center text-muted-foreground" data-testid="heat-empty">–</td>;
  const level = LEVELS[g.heat.level];
  const detail = [t('Deal score {n}', { n: g.dealScore }), g.valueScore === null ? null : `${t('Fare value score')} ${g.valueScore}`, `${t('Recommendation')}: ${t(g.recommendation.action)}`].filter(Boolean).join(' · ');
  return (
    <td className="px-1 py-1">
      <Link
        to={`/routes/${route.routeId}`}
        data-testid="heat-cell"
        data-level={g.heat.level}
        title={detail}
        aria-label={`${route.routeName}, ${t(CABIN_GROUP_LABELS[group])}: ${t(level.label)}, ${detail}`}
        className={cn('flex flex-col items-center rounded-md border px-1 py-1.5 text-center text-xs font-semibold leading-tight hover:opacity-80', level.style)}
      >
        <span aria-hidden>{level.symbol} {g.heat.score}</span>
        <span className="font-normal">{t(level.label)}</span>
      </Link>
    </td>
  );
}

/** Deal heatmap: every route against the five cabin groups, coloured by the deal score of that group. */
export default function Heatmap() {
  const { data, isLoading, error } = useIntelligence();
  if (isLoading) return <p className="text-muted-foreground">{t('Analysing price history…')}</p>;
  if (error || !data) return <p role="alert" className="text-destructive">{t('Could not load the analysis: {error}', { error: error?.message ?? '' })}</p>;
  const routes = data.routes.filter((r) => r.groups.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('Deal heatmap')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('Every route and cabin group at a glance. The score combines the fare value, the forecast, the position in the price history and the recent trend, all on the trip total.')}
        </p>
      </div>
      <ul className="flex flex-wrap gap-3 text-xs" aria-label={t('Legend')} data-testid="heat-legend">
        {(Object.keys(LEVELS) as HeatLevel[]).map((l) => (
          <li key={l} className={cn('rounded-md border px-2 py-1 font-medium', LEVELS[l].style)}>
            {LEVELS[l].symbol} {t(LEVELS[l].label)} <span className="font-normal">({l === 'strong' ? '≥ 65' : l === 'neutral' ? '45-64' : '< 45'})</span>
          </li>
        ))}
      </ul>
      <Card>
        <CardContent className="pt-4">
          {routes.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{t('No price data yet.')}</p>
          ) : (
            <table className="w-full table-fixed text-sm" data-testid="heatmap">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="w-[28%] py-1 pr-2 text-left font-medium">{t('Route')}</th>
                  {CABIN_GROUPS.map((g) => <th key={g} className="px-1 py-1 text-center font-medium">{t(CABIN_GROUP_LABELS[g])}</th>)}
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.routeId} className="border-t border-border" data-testid="heat-row">
                    <th scope="row" className="break-words py-1.5 pr-2 text-left font-medium">
                      <Link to={`/routes/${r.routeId}`} className="text-primary hover:underline">{r.routeName}</Link>
                    </th>
                    {CABIN_GROUPS.map((g) => <Cell key={g} route={r} group={g} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
