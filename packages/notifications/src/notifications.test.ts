import { describe, expect, it, vi } from 'vitest';
import type { NotificationPayload } from '@cruise/domain';
import {
  ChannelError,
  EmailChannel,
  NotificationRouter,
  PushoverChannel,
  TeamsChannel,
  TelegramChannel,
  buildChannels,
  createRouterFromConfig,
  resolveConfig,
  priceLine,
  subjectOf,
  textOf,
  type NotificationChannel,
} from './index';

const payload: NotificationPayload = {
  route: 'AIDA Nova',
  category: 'Balcony',
  alertType: 'NEW_LOW',
  currentPrice: 2499,
  previousPrice: 2599,
  cruisePrice: 2499,
  flightPrice: 1180,
  totalPrice: 3679,
  message: 'New historical low detected.',
  provider: 'aida',
  url: 'https://aida.de/x',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const ok = () => new Response('ok', { status: 200 });
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...responses];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('formatting', () => {
  it('builds a subject and a text body', () => {
    expect(subjectOf(payload)).toBe('New historical low: AIDA Nova (Balcony)');
    expect(textOf(payload)).toBe('New historical low: AIDA Nova (Balcony)\nNew historical low detected.\nTotal: 3679 € (cruise 2499 € + flight 1180 €)\nhttps://aida.de/x');
    // a payload from before 0.4 has no breakdown: fall back to the one price it has
    expect(priceLine({ ...payload, cruisePrice: null, flightPrice: null, totalPrice: null })).toBe('Current price: 2499 €');
  });
});

describe('channels', () => {
  it('Teams posts an adaptive card to the webhook', async () => {
    const { fn, calls } = fakeFetch(ok());
    await new TeamsChannel('https://example.webhook/abc', fn).send(payload);
    expect(calls[0]!.url).toBe('https://example.webhook/abc');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(JSON.stringify(body)).toContain('New historical low: AIDA Nova (Balcony)');
    expect(JSON.stringify(body)).toContain('Total: 3679 € (cruise 2499 € + flight 1180 €)');
    expect(JSON.stringify(body)).toContain('https://aida.de/x');
  });

  it('Teams copes with an unknown provider', async () => {
    const { fn, calls } = fakeFetch(ok());
    await new TeamsChannel('https://w', fn).send({ ...payload, provider: null });
    expect(calls[0]!.init.body).toContain('n/a');
  });

  it('Telegram calls sendMessage with the chat id', async () => {
    const { fn, calls } = fakeFetch(ok());
    await new TelegramChannel('123:TOKEN', '42', fn).send(payload);
    expect(calls[0]!.url).toBe('https://api.telegram.org/bot123:TOKEN/sendMessage');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ chat_id: '42', text: textOf(payload) });
  });

  it('Pushover posts a form with token, user, title and message', async () => {
    const { fn, calls } = fakeFetch(ok());
    await new PushoverChannel('apptok', 'userkey', fn).send(payload);
    expect(calls[0]!.url).toBe('https://api.pushover.net/1/messages.json');
    const form = new URLSearchParams(calls[0]!.init.body as string);
    expect(form.get('token')).toBe('apptok');
    expect(form.get('user')).toBe('userkey');
    expect(form.get('title')).toBe(subjectOf(payload));
    expect(form.get('message')).toContain('New historical low detected.');
    expect(form.get('message')).toContain('Total: 3679 € (cruise 2499 € + flight 1180 €)');
  });

  it('Email sends through the transport', async () => {
    const sendMail = vi.fn(async () => undefined);
    await new EmailChannel({ sendMail }, 'me@example.com', 'you@example.com').send(payload);
    expect(sendMail).toHaveBeenCalledWith({ from: 'me@example.com', to: 'you@example.com', subject: '[Cruise Price Tracker] New historical low: AIDA Nova (Balcony)', text: textOf(payload) });
  });

  it.each([
    ['server errors', new Response('', { status: 503 }), true],
    ['rate limiting', new Response('', { status: 429 }), true],
    ['a bad token', new Response('', { status: 401 }), false],
    ['a bad request', new Response('', { status: 400 }), false],
  ])('classifies %s', async (_n, response, retryable) => {
    const { fn } = fakeFetch(response);
    const err = await new TelegramChannel('SECRET-TOKEN', '1', fn).send(payload).catch((e: ChannelError) => e);
    expect(err).toBeInstanceOf(ChannelError);
    expect((err as ChannelError).retryable).toBe(retryable);
    expect((err as ChannelError).message).toMatch(/Telegram: HTTP \d+/);
    expect((err as ChannelError).message).not.toContain('SECRET-TOKEN'); // secrets never end up in errors
  });

  it('treats a network failure as retryable without leaking the URL', async () => {
    const { fn } = fakeFetch(new TypeError('fetch failed: https://hooks.example/secret'));
    const err = (await new TeamsChannel('https://hooks.example/secret', fn).send(payload).catch((e: ChannelError) => e)) as ChannelError;
    expect(err.retryable).toBe(true);
    expect(err.message).not.toContain('secret');
  });

  it('classifies SMTP errors by response code', async () => {
    const fail = (e: object) => new EmailChannel({ sendMail: async () => Promise.reject(Object.assign(new Error('x'), e)) }, 'a', 'b').send(payload).catch((x: ChannelError) => x);
    expect(((await fail({ code: 'ECONNREFUSED' })) as ChannelError).retryable).toBe(true);
    expect(((await fail({ responseCode: 451 })) as ChannelError).retryable).toBe(true);
    const permanent = (await fail({ responseCode: 535, code: 'EAUTH' })) as ChannelError;
    expect(permanent.retryable).toBe(false);
    expect(permanent.message).toBe('Email: EAUTH (535)');
  });
});

