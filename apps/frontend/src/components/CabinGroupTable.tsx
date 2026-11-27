import type { CabinGroupBreakdown } from '@cruise/analytics';
import { CABIN_GROUP_LABELS } from '@cruise/domain';
import { formatMoney } from '@cruise/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/lib/i18n';

/** The cabin categories of the latest collection by group (inside, balcony, …), cheapest first, each with its difference to the cheapest of the group. */
export function CabinGroupTable({ breakdown, currency }: { breakdown: CabinGroupBreakdown[]; currency: string }) {
  return (
    <Card data-testid="cabin-group-table">
      <CardHeader>
        <CardTitle>{t('Cabin groups')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {breakdown.length === 0 && <p className="text-sm text-muted-foreground">{t('No cabin prices collected yet.')}</p>}
        {breakdown.map((g) => (
          <section key={g.group ?? 'other'} data-testid="cabin-group">
            <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold">
              <span>{g.group ? t(CABIN_GROUP_LABELS[g.group]) : t('Other')}</span>
              {g.entries.length > 1 && <span className="text-xs font-normal text-muted-foreground">{t('Spread {amount}', { amount: formatMoney(g.spread, currency) })}</span>}
            </h3>
            <div className="overflow-x-auto">
              <table className="mt-1 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">{t('Cabin')}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t('Per person')}</th>
                    <th className="py-1 pr-3 text-right font-medium">{t('Trip total')}</th>
                    <th className="py-1 text-right font-medium">{t('Difference to the cheapest')}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.entries.map((e) => (
                    <tr key={`${e.category}|${e.subcategory ?? ''}`} className="border-t border-border tabular-nums">
                      <td className="py-1 pr-3">{e.subcategory ? `${e.category} · ${e.subcategory}` : e.category}</td>
                      <td className="py-1 pr-3 text-right">{formatMoney(e.tripPerPerson, currency)}</td>
                      <td className="py-1 pr-3 text-right">{formatMoney(e.tripTotal, currency)}</td>
                      <td className="py-1 text-right text-muted-foreground">{g.entries.length > 1 && e.deltaToCheapest > 0 ? `+${formatMoney(e.deltaToCheapest, currency)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
