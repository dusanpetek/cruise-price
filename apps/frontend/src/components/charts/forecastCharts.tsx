import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BacktestPoint, Forecast, HorizonOutlook, ProjectionPoint, TimelinePoint } from '@cruise/analytics';
import { formatMoney } from '@cruise/shared';
import { formatDate, formatDateTime } from '@/lib/utils';
import { t } from '@/lib/i18n';

const AXIS = { stroke: 'var(--muted-foreground)', fontSize: 12 };
const TOOLTIP = {
  contentStyle: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 },
  labelStyle: { color: 'var(--muted-foreground)' },
};
const DAY = 86_400_000;
const label = (t: unknown) => formatDateTime(new Date(Number(t)).toISOString());

function TimeAxes({ money, width = 76 }: { money: (v: number) => string; width?: number }) {
  return (
    <>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => formatDate(t)} tickCount={4} {...AXIS} />
      <YAxis tickFormatter={money} width={width} domain={['auto', 'auto']} {...AXIS} />
    </>
  );
}

/** Price history followed by the 60-day trend forecast. */
export function HistoricalForecast({ history, forecast, currency }: { history: { t: number; price: number }[]; forecast: Forecast; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  const lastT = history.at(-1)?.t ?? 0;
  const data = [
    ...history.map((h) => ({ t: h.t, history: h.price } as { t: number; history?: number; forecast?: number })),
    ...forecast.curve.filter((_, i) => i % 3 === 0 || i === 60).map((p) => ({ t: lastT + p.days * DAY, forecast: p.price })),
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <TimeAxes money={money} />
        <Tooltip labelFormatter={label} formatter={(v, n) => [money(Number(v)), n === 'history' ? t('Actual') : t('Forecast')]} {...TOOLTIP} />
        <ReferenceLine x={lastT} stroke="var(--muted-foreground)" strokeDasharray="2 4" />
        <Line dataKey="history" stroke="var(--series-1)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="forecast" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** The 95% prediction interval around the forecast, widening with the horizon. */
export function ConfidenceBand({ forecast, startT, currency }: { forecast: Forecast; startT: number; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  const data = forecast.curve.map((p) => ({ t: startT + p.days * DAY, low: p.low, spread: p.high - p.low, price: p.price, high: p.high }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <TimeAxes money={money} />
        <Tooltip labelFormatter={label} formatter={(v, n) => [money(Number(v)), n === 'price' ? t('Forecast') : n === 'low' ? t('Lower bound') : t('Upper bound')]} {...TOOLTIP} />
        <Area dataKey="low" stackId="band" stroke="none" fill="none" tooltipType="none" legendType="none" isAnimationActive={false} />
        <Area dataKey="spread" stackId="band" stroke="none" fill="var(--series-2)" fillOpacity={0.2} tooltipType="none" legendType="none" isAnimationActive={false} />
        <Line dataKey="high" stroke="var(--series-2)" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
        <Line dataKey="low" stroke="var(--series-2)" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
        <Line dataKey="price" stroke="var(--series-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** What the forecast said (made `horizon` days earlier) against what the price then did. */
export function ForecastAccuracyChart({ points, currency }: { points: BacktestPoint[]; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  const data = points.map((p) => ({ t: Date.parse(p.targetAt), predicted: p.predicted, actual: p.actual }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <TimeAxes money={money} />
        <Tooltip labelFormatter={label} formatter={(v, n) => [money(Number(v)), n === 'actual' ? t('Actual price') : t('Forecast made 30 days earlier')]} {...TOOLTIP} />
        <Legend formatter={(v) => (v === 'actual' ? t('Actual') : t('Forecast'))} wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="actual" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="predicted" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export const ACTION_COLOR = {
  BUY_NOW: 'var(--good)',
  LIKELY_GOOD: 'var(--good)',
  WAIT: 'var(--warn)',
  WAIT_FOR_DROP: 'var(--warn)',
  MONITOR: 'var(--muted-foreground)',
  AVOID: 'var(--bad)',
} as const;

/** The price with a marker coloured by what the recommendation would have been at that point. */
export function RecommendationTimelineChart({ points, currency }: { points: TimelinePoint[]; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <TimeAxes money={money} />
        <Tooltip
          labelFormatter={label}
          formatter={(v) => [money(Number(v)), t('Price')]}
          content={({ active, payload }) => {
            const p = active ? (payload?.[0]?.payload as TimelinePoint | undefined) : undefined;
            return p ? (
              <div className="rounded-lg border border-border bg-card p-2 text-xs">
                <div className="text-muted-foreground">{label(p.t)}</div>
                <div>{money(p.price)}</div>
                <div style={{ color: ACTION_COLOR[p.action] }}>
                  {t(p.action)} · {Math.round(p.confidence * 100)}%
                </div>
              </div>
            ) : null;
          }}
        />
        <Line
          dataKey="price"
          stroke="var(--muted-foreground)"
          strokeWidth={1}
          isAnimationActive={false}
          dot={(props: { cx?: number; cy?: number; payload?: TimelinePoint; index?: number }) => (
            <circle key={props.index} cx={props.cx} cy={props.cy} r={5} fill={ACTION_COLOR[props.payload?.action ?? 'MONITOR']} stroke="var(--card)" strokeWidth={1} />
          )}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Savings (positive) or extra cost (negative) from waiting 7, 30 or 60 days. */
export function SavingsProjectionChart({ points, currency }: { points: ProjectionPoint[]; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis tickFormatter={money} width={76} {...AXIS} />
        <ReferenceLine y={0} stroke="var(--muted-foreground)" />
        <Tooltip
          formatter={(v, _n, item) => [t('{amount} (price {price})', { amount: money(Number(v)), price: money((item.payload as ProjectionPoint).price) }), Number(v) >= 0 ? t('Saved by waiting') : t('Extra cost of waiting')]}
          {...TOOLTIP}
        />
        <Bar dataKey="savings" isAnimationActive={false}>
          {points.map((p) => (
            <Cell key={p.label} fill={p.savings > 0 ? 'var(--good)' : p.savings < 0 ? 'var(--bad)' : 'var(--muted-foreground)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** The expected price range (95% interval) and the expected price at 7, 30 and 60 days. */
export function ExpectedRangeChart({ horizons, current, currency }: { horizons: HorizonOutlook[]; current: number; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  const data = horizons.map((h) => ({ label: t('In {n} days', { n: h.days }), base: h.low, range: h.high - h.low, price: h.price, low: h.low, high: h.high }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis tickFormatter={money} width={76} domain={['auto', 'auto']} {...AXIS} />
        <ReferenceLine y={current} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: t('Now'), fill: 'var(--muted-foreground)', fontSize: 12, position: 'insideTopRight' }} />
        <Tooltip
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
            if (!active || !p) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="p-2 text-xs">
                <div className="font-medium">{p.label}</div>
                <div>{t('Expected price')}: {money(p.price)}</div>
                <div>{t('Range')}: {money(p.low)} – {money(p.high)}</div>
              </div>
            );
          }}
        />
        <Bar dataKey="base" stackId="range" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="range" stackId="range" fill="var(--primary)" fillOpacity={0.35} isAnimationActive={false} />
        <Line dataKey="price" stroke="var(--primary)" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** How much to trust the forecast at 7, 30 and 60 days. */
export function ForecastConfidenceChart({ horizons }: { horizons: HorizonOutlook[] }) {
  const data = horizons.map((h) => ({ label: t('In {n} days', { n: h.days }), pct: Math.round(h.confidence * 100) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} width={48} {...AXIS} />
        <Tooltip formatter={(v) => [`${v}%`, t('Confidence')]} {...TOOLTIP} />
        <Bar dataKey="pct" fill="var(--primary)" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
