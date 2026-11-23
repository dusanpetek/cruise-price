import type { RouteIntelligence } from '@cruise/analytics';
import { formatMoney } from '@cruise/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/lib/i18n';

/** Booking timing: the recommended booking window and the last-minute intelligence (price around 180 ... 7 days before departure). */
export function TimingCard({ intel }: { intel: RouteIntelligence }) {
  const { lastMinute: lm, recommendedBookingWindow: w } = intel;
  const money = (v: number) => formatMoney(v, intel.currency);
  const position = w ? (w.insideWindow ? t('Today is inside the window: now is a good time to book.') : w.currentDaysBefore > w.to ? t('The window has not opened yet: it opens {days} days from now.', { days: w.currentDaysBefore - w.to }) : t('The window has passed; the best prices were further from the departure.')) : null;
  return (
    <Card data-testid="timing-card">
      <CardHeader>
        <CardTitle>{t('Booking timing')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {w ? (
          <div data-testid="booking-window">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{t('Recommended booking window')}</div>
            <div className="text-lg font-semibold tabular-nums">{t('{from}-{to} days before departure', { from: w.from, to: w.to })}</div>
            <p className="text-muted-foreground">
              {position} {t('Confidence {pct}%', { pct: Math.round(w.confidence * 100) })}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground" data-testid="booking-window-none">{lm.note}</p>
        )}

        {lm.available && (
          <>
            <p data-testid="lowest-window">{lm.note}</p>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t('Price around … days before departure')}</div>
              <ul className="grid grid-cols-4 gap-2 sm:grid-cols-7" data-testid="timing-marks">
                {lm.marks.map((m) => (
                  <li key={m.daysBefore} className="rounded-md border border-border px-2 py-1 text-center">
                    <div className="text-xs text-muted-foreground">{t('{n} days', { n: m.daysBefore })}</div>
                    <div className="font-medium tabular-nums">{m.price === null ? '–' : money(m.price)}</div>
                  </li>
                ))}
              </ul>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4" data-testid="timing-metrics">
              <div>
                <dt className="text-xs text-muted-foreground">{t('Average price drop')}</dt>
                <dd className="font-medium tabular-nums">{lm.avgDropPct === null ? '–' : `−${lm.avgDropPct.toFixed(1)}%`}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('Average price rise')}</dt>
                <dd className="font-medium tabular-nums">{lm.avgRisePct === null ? '–' : `+${lm.avgRisePct.toFixed(1)}%`}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('Best timing window')}</dt>
                <dd className="font-medium tabular-nums">{lm.bestWindow ? t('{from}-{to} days', { from: lm.bestWindow.from, to: lm.bestWindow.to }) : '–'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('Price stability')}</dt>
                <dd className="font-medium tabular-nums">{lm.stabilityScore}/100</dd>
              </div>
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}
