import { tripTotal } from '@cruise/analytics';
import { formatMoney } from '@cruise/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const TOTAL_SIZE = { sm: 'text-base', md: 'text-xl', lg: 'text-2xl' } as const;

/**
 * The only way prices of a trip are shown: cruise, flight and total together, the total largest.
 * The total is computed here (cruise + flight), so the three numbers can never disagree.
 */
export function PriceTriple({
  cruise,
  flight,
  currency = 'EUR',
  size = 'md',
  className,
}: {
  cruise: number;
  flight: number;
  currency?: string;
  size?: keyof typeof TOTAL_SIZE;
  className?: string;
}) {
  const total = tripTotal(cruise, flight);
  const money = (v: number) => formatMoney(v, currency);
  return (
    <div className={cn('flex flex-col', className)} data-testid="price-triple">
      <div className={cn('font-semibold tabular-nums leading-tight', TOTAL_SIZE[size])} data-testid="price-total">
        {money(total)} <span className="text-xs font-normal text-muted-foreground">{t('Total')}</span>
      </div>
      <div className="text-xs tabular-nums text-muted-foreground" data-testid="price-parts">
        {t('Cruise {cruise} + Flight {flight}', { cruise: money(cruise), flight: money(flight) })}
      </div>
    </div>
  );
}

/** Three table columns for the same rule: cruise, flight, TOTAL (the largest). Use with <PriceHeaders />. */
export function PriceHeaders() {
  return (
    <>
      <th className="py-1 pr-3 font-medium">{t('Cruise')}</th>
      <th className="py-1 pr-3 font-medium">{t('Flight')}</th>
      <th className="py-1 pr-3 font-medium">{t('Total')}</th>
    </>
  );
}

export function PriceCells({ cruise, flight, currency = 'EUR' }: { cruise: number; flight: number; currency?: string }) {
  const money = (v: number) => formatMoney(v, currency);
  return (
    <>
      <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{money(cruise)}</td>
      <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{money(flight)}</td>
      <td className="py-1.5 pr-3 text-base font-semibold tabular-nums" data-testid="price-total">{money(tripTotal(cruise, flight))}</td>
    </>
  );
}
