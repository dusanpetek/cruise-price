import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/queries';
import { UNAUTHENTICATED_EVENT } from '@/lib/api';
import { t } from '@/lib/i18n';
import LoginPage from '@/pages/Login';

/** Shows the app only with a session (or when the server needs none); otherwise the sign-in page. */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isPending, isError, refetch } = useSession();

  // The API answered 401 somewhere: ask the server again, the sign-in page follows.
  useEffect(() => {
    const onExpired = () => void qc.invalidateQueries({ queryKey: ['session'] });
    window.addEventListener(UNAUTHENTICATED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onExpired);
  }, [qc]);

  if (isPending) return <p className="p-8 text-center text-sm text-muted-foreground">{t('Loading…')}</p>;
  if (isError)
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-sm" role="alert">
        <p className="text-muted-foreground">{t('The server could not be reached.')}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('Try again')}
        </Button>
      </div>
    );
  if (data.authRequired && !data.authenticated) return <LoginPage />;
  return <>{children}</>;
}
