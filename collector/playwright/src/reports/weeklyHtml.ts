import type { ReportKind, WeeklyDeal, WeeklyReport, WeeklyRouteRow } from '@cruise/analytics';
import { createT, type Locale, type TFunction } from '@cruise/i18n';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const eur = (n: number | null) => (n === null ? '–' : `${Math.round(n).toLocaleString('de-DE')} €`);
const pct = (n: number | null) => (n === null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);

const routeTable = (t: TFunction, rows: WeeklyRouteRow[], empty: string, period: string) =>
  rows.length === 0
    ? `<p class="muted">${esc(empty)}</p>`
    : `<table><thead><tr><th>${esc(t('Route'))}</th><th>${esc(t('Cruise'))}</th><th>${esc(t('Flight'))}</th><th>${esc(t('Trip total'))}</th><th>${esc(t('Lowest'))}</th><th>${esc(period)}</th><th>${esc(t('Advice'))}</th></tr></thead><tbody>${rows
        .map((r) => `<tr><td>${esc(r.route)}</td><td>${eur(r.currentCruise)}</td><td>${eur(r.currentFlight)}</td><td><b>${eur(r.current)}</b></td><td>${eur(r.historicalLow)}</td><td>${pct(r.weekChangePct)}</td><td><b>${esc(t(r.recommendation))}</b> ${Math.round(r.confidence * 100)}%</td></tr>`)
        .join('')}</tbody></table>`;

const dealRow = (t: TFunction, label: string, d: WeeklyDeal | null, none: string) =>
  d
    ? `<tr><td><b>${esc(label)}</b></td><td>${esc(d.route)}</td><td>${esc(d.cabin)} · ${esc(d.fare)}</td><td>${eur(d.cruisePrice)}</td><td>${eur(d.flightPrice)}</td><td><b>${eur(d.totalPrice)}</b></td><td>${d.weekChangePct === null ? '–' : pct(d.weekChangePct)}</td></tr>`
    : `<tr><td><b>${esc(label)}</b></td><td colspan="6" class="muted">${esc(none)}</td></tr>`;

/** The wording that depends on the period of the report. */
function wording(t: TFunction, kind: ReportKind) {
  return kind === 'daily'
    ? { title: t('Daily cruise price report'), period: t('Day'), none: t('none today'), drops: t('Biggest price drops today'), noDrops: t('No route got cheaper today.') }
    : kind === 'monthly'
      ? { title: t('Monthly cruise price report'), period: t('Month'), none: t('none this month'), drops: t('Biggest price drops this month'), noDrops: t('No route got cheaper this month.') }
      : { title: t('Weekly cruise price report'), period: t('Week'), none: t('none this week'), drops: t('Biggest price drops this week'), noDrops: t('No route got cheaper this week.') };
}

const VERDICT = { RECOMMENDED: 'Recommended upgrade', CONSIDER: 'Worth considering', NOT_WORTH: 'Not worth it' } as const;

