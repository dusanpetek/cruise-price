import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Trash2 } from 'lucide-react';
import { alertMessage } from '@cruise/analytics';
import {
  ALERT_TYPES,
  ALERT_TYPE_LABELS,
  CABIN_GROUPS,
  CABIN_GROUP_LABELS,
  DROP_THRESHOLDS,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  type AlertRuleInput,
  type AlertType,
  type CabinGroup,
} from '@cruise/domain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { useAcknowledgeAlert, useAlertRules, useAlerts, useChannels, useIntelligence, useRoutes, useRuleMutations, useTestChannel } from '@/hooks/queries';
import { cn, formatDateTime } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { useUi } from '@/store/ui';

const RANGES = { '1': 'Last 24 hours', '7': 'Last 7 days', '30': 'Last 30 days', '': 'All time' } as const;

export default function AlertCenter() {
  const language = useUi((u) => u.language);
  const [provider, setProvider] = useState('');
  const [type, setType] = useState('');
  const [range, setRange] = useState<keyof typeof RANGES>('');
  const since = useMemo(() => (range ? new Date(Date.now() - Number(range) * 86_400_000).toISOString() : undefined), [range]);
  const { data: alerts = [], isLoading } = useAlerts({ provider, type, ...(since ? { since } : {}) });
  const { data: routes = [] } = useRoutes();
  const ack = useAcknowledgeAlert();
  const routeName = (id: string) => routes.find((r) => r.id === id);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('Alert center')}</h1>
        <p className="text-sm text-muted-foreground">{t('Alerts are evaluated after every collection and sent to the channels you enable below.')}</p>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('Alerts')}</CardTitle>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('Alert filters')}>
            <Select aria-label={t('Provider')} className="w-40" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">{t('All providers')}</option>
              {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>)}
            </Select>
            <Select aria-label={t('Alert type')} className="w-48" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{t('All alert types')}</option>
              {ALERT_TYPES.map((ty) => <option key={ty} value={ty}>{t(ALERT_TYPE_LABELS[ty])}</option>)}
            </Select>
            <Select aria-label={t('Date range')} className="w-40" value={range} onChange={(e) => setRange(e.target.value as keyof typeof RANGES)}>
              {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading && <p className="text-sm text-muted-foreground">{t('Loading alerts…')}</p>}
          {!isLoading && alerts.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t('No alerts match. They appear when a collection finds a new low, a drop or a reached target price.')}</p>}
          {alerts.length > 0 && (
            <table className="w-full text-sm" data-testid="alert-table">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">{t('Date')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Route')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Category')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Type')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Message')}</th>
                  <th className="py-1 pr-3 font-medium">{t('Status')}</th>
                  <th className="py-1 font-medium"><span className="sr-only">{t('Actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} className="border-t border-border align-top" data-testid="alert-row">
                    <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{formatDateTime(a.createdAt)}</td>
                    <td className="py-1.5 pr-3">{routeName(a.routeId) ? <Link to={`/routes/${a.routeId}`} className="text-primary hover:underline">{a.routeName}</Link> : a.routeName}</td>
                    <td className="py-1.5 pr-3">{localCategory(a.category)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{t(ALERT_TYPE_LABELS[a.type])}</td>
                    <td className="py-1.5 pr-3">{alertMessage(language, a)}</td>
                    <td className="py-1.5 pr-3">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', a.status === 'new' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>{a.status}</span>
                      {a.deliveries.map((d) => (
                        <div key={d.channel} className={cn('mt-0.5 text-xs', d.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')} title={d.error ?? undefined}>
                          {d.channel}: {d.status}
                        </div>
                      ))}
                    </td>
                    <td className="py-1.5">
                      {a.status === 'new' && (
                        <Button size="sm" variant="ghost" aria-label={t('Acknowledge alert for {route}', { route: a.routeName })} onClick={() => ack.mutate(a.id)}>
                          <Check size={14} /> {t('Acknowledge')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <RulesPanel routes={routes} />
        <ChannelsPanel />
      </div>
    </div>
  );
}

/** Alert categories are stored as "Balcony · FARE"; only the cabin part is translated. */
function localCategory(category: string) {
  const [cabin, ...rest] = category.split(' · ');
  return [t(cabin ?? category), ...rest].join(' · ');
}

function ruleText(r: { type: AlertType; cabin: CabinGroup | null; fare: string | null; percent: number | null; targetPrice: number | null }, fareNames: Map<string, string>) {
  const what = r.type === 'PERCENT_DROP' ? t('trip total drops by {pct}%', { pct: r.percent ?? 0 }) : r.type === 'TARGET_PRICE' ? t('trip total reaches {price} €', { price: r.targetPrice ?? 0 }) : t('new historical low');
  const fare = r.fare ? ` · ${fareNames.get(r.fare) ?? r.fare}` : '';
  return `${r.cabin ? t(CABIN_GROUP_LABELS[r.cabin]) : t('Cheapest cabin')}${fare}: ${what}`;
}

function RulesPanel({ routes }: { routes: { id: string; name: string }[] }) {
  const { data: rules = [] } = useAlertRules();
  const { create, remove } = useRuleMutations();
  const { data: portfolio } = useIntelligence();
  const fares = useMemo(() => [...new Map((portfolio?.options ?? []).map((o) => [o.fare.fareCode, o.fareName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [portfolio]);
  const fareNames = useMemo(() => new Map(fares), [fares]);
  const [fare, setFare] = useState('');
  const [type, setType] = useState<AlertType>('TARGET_PRICE');
  const [cabin, setCabin] = useState<CabinGroup | ''>('');
  const [percent, setPercent] = useState<number>(10);
  const [target, setTarget] = useState('');
  const [routeId, setRouteId] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: AlertRuleInput = {
      type,
      cabin: cabin || null,
      fare: fare || null,
      routeId: routeId || null,
      percent: type === 'PERCENT_DROP' ? percent : null,
      targetPrice: type === 'TARGET_PRICE' ? Number(target) : null,
    };
    create.mutate(input, { onSuccess: () => setTarget('') });
  };

  return (
    <Card data-testid="rules-panel">
      <CardHeader>
        <CardTitle>{t('Alert rules')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y divide-border text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-1.5" data-testid="rule-row">
              <span>
                {ruleText(r, fareNames)} <span className="text-muted-foreground">· {r.routeId ? routes.find((x) => x.id === r.routeId)?.name ?? 'one route' : 'all routes'}</span>
              </span>
              <Button size="icon" variant="destructive" aria-label={t('Delete rule: {rule}', { rule: ruleText(r, fareNames) })} onClick={() => remove.mutate(r.id)}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
          {rules.length === 0 && <li className="py-1.5 text-muted-foreground">{t('No rules: nothing will be alerted.')}</li>}
        </ul>

        <form onSubmit={submit} className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-2" aria-label={t('Add alert rule')}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-type">{t('Alert type')}</Label>
            <Select id="rule-type" value={type} onChange={(e) => setType(e.target.value as AlertType)}>
              {ALERT_TYPES.map((ty) => <option key={ty} value={ty}>{t(ALERT_TYPE_LABELS[ty])}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-cabin">{t('Cabin category')}</Label>
            <Select id="rule-cabin" value={cabin} onChange={(e) => setCabin(e.target.value as CabinGroup | '')}>
              <option value="">{t('Cheapest cabin')}</option>
              {CABIN_GROUPS.map((g) => <option key={g} value={g}>{t(CABIN_GROUP_LABELS[g])}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-fare">{t('Fare')}</Label>
            <Select id="rule-fare" value={fare} onChange={(e) => setFare(e.target.value)}>
              <option value="">{t('Any fare')}</option>
              {fares.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </Select>
          </div>
          {type === 'PERCENT_DROP' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-percent">{t('Drop threshold')}</Label>
              <Select id="rule-percent" value={percent} onChange={(e) => setPercent(Number(e.target.value))}>
                {DROP_THRESHOLDS.map((t) => <option key={t} value={t}>{t}%</option>)}
              </Select>
            </div>
          )}
          {type === 'TARGET_PRICE' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-target">{t('Target trip total (€, cruise + flight)')}</Label>
              <Input id="rule-target" type="number" min="1" step="any" value={target} onChange={(e) => setTarget(e.target.value)} required aria-describedby="rule-target-hint" />
              <span id="rule-target-hint" className="text-xs text-muted-foreground">{t('Fires once when the price falls to or below it (not on every collection).')}</span>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-route">{t('Route')}</Label>
            <Select id="rule-route" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">{t('All routes')}</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="submit" size="sm" disabled={create.isPending}>{t('Add rule')}</Button>
          </div>
          {create.error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{create.error.message}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function ChannelsPanel() {
  const { data: channels = [] } = useChannels();
  const test = useTestChannel();
  const [result, setResult] = useState<string | null>(null);

  return (
    <Card data-testid="channels-panel">
      <CardHeader>
        <CardTitle>{t('Notification channels')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          {t('Channels stay off until configured in {file} or environment variables (see the README). Credentials are never shown here.', { file: 'data/notifications.json' })}
        </p>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {channels.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-1.5" data-testid="channel-row">
              <span>
                {c.label}{' '}
                <span className={cn('text-xs', c.enabled ? 'text-good' : 'text-muted-foreground')}>{c.enabled ? 'enabled' : c.configured ? 'switched off' : 'not configured'}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!c.enabled || test.isPending}
                onClick={() => {
                  if (!window.confirm(t('Send a test notification through {channel}?', { channel: c.label }))) return;
                  setResult(null);
                  test.mutate(c.id, { onSuccess: () => setResult(t('{channel}: test sent', { channel: c.label })), onError: (e) => setResult(`${c.label}: ${e.message}`) });
                }}
              >
                {t('Send test')}
              </Button>
            </li>
          ))}
        </ul>
        {result && <p role="status" className="text-sm">{result}</p>}
      </CardContent>
    </Card>
  );
}
