import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProviderRegistry } from '@cruise/collector';
import { createStores } from '@cruise/shared/storage';
import { createApiServer } from './app';
import {
  authFromEnv,
  base32Decode,
  base32Encode,
  cookieValue,
  createLoginLimiter,
  createSession,
  generateTotpSecret,
  hashPassword,
  matchTotp,
  otpauthUri,
  readSession,
  totpCode,
  verifyPassword,
  type AuthConfig,
} from './auth';

describe('password', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt:16384:8:1:[\w-]+:[\w-]+$/);
    expect(hash).not.toContain('$'); // survives .env files and docker compose
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
  });
  it('salts: the same password gives different hashes', async () => {
    expect(await hashPassword('same-password-12')).not.toBe(await hashPassword('same-password-12'));
  });
});

describe('totp', () => {
  // RFC 6238 test vector: secret "12345678901234567890", T = 59 s -> 94287082 (8 digits), so 287082 with 6.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC 6238 test vectors', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });
  it('accepts the current and the neighbouring step, nothing else', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(matchTotp(secret, totpCode(secret, step), now)).toBe(step);
    expect(matchTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, totpCode(secret, step - 2), now)).toBeNull();
    expect(matchTotp(secret, '12345', now)).toBeNull();
    expect(matchTotp(secret, 'abcdef', now)).toBeNull();
  });
  it('round-trips base32 and builds the link for authenticator apps', () => {
    const generated = generateTotpSecret();
    expect(generated).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(generated))).toBe(generated);
    expect(() => base32Decode('not base32!')).toThrow();
    expect(otpauthUri(secret, 'dusan')).toBe(`otpauth://totp/Cruise%20Price%20Tracker:dusan?secret=${secret}&issuer=Cruise%20Price%20Tracker&algorithm=SHA1&digits=6&period=30`);
  });
});

describe('session cookie', () => {
  const key = 'k'.repeat(40);
  it('reads back a valid session and refuses tampered, foreign and expired ones', () => {
    const token = createSession('dusan', key, 1000, 1);
    expect(readSession(token, key, 2000)).toBe('dusan');
    expect(readSession(token, 'other-secret'.repeat(4), 2000)).toBeNull();
    expect(readSession(token, key, 1000 + 3_600_001)).toBeNull();
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'admin', exp: 9e15 })).toString('base64url');
    expect(readSession(`${forged}.${signature}`, key, 2000)).toBeNull();
    expect(readSession(`${payload}.x`, key, 2000)).toBeNull();
    expect(readSession(undefined, key, 2000)).toBeNull();
    expect(readSession('garbage', key, 2000)).toBeNull();
  });
  it('finds a cookie by name', () => {
    expect(cookieValue('a=1; cruise_session=abc.def; b=2', 'cruise_session')).toBe('abc.def');
    expect(cookieValue('a=1', 'cruise_session')).toBeUndefined();
    expect(cookieValue(undefined, 'x')).toBeUndefined();
  });
});

describe('login limiter', () => {
  it('locks an address after five failures for the window, and everybody after twenty overall', () => {
    const limiter = createLoginLimiter({ perAddress: 5, overall: 8, windowMs: 60_000 });
    for (let i = 0; i < 4; i++) limiter.fail('1.1.1.1', 0);
    expect(limiter.retryAfter('1.1.1.1', 0)).toBe(0);
    limiter.fail('1.1.1.1', 0);
    expect(limiter.retryAfter('1.1.1.1', 1000)).toBe(59);
    expect(limiter.retryAfter('2.2.2.2', 1000)).toBe(0);
    expect(limiter.retryAfter('1.1.1.1', 61_000)).toBe(0); // the window is over
    limiter.succeed('1.1.1.1');
    expect(limiter.retryAfter('1.1.1.1', 1000)).toBe(0);
    for (let i = 0; i < 8; i++) limiter.fail(`9.9.9.${i}`, 5000);
    expect(limiter.retryAfter('3.3.3.3', 6000)).toBeGreaterThan(0); // many addresses together
  });
});

