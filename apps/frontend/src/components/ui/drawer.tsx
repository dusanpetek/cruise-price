import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/**
 * A full-height panel that slides in from the left or right edge, for mobile navigation and the mobile route list.
 * Same native-`<dialog>` approach as `RouteSearchDialog`: Escape and the backdrop close it for free, and whatever
 * closes it (the X button, Escape, a caller-triggered `onClose`) goes through the same `onClose` prop.
 */
export function Drawer({ open, onClose, side, 'aria-label': ariaLabel, children }: { open: boolean; onClose: () => void; side: 'left' | 'right'; 'aria-label': string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return createPortal(
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-label={ariaLabel}
      className={`m-0 ${side === 'left' ? 'mr-auto' : 'ml-auto'} h-dvh max-h-dvh w-[min(20rem,85vw)] border-${side === 'left' ? 'r' : 'l'} border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-end border-b border-border p-2">
          <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label={t('Close')}>
            ✕
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </dialog>,
    document.body,
  );
}
