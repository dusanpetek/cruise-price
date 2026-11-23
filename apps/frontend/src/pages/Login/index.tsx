import { useState } from 'react';
import { Ship } from 'lucide-react';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { useLogin } from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

/** Sign-in: user and password; when the server wants an authenticator code, a second step asks for it. */
export default function LoginPage() {
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate(
      { username, password, ...(needsCode ? { code } : {}) },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') return setNeedsCode(true); // password accepted: now the code
          if (err instanceof ApiError && err.code === 'BAD_CODE') setCode('');
          setError(err instanceof Error ? err.message : t('The server could not be reached.'));
          if (err instanceof ApiError && err.code === 'BAD_CREDENTIALS') setPassword('');
        },
      },
    );
  };

  const back = () => {
    setNeedsCode(false);
    setCode('');
    setError(null);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex justify-end p-4">
        <LanguageSwitch />
      </div>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 pb-24">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Ship size={24} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{t('Cruise Price Tracker')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{needsCode ? t('Enter the 6-digit code from your authenticator app.') : t('Sign in to continue.')}</p>
          </div>
        </div>
        <Card>
          <CardContent className="p-5">
            <form onSubmit={submit} className="flex flex-col gap-4" aria-label={t('Sign in')} data-testid="login-form">
              {needsCode ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="login-code">{t('Code from your authenticator app')}</Label>
                  <Input
                    id="login-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]*"
                    maxLength={7}
                    placeholder="123 456"
                    className="text-center text-lg tracking-widest tabular-nums"
                    autoFocus
                    required
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="login-user">{t('Username')}</Label>
                    <Input id="login-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="login-password">{t('Password')}</Label>
                    <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                  </div>
                </>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive" data-testid="login-error">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={login.isPending} data-testid="login-submit">
                {login.isPending ? t('Signing in…') : t('Sign in')}
              </Button>
              {needsCode && (
                <Button type="button" variant="ghost" size="sm" onClick={back}>
                  {t('Back')}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
