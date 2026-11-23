import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '@cruise/shared';
import { formatDate, formatDateTime } from '@/lib/utils';
import { t } from '@/lib/i18n';

const AXIS = { stroke: 'var(--muted-foreground)', fontSize: 12 };
const color = (i: number) => `var(--series-${(i % 9) + 1})`;

/** One row per collection. For every series name: the total, and `${name}|cruise` and `${name}|flight` it is made of. */
export type FareRow = { t: number } & Record<string, number>;

interface TipProps {
  active?: boolean;
  label?: number | string;
  payload?: { dataKey?: string | number; name?: string; color?: string; payload?: FareRow }[];
}

/** Tooltip that never shows a price alone: total, cruise and flight for every line. */
function TripTooltip({ active, label, payload, currency }: TipProps & { currency: string }) {
  if (!active || !payload?.length) return null;
  const money = (v: number) => formatMoney(v, currency);
  return (
    <div className="rounded-lg border border-border bg-card p-2 text-xs shadow-sm">
      <div className="mb-1 text-muted-foreground">{formatDateTime(new Date(Number(label)).toISOString())}</div>
      {payload.map((p) => {
        const name = String(p.dataKey);
        const row = p.payload!;
        return (
          <div key={name} className="flex flex-col py-0.5">
            <span style={{ color: p.color }} className="font-medium">{name}</span>
            <span className="tabular-nums">
              <b>{t('Total')} {money(row[name]!)}</b> · {t('Cruise {cruise} + Flight {flight}', { cruise: money(row[`${name}|cruise`]!), flight: money(row[`${name}|flight`]!) })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Total trip price over time, one line per series (fare, or cabin + fare). */
export function SeriesChart({ rows, names, currency }: { rows: FareRow[]; names: string[]; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => formatDate(t)} tickCount={4} {...AXIS} />
        <YAxis tickFormatter={money} width={80} domain={['auto', 'auto']} {...AXIS} />
        <Tooltip content={(props) => <TripTooltip {...(props as unknown as TipProps)} currency={currency} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {names.map((n, i) => (
          <Line key={n} type="monotone" dataKey={n} stroke={color(i)} strokeWidth={2} strokeDasharray={i > 3 ? '5 3' : undefined} dot={false} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
