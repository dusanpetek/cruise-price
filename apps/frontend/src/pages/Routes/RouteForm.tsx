import { useState } from 'react';
import { Search } from 'lucide-react';
import {
  PROVIDER_IDS,
  PROVIDER_LABELS,
  RouteInputSchema,
  detectProviderId,
  type Route,
  type RouteInput,
} from '@cruise/domain';
import { RouteSearchDialog, routeNameOf } from '@/components/RouteSearchDialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { t } from '@/lib/i18n';

interface Props {
  initial?: Route;
  busy?: boolean;
  error?: string | null;
  onSubmit: (input: RouteInput) => void;
  onCancel: () => void;
}

export function RouteForm({ initial, busy, error, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [provider, setProvider] = useState<RouteInput['provider']>(initial?.provider ?? 'aida');
  const [issue, setIssue] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  // The provider follows the URL automatically; the select only matters while the URL is unrecognised.
  const changeUrl = (value: string) => {
    setUrl(value);
    const detected = detectProviderId(value);
    if (detected) setProvider(detected);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = RouteInputSchema.safeParse({ name, provider, url });
    if (!parsed.success) return setIssue(parsed.error.issues[0]?.message ?? t('Invalid input'));
    setIssue(null);
    onSubmit(parsed.data);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3" aria-label={t('Route form')}>
      {!initial && (
        <>
          <Button type="button" size="sm" variant="outline" onClick={() => setSearching(true)} data-testid="open-route-search">
            <Search size={14} /> {t('Search the cruise line')}
          </Button>
          <RouteSearchDialog
            open={searching}
            initialProvider={provider}
            onClose={() => setSearching(false)}
            onPick={(r) => {
              setName(routeNameOf(r));
              setUrl(r.url);
              setProvider(r.provider);
              setIssue(null);
              setSearching(false);
            }}
          />
        </>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="route-name">{t('Name')}</Label>
        <Input id="route-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Norwegian Fjords')} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="route-url">{t('URL')}</Label>
        <Input id="route-url" value={url} onChange={(e) => changeUrl(e.target.value)} placeholder={t('https://www.aida.de/…')} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="route-provider">{t('Provider')}</Label>
        <Select id="route-provider" value={provider} onChange={(e) => setProvider(e.target.value as RouteInput['provider'])}>
          {PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_LABELS[id]}
            </option>
          ))}
        </Select>
      </div>
      {(issue ?? error) && (
        <p role="alert" className="text-sm text-destructive">
          {issue ?? error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {initial ? t('Save') : t('Add route')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  );
}
