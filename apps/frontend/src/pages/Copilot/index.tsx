import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { COPILOT_EXAMPLES, type CopilotAnswer } from '@cruise/analytics';
import { formatMoney } from '@cruise/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { useAskCopilot } from '@/hooks/queries';
import { t } from '@/lib/i18n';

interface Turn {
  id: number;
  question: string;
  answer?: CopilotAnswer;
  error?: string;
}

function Answer({ a }: { a: CopilotAnswer }) {
  const confidence = Math.round(a.confidence * 100);
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="copilot-answer" data-intent={a.intent}>
      <section aria-label={t('Recommendation')}>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t('Recommendation')}</h3>
        <p className="text-base font-semibold" data-testid="copilot-recommendation">{a.recommendation}</p>
      </section>
      {a.reasoning.length > 0 && (
        <section aria-label={t('Reasoning')}>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t('Reasoning')}</h3>
          <ul className="list-disc pl-5" data-testid="copilot-reasoning">
            {a.reasoning.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </section>
      )}
      {a.understood && (
        <section aria-label={t('Confidence')}>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t('Confidence')}</h3>
          <div className="flex items-center gap-2">
            <div className="h-2 w-40 overflow-hidden rounded-full bg-muted" role="presentation"><div className="h-full bg-primary" style={{ width: `${confidence}%` }} /></div>
            <span className="tabular-nums" data-testid="copilot-confidence">{confidence}%</span>
          </div>
        </section>
      )}
      {a.metrics.length > 0 && (
        <section aria-label={t('Supporting metrics')}>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t('Supporting metrics')}</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4" data-testid="copilot-metrics">
            {a.metrics.map((m) => (
              <div key={m.label}>
                <dt className="text-xs text-muted-foreground">{m.label}</dt>
                <dd className="font-medium tabular-nums">{m.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {a.deals.length > 0 && (
        <section aria-label={t('Offers')}>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t('Offers')}</h3>
          <ul className="flex flex-col divide-y divide-border" data-testid="copilot-deals">
            {a.deals.map((d, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <span className="min-w-0">
                  <Link to={`/routes/${d.routeId}/fares`} className="font-medium text-primary hover:underline">{d.routeName}</Link>
                  <span className="text-muted-foreground"> · {d.cabinCategory} · {d.fareName}</span>
                </span>
                <span className="tabular-nums">
                  <b>{formatMoney(d.total, 'EUR')}</b>
                  <span className="text-xs text-muted-foreground"> ({t('Cruise {cruise} + Flight {flight}', { cruise: formatMoney(d.cruise, 'EUR'), flight: formatMoney(d.flight, 'EUR') })})</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.suggestions.length > 0 && (
        <ul className="list-disc pl-5 text-muted-foreground">
          {a.suggestions.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Cruise Copilot: ask questions about the tracked cruises. Answers come from rules over the analysis, not from a language model. */
export default function CopilotPage() {
  const ask = useAskCopilot();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const nextId = useRef(1);

  const submit = (text: string) => {
    const q = text.trim();
    if (!q || ask.isPending) return;
    const id = nextId.current++;
    setTurns((all) => [{ id, question: q }, ...all]);
    setQuestion('');
    ask.mutate(q, {
      onSuccess: (answer) => setTurns((all) => all.map((x) => (x.id === id ? { ...x, answer } : x))),
      onError: (e) => setTurns((all) => all.map((x) => (x.id === id ? { ...x, error: e.message } : x))),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t('Cruise Copilot')}</h1>
        <p className="text-sm text-muted-foreground">{t('Ask about your tracked cruises. The answers come from the analysis of your own price history (rules and statistics, no language model), and every answer shows its reasoning.')}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(question); }}>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Label htmlFor="copilot-question">{t('Your question')}</Label>
              <Input id="copilot-question" value={question} maxLength={500} autoComplete="off" placeholder={t(COPILOT_EXAMPLES[0])} onChange={(e) => setQuestion(e.target.value)} />
            </div>
            <Button type="submit" disabled={ask.isPending || question.trim() === ''}>{ask.isPending ? t('Thinking…') : t('Ask')}</Button>
          </form>
          <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label={t('Example questions')}>
            <span className="text-muted-foreground">{t('Try')}:</span>
            {COPILOT_EXAMPLES.map((e) => (
              <Button key={e} size="sm" variant="outline" className="whitespace-normal text-left" data-testid="copilot-example" onClick={() => submit(t(e))} disabled={ask.isPending}>{t(e)}</Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {turns.length === 0 && <p className="text-sm text-muted-foreground">{t('No questions yet. Pick an example or type your own.')}</p>}
      <div className="flex flex-col gap-4" aria-live="polite">
        {turns.map((turn) => (
          <Card key={turn.id} data-testid="copilot-turn">
            <CardHeader>
              <CardTitle className="text-foreground">{turn.question}</CardTitle>
            </CardHeader>
            <CardContent>
              {turn.error ? <p role="alert" className="text-sm text-destructive">{turn.error}</p> : turn.answer ? <Answer a={turn.answer} /> : <p className="text-sm text-muted-foreground">{t('Thinking…')}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
