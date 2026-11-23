import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Sign-in for the API: one user, a password (scrypt hash), optionally a second factor (TOTP: Microsoft Authenticator,
 * Google Authenticator, ...) and a signed session cookie. Switched on by AUTH_PASSWORD_HASH; without it the API is open
 * (local development).
 */
export interface AuthConfig {
  user: string;
  /** `scrypt:N:r:p:<salt>:<hash>` from `pnpm --filter @cruise/api auth:setup`. The format has no "$", so .env files and compose keep it as it is. */
  passwordHash: string;
  /** Signs the session cookies. Changing it signs everybody out. */
  sessionSecret: string;
  /** Base32 secret of the authenticator app; without it the password alone signs in. */
  totpSecret: string | null;
  /** `Secure` cookie: only over HTTPS. Switch off (AUTH_COOKIE_SECURE=0) for http://localhost. */
  cookieSecure: boolean;
  sessionHours: number;
}

export const COOKIE_NAME = 'cruise_session';

/** Reads the configuration; null = authentication is off. A half-configured setup throws, so the server never starts open by mistake. */
export function authFromEnv(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const passwordHash = env.AUTH_PASSWORD_HASH?.trim();
  if (!passwordHash) return null;
  const sessionSecret = env.AUTH_SESSION_SECRET?.trim();
  if (!sessionSecret || sessionSecret.length < 32) throw new Error('AUTH_SESSION_SECRET must be set (at least 32 characters) when AUTH_PASSWORD_HASH is set');
  const user = env.AUTH_USER?.trim();
  if (!user) throw new Error('AUTH_USER must be set when AUTH_PASSWORD_HASH is set');
  // N/r/p must be plain integers: scrypt() throws synchronously on a malformed value, which would otherwise turn every
  // sign-in attempt into a 500 instead of a clean rejection.
  if (!/^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/.test(passwordHash)) throw new Error('AUTH_PASSWORD_HASH has an unknown format; create it with `pnpm --filter @cruise/api auth:setup`');
  const hours = Number(env.AUTH_SESSION_HOURS ?? 12);
  return {
    user,
    passwordHash,
    sessionSecret,
    totpSecret: env.AUTH_TOTP_SECRET?.trim().replace(/\s+/g, '').toUpperCase() || null,
    cookieSecure: env.AUTH_COOKIE_SECURE !== '0',
    sessionHours: Number.isFinite(hours) && hours > 0 ? hours : 12,
  };
}

// --- password ---

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 32 } as const;

const derive = (password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, keyLength, { N, r, p }, (e, key) => (e ? reject(e) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join(':');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash || ![n, r, p].every((v) => /^\d+$/.test(v ?? ''))) return false;
  const expected = Buffer.from(hash, 'base64url');
  try {
    const key = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p), expected.length);
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    // A malformed stored hash (bad base64, N/r/p out of scrypt's allowed range, ...) means "does not match", not a 500.
    return false;
  }
}

/** A valid hash of a password nobody has: verified when the user name is wrong, so the answer takes as long as for a right name. */
let decoy: Promise<string> | undefined;
export const decoyHash = (): Promise<string> => (decoy ??= hashPassword(randomBytes(12).toString('hex')));

export const safeEqual = (a: string, b: string): boolean => {
  const x = createHmac('sha256', 'cmp').update(a).digest();
  const y = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(x, y);
};

// --- TOTP (RFC 6238, 6 digits, 30 s, SHA-1: what every authenticator app does) ---

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of text.replace(/=+$/, '')) {
    const index = BASE32.indexOf(ch);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpCode(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const binary = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The time step (30 s) of a code that fits now or one step before/after (clock drift), else null. */
export function matchTotp(secret: string, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(nowMs / 30_000);
  for (const step of [current, current - 1, current + 1]) if (safeEqual(totpCode(secret, step), code)) return step;
  return null;
}

export const otpauthUri = (secret: string, account: string, issuer = 'Cruise Price Tracker'): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// --- session cookie: base64url(payload).base64url(hmac) ---

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function createSession(user: string, secret: string, nowMs: number, hours: number): string {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: nowMs + hours * 3_600_000 })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The user of a valid, unexpired session cookie value, else null. */
export function readSession(token: string | undefined, secret: string, nowMs: number): string | null {
  const [payload, signature] = token?.split('.') ?? [];
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: unknown; exp?: unknown };
    return typeof u === 'string' && typeof exp === 'number' && exp > nowMs ? u : null;
  } catch {
    return null;
  }
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export function sessionCookie(token: string, config: AuthConfig): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.round(config.sessionHours * 3600)}${config.cookieSecure ? '; Secure' : ''}`;
}

export const clearedCookie = (config: AuthConfig): string => `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.cookieSecure ? '; Secure' : ''}`;

// --- brute-force protection ---

/** Counts failed sign-ins per address and overall; too many lock the sign-in for a while. In memory: a restart clears it. */
export function createLoginLimiter(options: { perAddress?: number; overall?: number; windowMs?: number } = {}) {
  const { perAddress = 5, overall = 20, windowMs = 15 * 60_000 } = options;
  const failures = new Map<string, number[]>();
  const recent = (key: string, now: number) => {
    const list = (failures.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  };
  return {
    /** 0 = allowed, else the seconds until the sign-in is open again. */
    retryAfter(address: string, now: number): number {
      const waits = ([[address, perAddress], ['*', overall]] as const).flatMap(([key, max]) => {
        const list = recent(key, now);
        return list.length >= max ? [Math.ceil((list[list.length - max]! + windowMs - now) / 1000)] : [];
      });
      return waits.length ? Math.max(...waits) : 0;
    },
    fail(address: string, now: number): void {
      for (const key of [address, '*']) failures.set(key, [...recent(key, now), now]);
    },
    succeed(address: string): void {
      failures.delete(address);
    },
  };
}
export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
