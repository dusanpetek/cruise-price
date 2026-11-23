import { PROVIDER_LABELS, type ProviderId } from '@cruise/domain';
import { PROVIDER_LOGO_SRC } from '@/assets/providerLogos';
import { cn } from '@/lib/utils';

/**
 * The mark of a cruise line (only the symbol, embedded in the app, see assets/providerLogos.ts) on a light tile, so the dark
 * outline of the AIDA lips stays visible in dark mode. It is decorative: the name of the cruise line is always written next
 * to it, so screen readers and link names do not read it twice.
 */
export function ProviderLogo({ provider, size = 32, className }: { provider: ProviderId; size?: number; className?: string }) {
  const pad = Math.max(2, Math.round(size / 8));
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-border', className)} style={{ width: size, height: size, padding: pad }} data-provider={provider} title={PROVIDER_LABELS[provider]}>
      <img src={PROVIDER_LOGO_SRC[provider]} alt="" aria-hidden="true" className="h-full w-full object-contain" data-testid="provider-logo" />
    </span>
  );
}
