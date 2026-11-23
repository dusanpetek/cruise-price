import { useRef } from 'react';
import { Download } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BandPoint, CabinComparisonPoint, PricePoint } from '@cruise/analytics';
import { formatMoney } from '@cruise/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { exportCsv, exportPng, type Row } from '@/lib/exportChart';
import { formatDate, formatDateTime } from '@/lib/utils';
import { t } from '@/lib/i18n';

const AXIS = { stroke: 'var(--muted-foreground)', fontSize: 12 };
const TOOLTIP = {
  contentStyle: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 },
  labelStyle: { color: 'var(--muted-foreground)' },
};
const seriesColor = (i: number) => `var(--series-${(i % 9) + 1})`;

export function ChartCard({
  title,
  testId,
  children,
  empty,
  summary,
  exportRows,
  filename,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
  empty?: string;
  /** Read out by screen readers in place of the drawing. */
  summary?: string;
  /** When given, the card offers CSV and PNG downloads. */
  exportRows?: Row[];
  filename?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const name = filename ?? testId;
  const canExport = !empty && !!exportRows && exportRows.length > 0;
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {canExport && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" aria-label={t('Download {title} as CSV', { title })} onClick={() => exportCsv(exportRows!, name)}>
              <Download size={12} /> CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('Download {title} as PNG', { title })}
              onClick={() => {
                const svg = ref.current?.querySelector<SVGSVGElement>('svg.recharts-surface');
                if (svg) void exportPng(svg, name);
              }}
            >
              <Download size={12} /> PNG
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div ref={ref} className="h-64 w-full min-w-0" role="img" aria-label={summary ?? title}>
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TimeAxes({ money, width = 72 }: { money: (v: number) => string; width?: number }) {
  return (
    <>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => formatDate(t)} tickCount={4} {...AXIS} />
      <YAxis tickFormatter={money} width={width} domain={['auto', 'auto']} {...AXIS} />
    </>
  );
}

const tooltipLabel = (t: unknown) => formatDateTime(new Date(Number(t)).toISOString());

interface PriceChartProps {
  series: PricePoint[];
  currency: string;
}

/** Trip total over time (the default chart), with the lowest and highest trip total marked. */
export function PackageTimeline({ series, currency }: PriceChartProps) {
  const money = (v: number) => formatMoney(v, currency);
  const data = series.map((s) => ({ t: Date.parse(s.collectedAt), cruise: s.packagePrice, flight: s.flightSurcharge, total: s.packagePrice + s.flightSurcharge }));
  const totals = data.map((d) => d.total);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <TimeAxes money={money} />
        <Tooltip
          labelFormatter={tooltipLabel}
          formatter={(v, name) => [money(Number(v)), name === 'total' ? t('Total') : t('Cruise')]}
          content={({ active, payload }) => {
            const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
            return row ? (
              <div className="rounded-lg border border-border bg-card p-2 text-xs tabular-nums">
                <div className="text-muted-foreground">{formatDateTime(new Date(row.t).toISOString())}</div>
                <div className="text-sm font-semibold">{t('Total')} {money(row.total)}</div>
                <div>{t('Cruise {cruise} + Flight {flight}', { cruise: money(row.cruise), flight: money(row.flight) })}</div>
              </div>
            ) : null;
          }}
        />
        <ReferenceLine y={min} stroke="var(--good)" strokeDasharray="4 4" label={{ value: t('Low'), fill: 'var(--good)', fontSize: 11, position: 'insideBottomLeft' }} />
        <ReferenceLine y={max} stroke="var(--bad)" strokeDasharray="4 4" label={{ value: t('High'), fill: 'var(--bad)', fontSize: 11, position: 'insideTopLeft' }} />
        <Line type="monotone" dataKey="total" stroke="var(--series-1)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** One component of the trip price over time (cruise or flight); the tooltip always shows all three prices. */
export function ComponentTimeline({ series, currency, which }: PriceChartProps & { which: 'cruise' | 'flight' }) {
  const money = (v: number) => formatMoney(v, currency);
  const data = series.map((s) => ({ t: Date.parse(s.collectedAt), cruise: s.packagePrice, flight: s.flightSurcharge, total: s.packagePrice + s.flightSurcharge + (s.mandatoryFees ?? 0) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <TimeAxes money={money} />
        <Tooltip
          content={({ active, payload }) => {
            const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
            return row ? (
              <div className="rounded-lg border border-border bg-card p-2 text-xs tabular-nums">
                <div className="text-muted-foreground">{formatDateTime(new Date(row.t).toISOString())}</div>
                <div className="text-sm font-semibold">{t('Total')} {money(row.total)}</div>
                <div>{t('Cruise {cruise} + Flight {flight}', { cruise: money(row.cruise), flight: money(row.flight) })}</div>
              </div>
            ) : null;
          }}
        />
        <Line type={which === 'flight' ? 'stepAfter' : 'monotone'} dataKey={which} stroke={which === 'flight' ? 'var(--series-3)' : 'var(--series-4)'} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Package total of every cabin category over time. */
export function CabinComparison({ rows, categories, currency }: { rows: CabinComparisonPoint[]; categories: string[]; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <TimeAxes money={money} width={80} />
        <Tooltip labelFormatter={tooltipLabel} formatter={(v, name) => [t('{amount} total (incl. flight)', { amount: money(Number(v)) }), String(name)]} {...TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {categories.map((c, i) => (
          <Line key={c} type="monotone" dataKey={c} stroke={seriesColor(i)} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** The spread between the cheapest and the most expensive cabin at each collection. */
export function MinMaxBand({ band, currency }: { band: BandPoint[]; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  const data = band.map((b) => ({ ...b, spread: b.max - b.min }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <TimeAxes money={money} width={80} />
        <Tooltip labelFormatter={tooltipLabel} formatter={(v, name) => [money(Number(v)), name === 'min' ? t('Cheapest cabin, total (incl. flight)') : t('Most expensive cabin, total (incl. flight)')]} {...TOOLTIP} />
        <Area dataKey="min" stackId="band" stroke="none" fill="none" tooltipType="none" legendType="none" isAnimationActive={false} />
        <Area dataKey="spread" stackId="band" stroke="none" fill="var(--series-1)" fillOpacity={0.18} tooltipType="none" legendType="none" isAnimationActive={false} />
        <Line type="monotone" dataKey="min" stroke="var(--series-3)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="max" stroke="var(--series-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
