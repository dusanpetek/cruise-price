import type { UpgradeVerdict } from '@cruise/analytics';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const VERDICTS: Record<UpgradeVerdict, { label: string; style: string }> = {
  RECOMMENDED: { label: 'Recommended upgrade', style: 'bg-good/20 text-good' },
  CONSIDER: { label: 'Worth considering', style: 'bg-warn/15 text-warn' },
  NOT_WORTH: { label: 'Not worth it', style: 'bg-bad/15 text-bad' },
};

/** The upgrade verdict, always spelled out. */
export const VerdictBadge = ({ verdict, className }: { verdict: UpgradeVerdict; className?: string }) => (
  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', VERDICTS[verdict].style, className)}>{t(VERDICTS[verdict].label)}</span>
);
