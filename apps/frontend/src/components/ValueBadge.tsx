import type { FareValue } from '@cruise/analytics';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const STYLE: Record<FareValue['label'], string> = {
  'Excellent value': 'bg-good/20 text-good',
  'Good value': 'bg-good/10 text-good',
  'Neutral value': 'bg-muted text-muted-foreground',
  'Poor value': 'bg-bad/15 text-bad',
};

/** The fare value score with its band spelled out (not only coloured). */
export function ValueBadge({ score, label, className }: { score: number; label: FareValue['label']; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', STYLE[label], className)} data-testid="value-badge">
      {score} <span className="font-normal">· {t(label)}</span>
    </span>
  );
}