/** The deal report (daily, weekly or monthly) as a standalone HTML page (rendered to PDF by Chromium). */
export function weeklyReportHtml(report: WeeklyReport, locale: Locale = 'en'): string {
  const t = createT(locale);
  const w = wording(t, report.kind ?? 'weekly');
  const day = (iso: string) => iso.slice(0, 10);
  const providers =
    report.providerComparison.length === 0
      ? `<p class="muted">${esc(t('No provider data yet.'))}</p>`
      : `<table><thead><tr><th>${esc(t('Provider'))}</th><th>${esc(t('Routes'))}</th><th>${esc(t('Avg trip total'))}</th><th>${esc(t('Avg discount'))}</th><th>${esc(t('Stability'))}</th><th>${esc(t('Forecast accuracy'))}</th><th>${esc(t('Score'))}</th></tr></thead><tbody>${report.providerComparison
          .map((p) => `<tr><td>${esc(p.provider)}</td><td>${p.routes}</td><td>${eur(p.averagePrice)}</td><td>${p.averageDiscountPct.toFixed(1)}%</td><td>${p.stabilityScore}</td><td>${p.forecastAccuracy === null ? esc(t('not yet measurable')) : `${Math.round(p.forecastAccuracy * 100)}%`}</td><td>${p.score}</td></tr>`)
          .join('')}</tbody></table>`;
  const upgrades =
    (report.bestUpgrades ?? []).length === 0
      ? `<p class="muted">${esc(t('No upgrade is worth considering right now.'))}</p>`
      : `<table><thead><tr><th>${esc(t('Route'))}</th><th>${esc(t('Fare'))}</th><th>${esc(t('Upgrade'))}</th><th>${esc(t('Cost difference'))}</th><th>%</th><th>${esc(t('Upgrade score'))}</th><th></th></tr></thead><tbody>${report.bestUpgrades
          .map((u) => `<tr><td>${esc(u.route)}</td><td>${esc(u.fare ?? '–')}</td><td>${esc(u.from)} → ${esc(u.to)}</td><td><b>${eur(u.costDifference)}</b></td><td>${pct(u.pctDifference)}</td><td>${u.upgradeScore}</td><td>${esc(t(VERDICT[u.verdict]))}</td></tr>`)
          .join('')}</tbody></table>`;
  const forecasts =
    (report.forecastSummary ?? []).length === 0
      ? `<p class="muted">${esc(t('Forecasts need at least 5 price snapshots per route.'))}</p>`
      : `<table><thead><tr><th>${esc(t('Route'))}</th><th>${esc(t('Current'))}</th><th>${esc(t('In 30 days'))}</th><th>${esc(t('30-day outlook'))}</th><th>${esc(t('Confidence'))}</th><th>${esc(t('Advice'))}</th></tr></thead><tbody>${report.forecastSummary
          .map((f) => `<tr><td>${esc(f.route)}</td><td>${eur(f.current)}</td><td>${eur(f.forecast30Day)}</td><td>${pct(f.expected30dChangePct)}</td><td>${f.confidence === null ? '–' : `${Math.round(f.confidence * 100)}%`}</td><td><b>${esc(t(f.recommendation))}</b></td></tr>`)
          .join('')}</tbody></table>`;
  const accuracy =
    report.forecastAccuracy.overall === null
      ? t('Not yet measurable: not enough history for a backtest.')
      : t('{pct}% of 30-day forecasts called the direction correctly (walk-forward backtest).', { pct: Math.round(report.forecastAccuracy.overall * 100) });

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${esc(w.title)}</title><style>
body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f1b2d;margin:32px;font-size:12px}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #dde4ee;padding-bottom:3px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #eef2f7}th{color:#5b6b82;font-weight:600}
.muted{color:#5b6b82}</style></head><body>
<h1>${esc(w.title)}</h1>
<p class="muted">${esc(t('{from} to {to} · generated {at}', { from: day(report.periodStart), to: day(report.periodEnd), at: report.generatedAt }))}</p>
<h2>${esc(t('Executive deal summary'))}</h2><table><thead><tr><th></th><th>${esc(t('Route'))}</th><th>${esc(t('Cabin · fare'))}</th><th>${esc(t('Cruise'))}</th><th>${esc(t('Flight'))}</th><th>${esc(t('Total'))}</th><th>${esc(w.period)}</th></tr></thead><tbody>${[
    dealRow(t, t('Best deal'), report.deals.bestDeal, w.none),
    dealRow(t, t('Best balcony'), report.deals.bestBalcony, w.none),
    dealRow(t, t('Best suite'), report.deals.bestSuite, w.none),
    dealRow(t, t('Biggest drop'), report.deals.biggestDrop, w.none),
    dealRow(t, t('Best fare'), report.deals.bestFare, w.none),
  ].join('')}</tbody></table>
<h2>${esc(t('Best opportunities'))}</h2>${routeTable(t, report.bestOpportunities, t('No route is currently recommended for booking.'), w.period)}
<h2>${esc(w.drops)}</h2>${routeTable(t, report.biggestDrops, w.noDrops, w.period)}
<h2>${esc(t('Best upgrades'))}</h2>${upgrades}
<h2>${esc(t('Provider comparison'))}</h2>${providers}
<h2>${esc(t('Recommendations'))}</h2>${routeTable(t, report.routes, t('No routes.'), w.period)}
<h2>${esc(t('Forecast summary'))}</h2>${forecasts}
<h2>${esc(t('Forecast accuracy'))}</h2><p>${esc(accuracy)}</p>
</body></html>`;
}