describe('authFromEnv', () => {
  const base = { AUTH_USER: 'dusan', AUTH_PASSWORD_HASH: 'scrypt:1:2:3:a:b', AUTH_SESSION_SECRET: 's'.repeat(32) };
  it('is off without a password hash', () => expect(authFromEnv({})).toBeNull());
  it('reads the settings and defaults to Secure cookies and 12 hours', () => {
    expect(authFromEnv(base)).toMatchObject({ user: 'dusan', totpSecret: null, cookieSecure: true, sessionHours: 12 });
    expect(authFromEnv({ ...base, AUTH_TOTP_SECRET: 'abcd efgh', AUTH_COOKIE_SECURE: '0', AUTH_SESSION_HOURS: '2' })).toMatchObject({ totpSecret: 'ABCDEFGH', cookieSecure: false, sessionHours: 2 });
  });
  it('refuses a half-configured sign-in instead of starting open', () => {
    expect(() => authFromEnv({ ...base, AUTH_SESSION_SECRET: 'short' })).toThrow(/AUTH_SESSION_SECRET/);
    expect(() => authFromEnv({ ...base, AUTH_USER: '' })).toThrow(/AUTH_USER/);
    expect(() => authFromEnv({ ...base, AUTH_PASSWORD_HASH: '$2a$10$bcrypt' })).toThrow(/format/);
    // N/r/p must be plain integers: a malformed value here would otherwise crash scrypt() on every sign-in attempt.
    expect(() => authFromEnv({ ...base, AUTH_PASSWORD_HASH: 'scrypt:x:8:1:a:b' })).toThrow(/format/);
    expect(() => authFromEnv({ ...base, AUTH_PASSWORD_HASH: 'scrypt:16384:8:1:a' })).toThrow(/format/);
  });
});

