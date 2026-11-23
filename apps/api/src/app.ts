import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { analyzePortfolio, analyzeRoute, askCopilot, buildHistoricalDataset, isReportKind } from '@cruise/analytics';
import { AlertRuleInputSchema, FavoriteSchema, PROVIDER_IDS, RouteInputSchema, SnapshotInputSchema, type CruiseSnapshot, type ProviderId, type Route } from '@cruise/domain';
import {
  collectRoutes,
  collectorModeFromEnv,
  generateDealReport,
  generateWeeklyReport,
  cachedRouteSearch,
  searchRoutes,
  type RouteSearchDeps,
  routerFromStores,
  type BatchDeps,
  type BrowserFactory,
} from '@cruise/collector';
import { createT, isLocale, serverLocale, type Locale } from '@cruise/i18n';
import { CHANNEL_IDS, type NotificationRouter } from '@cruise/notifications';
import { CollectorLockedError, FAILURE_KINDS, NotFoundError, type FailureKind, type Stores } from '@cruise/shared/storage';
import {
  COOKIE_NAME,
  clearedCookie,
  cookieValue,
  createLoginLimiter,
  createSession,
  decoyHash,
  matchTotp,
  readSession,
  safeEqual,
  sessionCookie,
  verifyPassword,
  type AuthConfig,
  type LoginLimiter,
} from './auth';

export interface ApiDeps {
  stores: Stores;
  /** Overrides for the collection run (tests inject a mock registry). */
  collection?: Pick<BatchDeps, 'registry' | 'browserFactory' | 'config' | 'afterSnapshot'>;
  /** Notification router for "send test"; defaults to the one built from data/notifications.json. */
  notificationRouter?: () => Promise<NotificationRouter | null>;
  /** Weekly report overrides (tests pass a fake browser or a fixed clock). */
  weekly?: { browserFactory?: BrowserFactory; now?: () => Date };
  /** Overrides for the route search (tests inject a fake browser). */
  search?: RouteSearchDeps;
  /** Sign-in. Without it the API is open (local development); the server reads it from AUTH_* (see auth.ts). */
  auth?: AuthConfig | null;
}

/** What the sign-in remembers between requests: failed attempts and the last accepted authenticator code. */
interface AuthState {
  limiter: LoginLimiter;
  lastTotpStep: number;
}

const MAX_BODY = 1_000_000;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    // Keep draining an oversized body (without storing it) so the client can finish sending and read our 413.
    if (size <= MAX_BODY) chunks.push(c as Buffer);
  }
  if (size > MAX_BODY) throw new RangeError('Request body too large');
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

const CONTENT_TYPES: Record<FailureKind, string> = { screenshots: 'image/png', html: 'text/plain; charset=utf-8', logs: 'application/json' };

/** The caller's address as Caddy reports it (the API is only reachable through it); the socket address when called directly. */
const clientAddress = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] ?? '').split(',').pop()?.trim() || req.socket.remoteAddress || 'unknown';