describe('configuration', () => {
  it('switches every channel off until it is complete', () => {
    const { channels, statuses } = buildChannels(resolveConfig({ teams: { webhookUrl: 'https://w' }, telegram: { botToken: 't' } }, {}));
    expect(channels.map((c) => c.id)).toEqual(['teams']);
    expect(statuses).toEqual([
      { id: 'email', label: 'Email (SMTP)', configured: false, enabled: false },
      { id: 'teams', label: 'Microsoft Teams', configured: true, enabled: true },
      { id: 'telegram', label: 'Telegram', configured: false, enabled: false },
      { id: 'pushover', label: 'Pushover', configured: false, enabled: false },
    ]);
  });

  it('lets environment variables supply and override credentials', () => {
    const env = { SMTP_URL: 'smtp://u:p@h', SMTP_FROM: 'a@x', SMTP_TO: 'b@x', TEAMS_WEBHOOK_URL: 'https://env', TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '9', PUSHOVER_TOKEN: 'pt', PUSHOVER_USER: 'pu' };
    const created: string[] = [];
    const { channels } = buildChannels(resolveConfig({ teams: { webhookUrl: 'https://file' } }, env), { createMailTransport: (url) => (created.push(url), { sendMail: async () => undefined }) });
    expect(channels.map((c) => c.id)).toEqual(['email', 'teams', 'telegram', 'pushover']);
    expect(created).toEqual(['smtp://u:p@h']);
    expect(resolveConfig({ teams: { webhookUrl: 'https://file' } }, env).teams!.webhookUrl).toBe('https://env');
  });

  it('can switch a configured channel off', () => {
    const { channels, statuses } = buildChannels(resolveConfig({ teams: { webhookUrl: 'https://w', enabled: false } }, {}));
    expect(channels).toEqual([]);
    expect(statuses.find((s) => s.id === 'teams')).toMatchObject({ configured: true, enabled: false });
  });

  it('never exposes credentials in the status list', () => {
    const { statuses } = buildChannels(resolveConfig({ telegram: { botToken: 'TOP-SECRET', chatId: '1' } }, {}));
    expect(JSON.stringify(statuses)).not.toContain('TOP-SECRET');
  });

  it('rejects a malformed settings file', () => {
    expect(() => resolveConfig({ teams: { webhookUrl: 5 } }, {})).toThrow();
    expect(resolveConfig(null, {}).teams).toEqual({});
  });
});