describe('verifyPassword with a malformed stored hash', () => {
  it('returns false instead of throwing', async () => {
    await expect(verifyPassword('x', 'scrypt:not-a-number:8:1:salt:hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt:16384:8:1:not-base64url!!:hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'plain-text')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });
});

describe('API with sign-in', () => {
  let dir: string;
  let server: Server;
  let base: string;
  let auth: AuthConfig;
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const PASSWORD = 'a-long-test-password';

  async function start(totpSecret: string | null) {
    auth = { user: 'dusan', passwordHash: await hashPassword(PASSWORD), sessionSecret: 'x'.repeat(40), totpSecret, cookieSecure: true, sessionHours: 12 };
    server = createApiServer({ stores: createStores(dir), collection: { registry: createProviderRegistry('mock') }, auth });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  }
  const call = async (method: string, path: string, init: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    return { status: res.status, headers: res.headers, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };
  const login = (body: object, headers?: Record<string, string>) => call('POST', '/api/auth/login', { body, ...(headers ? { headers } : {}) });
  const cookieOf = (r: { headers: Headers }) => (r.headers.get('set-cookie') ?? '').split(';')[0]!;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cruise-auth-'));
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps everything but health, the session check and the login behind a session', async () => {
    await start(null);
    expect((await call('GET', '/api/health')).status).toBe(200);
    expect((await call('GET', '/api/auth/session')).body).toEqual({ authRequired: true, authenticated: false });
    for (const [method, path] of [['GET', '/api/routes'], ['GET', '/api/intelligence'], ['POST', '/api/collect'], ['DELETE', '/api/routes/x'], ['GET', '/api/failures/logs/x'], ['GET', '/api/reports/deals/x.pdf'], ['POST', '/api/copilot']] as const) {
      const r = await call(method, path);
      expect([method, path, r.status, r.body?.code]).toEqual([method, path, 401, 'UNAUTHENTICATED']);
    }
    // a forged or foreign cookie is no session
    expect((await call('GET', '/api/routes', { cookie: 'cruise_session=abc.def' })).status).toBe(401);
    const foreign = createSession('dusan', 'another-secret-another-secret-another', Date.now(), 1);
    expect((await call('GET', '/api/routes', { cookie: `cruise_session=${foreign}` })).status).toBe(401);
  });

  it('signs in with the password and sets a hardened cookie', async () => {
    await start(null);
    const wrong = await login({ username: 'dusan', password: 'nope-nope-nope' });
    expect([wrong.status, wrong.body?.code]).toEqual([401, 'BAD_CREDENTIALS']);
    expect((await login({ username: 'someone', password: PASSWORD })).status).toBe(401);
    expect((await login({ password: PASSWORD })).status).toBe(401);
    expect((await login({ username: 'dusan', password: 12345 })).status).toBe(401);

    const ok = await login({ username: 'dusan', password: PASSWORD });
    expect(ok.status).toBe(200);
    const header = ok.headers.get('set-cookie')!;
    expect(header).toMatch(/^cruise_session=/);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Secure');
    expect(header).toContain('Max-Age=43200');
    expect(ok.headers.get('cache-control')).toBe('no-store');

    const cookie = cookieOf(ok);
    expect((await call('GET', '/api/routes', { cookie })).status).toBe(200);
    expect((await call('GET', '/api/auth/session', { cookie })).body).toEqual({ authRequired: true, authenticated: true });
  });

  it('signs out by clearing the cookie', async () => {
    await start(null);
    const out = await call('POST', '/api/auth/logout');
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('asks for the authenticator code after a right password, and a code works only once', async () => {
    await start(secret);
    const body = { username: 'dusan', password: PASSWORD };
    const missing = await login(body);
    expect([missing.status, missing.body?.code, missing.headers.get('set-cookie')]).toEqual([401, 'TOTP_REQUIRED', null]);
    expect((await login({ ...body, password: 'wrong-wrong-wrong' })).body?.code).toBe('BAD_CREDENTIALS'); // no hint about the code

    const code = totpCode(secret, Math.floor(Date.now() / 30_000));
    expect((await login({ ...body, code: '000000' })).body?.code).toBe('BAD_CODE');
    const ok = await login({ ...body, code: `${code.slice(0, 3)} ${code.slice(3)}` });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/api/routes', { cookie: cookieOf(ok) })).status).toBe(200);
    const again = await login({ ...body, code });
    expect([again.status, again.body?.code]).toEqual([401, 'BAD_CODE']); // replay of the same code
  });

  it('locks the sign-in after five wrong attempts, even for the right password', async () => {
    await start(null);
    for (let i = 0; i < 5; i++) expect((await login({ username: 'dusan', password: 'wrong-wrong-wrong' })).status).toBe(401);
    const locked = await login({ username: 'dusan', password: PASSWORD });
    expect([locked.status, locked.body?.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    // another address (as Caddy reports it) is not locked
    expect((await login({ username: 'dusan', password: PASSWORD }, { 'x-forwarded-for': '203.0.113.7' })).status).toBe(200);
  });

  it('refuses writes that come from another site', async () => {
    await start(null);
    const cookie = cookieOf(await login({ username: 'dusan', password: PASSWORD }));
    const host = new URL(base).host;
    const post = (origin: string) => call('POST', '/api/routes', { cookie, body: {}, headers: { origin } });
    expect((await post('https://evil.example')).status).toBe(403);
    expect((await post('null')).status).toBe(403);
    expect((await post(`http://${host}`)).status).toBe(400); // same site: passes the check, then the empty route is rejected
    expect((await login({ username: 'dusan', password: PASSWORD }, { origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('API without sign-in', () => {
  it('stays open and reports it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cruise-open-'));
    const server = createApiServer({ stores: createStores(dir) });
    await new Promise<void>((r) => server.listen(0, r));
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    expect(await (await fetch(`${base}/api/auth/session`)).json()).toEqual({ authRequired: false, authenticated: true });
    expect((await fetch(`${base}/api/routes`)).status).toBe(200);
    expect((await fetch(`${base}/api/auth/login`, { method: 'POST' })).status).toBe(404);
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
});