/** A browser sends Origin with every cross-site write; it must be this site. Calls without Origin (curl, tests) pass. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function handleAuthRoute(req: IncomingMessage, res: ServerResponse, path: string, method: string, auth: AuthConfig | null, state: AuthState, t: ReturnType<typeof createT>) {
  const now = Date.now();
  res.setHeader('cache-control', 'no-store');
  if (path === '/api/auth/session' && method === 'GET') {
    const user = auth ? readSession(cookieValue(req.headers.cookie, COOKIE_NAME), auth.sessionSecret, now) : null;
    return send(res, 200, { authRequired: auth !== null, authenticated: auth === null || user !== null });
  }
  if (!auth) return send(res, 404, { error: 'Not found' });
  if (path === '/api/auth/logout' && method === 'POST') {
    res.setHeader('set-cookie', clearedCookie(auth));
    return send(res, 200, { ok: true });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Cross-origin request refused' });
    const address = clientAddress(req);
    const wait = state.limiter.retryAfter(address, now);
    if (wait > 0) {
      res.setHeader('retry-after', String(wait));
      return send(res, 429, { error: t('Too many attempts. Try again in {minutes} minutes.', { minutes: Math.ceil(wait / 60) }), code: 'RATE_LIMITED', retryAfter: wait });
    }
    const body = (await readBody(req)) as { username?: unknown; password?: unknown; code?: unknown };
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const username = text(body.username, 200);
    const password = text(body.password, 200);
    const code = text(body.code, 20).replace(/\s/g, '');
    const userMatches = safeEqual(username, auth.user);
    // Always one scrypt run, with the real hash or a decoy, so a wrong user name costs the same time as a wrong password.
    const passwordMatches = await verifyPassword(password, userMatches ? auth.passwordHash : await decoyHash());
    if (!userMatches || !passwordMatches) {
      state.limiter.fail(address, now);
      return send(res, 401, { error: t('Wrong username or password.'), code: 'BAD_CREDENTIALS' });
    }
    if (auth.totpSecret) {
      if (!code) return send(res, 401, { error: t('Enter the 6-digit code from your authenticator app.'), code: 'TOTP_REQUIRED' });
      const step = matchTotp(auth.totpSecret, code, now);
      // A code works once: the step must be newer than the last one accepted.
      if (step === null || step <= state.lastTotpStep) {
        state.limiter.fail(address, now);
        return send(res, 401, { error: t('Wrong or already used code.'), code: 'BAD_CODE' });
      }
      state.lastTotpStep = step;
    }
    state.limiter.succeed(address);
    res.setHeader('set-cookie', sessionCookie(createSession(auth.user, auth.sessionSecret, now, auth.sessionHours), auth));
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'Method not allowed' });
}

async function handle(req: IncomingMessage, res: ServerResponse, { stores, collection, notificationRouter, weekly, search, auth = null, authState }: ApiDeps & { authState: AuthState }) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  /** Texts the server writes (recommendations, insights, reports) follow ?lang=, else CRUISE_LANGUAGE, else German. */
  const requested = url.searchParams.get('lang');
  const locale: Locale = isLocale(requested) ? requested : serverLocale();
  const t = createT(locale);

  if (path === '/api/health') return send(res, 200, { ok: true, collectorMode: collectorModeFromEnv() });

  if (path.startsWith('/api/auth/')) return handleAuthRoute(req, res, path, method, auth, authState, t);
  if (auth) {
    if (!readSession(cookieValue(req.headers.cookie, COOKIE_NAME), auth.sessionSecret, Date.now())) return send(res, 401, { error: t('Please sign in.'), code: 'UNAUTHENTICATED' });
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) return send(res, 403, { error: 'Cross-origin request refused' });
  }

  if (path === '/api/runs' && method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 500);
    return send(res, 200, await stores.runs.list(limit));
  }
  if (path === '/api/reports/daily' && method === 'GET') return send(res, 200, await stores.reports.readDaily());

  const failure = path.match(/^\/api\/failures\/(screenshots|html|logs)\/([^/]+)$/);
  if (failure && method === 'GET') {
    const kind = failure[1] as FailureKind;
    const id = failure[2]!.replace(new RegExp(`\\.${FAILURE_KINDS[kind]}$`), '');
    const file = await stores.failures.read(kind, id);
    if (!file) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': CONTENT_TYPES[kind] });
    return void res.end(file);
  }


  const loadSnapshots = async (routes: Route[]) =>
    Promise.all(routes.map(async (route) => ({ route, snapshots: await stores.snapshots.listByRoute(route.id) })));

  if (path === '/api/intelligence' && method === 'GET') {
    return send(res, 200, analyzePortfolio(await loadSnapshots(await stores.routes.list()), new Date().toISOString(), locale));
  }

  // Route search: what a cruise line offers, to pick a route instead of typing its URL.
  if (path === '/api/route-search' && method === 'GET') {
    const q = url.searchParams;
    const provider = q.get('provider');
    const date = (name: string) => {
      const v = q.get(name);
      return v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : (false as const)) : null;
    };
    const from = date('from');
    const to = date('to');
    const query = q.get('query')?.trim() ?? '';
    const limit = q.get('limit') === null ? undefined : Number(q.get('limit'));
    const refresh = q.get('refresh') === '1';
    if (!provider || !(PROVIDER_IDS as readonly string[]).includes(provider)) return send(res, 400, { error: t('Choose a cruise line to search.') });
    if (from === false || to === false) return send(res, 400, { error: t('Dates must be written YYYY-MM-DD.') });
    if (from && to && from > to) return send(res, 400, { error: t('The first date must not be after the last.') });
    if (query.length > 100) return send(res, 400, { error: t('The search text is too long (at most 100 characters).') });
    if (limit !== undefined && !Number.isInteger(limit)) return send(res, 400, { error: t('The limit must be a whole number.') });
    const criteria = { query, from, to, ...(limit !== undefined ? { limit } : {}), refresh };
    const deps: RouteSearchDeps = { mode: collectorModeFromEnv(), cache: stores.searchCache, ...search };
    // A recent answer needs no browser and no lock.
    const cached = await cachedRouteSearch(provider as ProviderId, criteria, deps);
    if (cached) return send(res, 200, cached);
    // Reading the website opens a browser like a collection does, so it takes the same lock: never two browsers on the sites at once.
    let release: (() => Promise<void>) | undefined;
    try {
      release = await stores.lock.acquire();
    } catch (e) {
      if (e instanceof CollectorLockedError) return send(res, 409, { error: t('A collection or another search is running. Try again in a minute.') });
      throw e;
    }
    let outcome: Awaited<ReturnType<typeof searchRoutes>> | undefined;
    let failure: Error | undefined;
    try {
      outcome = await searchRoutes(provider as ProviderId, criteria, deps);
    } catch (e) {
      failure = e as Error;
    } finally {
      await release(); // before the answer goes out, so the next request never finds the lock still held
    }
    return outcome ? send(res, 200, outcome) : send(res, 502, { error: t('The cruise line\'s website could not be searched: {reason}', { reason: failure?.message.split('\n')[0] ?? '' }) });
  }

  // Cruise Copilot: natural-language questions answered from the analysis (rules, no language model).
  if (path === '/api/copilot' && method === 'POST') {
    const body = (await readBody(req)) as { question?: unknown };
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 500) return send(res, 400, { error: t('Ask a question of up to 500 characters.') });
    const portfolio = analyzePortfolio(await loadSnapshots(await stores.routes.list()), new Date().toISOString(), locale);
    return send(res, 200, askCopilot(question, portfolio, locale));
  }

  if (path === '/api/alerts' && method === 'GET') {
    const q = url.searchParams;
    const since = q.get('since') ?? undefined;
    if (since && Number.isNaN(Date.parse(since))) return send(res, 400, { error: 'Invalid "since" timestamp' });
    return send(res, 200, await stores.alerts.list({ ...(q.get('provider') ? { provider: q.get('provider')! } : {}), ...(q.get('type') ? { type: q.get('type')! } : {}), ...(since ? { since } : {}) }));
  }
  const ack = path.match(/^\/api\/alerts\/([^/]+)\/acknowledge$/);
  if (ack && method === 'POST') return send(res, 200, await stores.alerts.acknowledge(ack[1]!));

  if (path === '/api/alert-rules') {
    if (method === 'GET') {
      await stores.alertRules.ensureDefaults();
      return send(res, 200, await stores.alertRules.list());
    }
    if (method === 'POST') {
      const input = AlertRuleInputSchema.parse(await readBody(req));
      if (input.routeId) await stores.routes.get(input.routeId);
      return send(res, 201, await stores.alertRules.create(input));
    }
  }
  const ruleId = path.match(/^\/api\/alert-rules\/([^/]+)$/);
  if (ruleId && method === 'DELETE') {
    await stores.alertRules.remove(ruleId[1]!);
    return send(res, 204);
  }

  if (path === '/api/notifications' && method === 'GET') {
    // Status only: credentials never leave the server.
    const router = await (notificationRouter ?? (() => routerFromStores(stores)))();
    return send(res, 200, router?.statuses ?? []);
  }
  if (path === '/api/notifications/test' && method === 'POST') {
    const body = (await readBody(req)) as { channel?: string };
    const channel = CHANNEL_IDS.find((c) => c === body.channel);
    if (!channel) return send(res, 400, { error: `channel must be one of ${CHANNEL_IDS.join(', ')}` });
    const router = await (notificationRouter ?? (() => routerFromStores(stores)))();
    const delivery = await router?.sendTest(channel, {
      route: 'Test notification',
      category: 'Cheapest cabin',
      alertType: 'NEW_LOW',
      currentPrice: 0,
      previousPrice: null,
      cruisePrice: 0,
      flightPrice: 0,
      totalPrice: 0,
      message: 'This is a test notification from Cruise Price Tracker.',
      provider: null,
      url: 'http://localhost:5173',
      createdAt: new Date().toISOString(),
    });
    if (!delivery) return send(res, 409, { error: `The ${channel} channel is not configured or is switched off` });
    return send(res, delivery.status === 'sent' ? 200 : 502, delivery);
  }

  if (path === '/api/reports/weekly' && method === 'POST') {
    const result = await generateWeeklyReport(stores, { locale, ...(weekly?.browserFactory ? { browserFactory: weekly.browserFactory } : {}), ...(weekly?.now ? { now: weekly.now() } : {}) });
    return send(res, 201, { date: result.date, files: result.files, pdfError: result.pdfError });
  }
  if (path === '/api/reports/weekly' && method === 'GET') return send(res, 200, await stores.weeklyReports.list('weekly'));

  // Deal reports: daily, weekly and monthly, as JSON, CSV and PDF.
  if (path === '/api/reports/deals' && method === 'POST') {
    const kind = url.searchParams.get('kind') ?? 'weekly';
    if (!isReportKind(kind)) return send(res, 400, { error: t('The report kind must be daily, weekly or monthly.') });
    const result = await generateDealReport(stores, kind, { locale, ...(weekly?.browserFactory ? { browserFactory: weekly.browserFactory } : {}), ...(weekly?.now ? { now: weekly.now() } : {}) });
    return send(res, 201, { kind, date: result.date, files: result.files, pdfError: result.pdfError });
  }
  if (path === '/api/reports/deals' && method === 'GET') {
    const kind = url.searchParams.get('kind');
    if (kind !== null && !isReportKind(kind)) return send(res, 400, { error: t('The report kind must be daily, weekly or monthly.') });
    return send(res, 200, await stores.weeklyReports.list(kind ?? undefined));
  }
  const dealFile = path.match(/^\/api\/reports\/deals\/([^/]+)$/);
  if (dealFile && method === 'GET') {
    const file = await stores.weeklyReports.read(dealFile[1]!);
    if (!file) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': file.contentType, 'content-disposition': `attachment; filename="${dealFile[1]}"` });
    return void res.end(file.data);
  }
  const weeklyFile = path.match(/^\/api\/reports\/weekly\/([^/]+)$/);
  if (weeklyFile && method === 'GET') {
    const file = await stores.weeklyReports.read(weeklyFile[1]!);
    if (!file) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': file.contentType, 'content-disposition': `attachment; filename="${weeklyFile[1]}"` });
    return void res.end(file.data);
  }

  const collectRun = async (routes: Route[], force = false) => {
    try {
      return await collectRoutes(routes, { stores, ...collection }, { trigger: 'manual', force });
    } catch (e) {
      if (e instanceof CollectorLockedError) return null;
      throw e;
    }
  };

  if (path === '/api/collect' && method === 'POST') {
    const outcome = await collectRun(await stores.routes.list());
    if (!outcome) return send(res, 409, { error: t('A collection is already running') });
    if (outcome.outcomes.length === 0 && outcome.skipped.length > 0) {
      return outcome.skippedDetail.some((d) => d.reason === 'weekly')
        ? send(res, 409, { error: t('Every route was already collected: cruises that leave in more than 6 months once a week, all others once a day.'), code: 'ALREADY_COLLECTED' })
        : send(res, 409, { error: t('Every route was already collected today. Prices are collected once per route and day.'), code: 'ALREADY_COLLECTED_TODAY' });
    }
    return send(res, 201, { run: outcome.run, skipped: outcome.skipped.map((r) => r.id) });
  }

  const m = path.match(/^\/api\/routes(?:\/([^/]+)(?:\/(snapshots|collect|intelligence|favorite|dataset))?)?$/);
  if (!m) return send(res, 404, { error: 'Not found' });
  const [, id, sub] = m;

  if (!id) {
    if (method === 'GET') return send(res, 200, await stores.routes.list());
    if (method === 'POST') return send(res, 201, await stores.routes.create(RouteInputSchema.parse(await readBody(req))));
  } else if (!sub) {
    if (method === 'GET') return send(res, 200, await stores.routes.get(id));
    if (method === 'PUT') return send(res, 200, await stores.routes.update(id, RouteInputSchema.parse(await readBody(req))));
    if (method === 'DELETE') {
      await stores.routes.remove(id);
      return send(res, 204);
    }
  } else if (sub === 'snapshots') {
    const route = await stores.routes.get(id);
    if (method === 'GET') return send(res, 200, await stores.snapshots.listByRoute(id));
    if (method === 'POST') {
      // Manual collection: the user types in the prices they see.
      const input = SnapshotInputSchema.parse({ ...(await readBody(req) as object), routeId: id, source: 'manual', provider: route.provider });
      return send(res, 201, await stores.snapshots.create(input));
    }
  } else if (sub === 'favorite' && method === 'PUT') {
    return send(res, 200, await stores.routes.setFavorite(id, FavoriteSchema.parse(await readBody(req))));
  } else if (sub === 'dataset' && method === 'GET') {
    // The historical intelligence dataset; always rebuilt from the snapshots, so it is never stale.
    const route = await stores.routes.get(id);
    return send(res, 200, buildHistoricalDataset(route, await stores.snapshots.listByRoute(id) as CruiseSnapshot[], new Date().toISOString(), locale));
  } else if (sub === 'intelligence' && method === 'GET') {
    const route = await stores.routes.get(id);
    return send(res, 200, analyzeRoute(route, await stores.snapshots.listByRoute(id) as CruiseSnapshot[], locale));
  } else if (sub === 'collect' && method === 'POST') {
    // ?force=1: "collect anyway" for one route; it lifts the weekly limit of far-away cruises, never the daily one.
    const outcome = await collectRun([await stores.routes.get(id)], url.searchParams.get('force') === '1');
    if (!outcome) return send(res, 409, { error: t('A collection is already running') });
    const tooSoon = outcome.skippedDetail[0];
    if (tooSoon?.reason === 'weekly') return send(res, 409, { error: t('This cruise leaves in more than 6 months, so it is collected at most once a week. Last collected {last}; next collection from {next}.', { last: tooSoon.lastDay, next: tooSoon.nextDay }), code: 'ALREADY_COLLECTED_THIS_WEEK', nextCollection: tooSoon.nextDay });
    if (tooSoon) return send(res, 409, { error: t('Already collected today. Prices are collected once per route and day.'), code: 'ALREADY_COLLECTED_TODAY' });
    const [one] = outcome.outcomes;
    return send(res, one!.snapshot ? 201 : 502, { run: outcome.run, snapshot: one!.snapshot, diagnostics: one!.diagnostics });
  }
  return send(res, 405, { error: 'Method not allowed' });
}

export function createApiServer(deps: ApiDeps): Server {
  const authState: AuthState = { limiter: createLoginLimiter(), lastTotpStep: -1 };
  return createServer((req, res) => {
    handle(req, res, { ...deps, authState }).catch((e: unknown) => {
      if (e instanceof ZodError) return send(res, 400, { error: e.issues.map((i) => i.message).join('; '), issues: e.issues });
      if (e instanceof SyntaxError) return send(res, 400, { error: 'Invalid JSON' });
      if (e instanceof RangeError) return send(res, 413, { error: e.message });
      if (e instanceof NotFoundError) return send(res, 404, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Internal error' });
    });
  });
}