describe('NotificationRouter', () => {
  const channel = (id: NotificationChannel['id'], send: NotificationChannel['send']): NotificationChannel => ({ id, label: id, send });
  const sleeps: number[] = [];
  const sleep = async (ms: number) => void sleeps.push(ms);
  const router = (channels: NotificationChannel[], attempts = 3) => new NotificationRouter(channels, undefined, { attempts, baseDelayMs: 100 }, sleep);

  it('sends to every channel', async () => {
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    const deliveries = await router([channel('email', a), channel('teams', b)]).dispatch(payload);
    expect(deliveries).toEqual([
      { channel: 'email', status: 'sent', attempts: 1, error: null },
      { channel: 'teams', status: 'sent', attempts: 1, error: null },
    ]);
    expect(a).toHaveBeenCalledWith(payload);
    expect(b).toHaveBeenCalledWith(payload);
  });

  it('retries transient failures with exponential backoff, then succeeds', async () => {
    sleeps.length = 0;
    let n = 0;
    const flaky = channel('telegram', async () => {
      if (++n < 3) throw new ChannelError('Telegram: HTTP 503', true);
    });
    expect(await router([flaky]).dispatch(payload)).toEqual([{ channel: 'telegram', status: 'sent', attempts: 3, error: null }]);
    expect(sleeps).toEqual([100, 200]);
  });

  it('gives up after the configured attempts and records the error', async () => {
    sleeps.length = 0;
    const down = channel('pushover', async () => Promise.reject(new ChannelError('Pushover: HTTP 500', true)));
    expect(await router([down], 4).dispatch(payload)).toEqual([{ channel: 'pushover', status: 'failed', attempts: 4, error: 'Pushover: HTTP 500' }]);
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it('does not retry errors that cannot heal', async () => {
    sleeps.length = 0;
    const bad = vi.fn(async () => Promise.reject(new ChannelError('Telegram: HTTP 401', false)));
    expect(await router([channel('telegram', bad)]).dispatch(payload)).toEqual([{ channel: 'telegram', status: 'failed', attempts: 1, error: 'Telegram: HTTP 401' }]);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('retries unexpected errors, and a failing channel does not block the others', async () => {
    sleeps.length = 0;
    const boom = vi.fn(async () => Promise.reject(new Error('weird')));
    const fine = vi.fn(async () => undefined);
    const deliveries = await router([channel('email', boom), channel('teams', fine)], 2).dispatch(payload);
    expect(boom).toHaveBeenCalledTimes(2);
    expect(deliveries.map((d) => [d.channel, d.status])).toEqual([['email', 'failed'], ['teams', 'sent']]);
  });

  it('does nothing without channels', async () => {
    expect(await router([]).dispatch(payload)).toEqual([]);
    expect(router([]).enabledChannels).toEqual([]);
  });

  it('sends a test to one channel only', async () => {
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    const r = router([channel('email', a), channel('teams', b)]);
    expect(await r.sendTest('teams', payload)).toMatchObject({ channel: 'teams', status: 'sent' });
    expect(a).not.toHaveBeenCalled();
    expect(await r.sendTest('telegram', payload)).toBeNull();
    expect(r.enabledChannels).toEqual(['email', 'teams']);
  });

  it('uses the default backoff when no sleep is given', async () => {
    const quick = new NotificationRouter([channel('email', async () => Promise.reject(new ChannelError('x', false)))], undefined, { attempts: 1, baseDelayMs: 0 });
    expect((await quick.dispatch(payload))[0]!.status).toBe('failed');
  });
});

describe('createRouterFromConfig', () => {
  it('builds the router from the settings, applying the retry policy', async () => {
    const { fn, calls } = fakeFetch(new Response('', { status: 503 }), ok());
    const sleeps: number[] = [];
    const r = await createRouterFromConfig(async () => ({ teams: { webhookUrl: 'https://w' }, retry: { attempts: 2, baseDelayMs: 7 } }), { env: {}, fetchFn: fn, sleep: async (ms) => void sleeps.push(ms) });
    expect(r.statuses.find((s) => s.id === 'teams')!.enabled).toBe(true);
    expect(await r.dispatch(payload)).toEqual([{ channel: 'teams', status: 'sent', attempts: 2, error: null }]);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([7]);
  });

  it('is an empty router without any settings', async () => {
    const r = await createRouterFromConfig(async () => null, { env: {} });
    expect(r.enabledChannels).toEqual([]);
    expect(r.statuses).toHaveLength(4);
  });
});
