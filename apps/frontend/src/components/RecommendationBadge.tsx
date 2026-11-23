import type { RecommendationAction } from '@cruise/analytics';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const STYLES: Record<RecommendationAction, string> = {
  BUY_NOW: 'bg-good/15 text-good',
  LIKELY_GOOD: 'bg-good/10 text-good',
  WAIT: 'bg-warn/15 text-warn',
  WAIT_FOR_DROP: 'bg-warn/15 text-warn',
  MONITOR: 'bg-muted text-muted-foreground',
  AVOID: 'bg-bad/15 text-bad',
};

/** The action is spelled out (not just coloured) so it does not rely on colour alone. */
export function RecommendationBadge({ action, confidence, className }: { action: RecommendationAction; confidence?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', STYLES[action], className)}>
      {t(action)}
      {confidence !== undefined && <span className="font-normal">· {Math.round(confidence * 100)}%</span>}
    </span>
  );
}
