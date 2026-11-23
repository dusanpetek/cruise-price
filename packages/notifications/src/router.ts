import type { Delivery, NotificationPayload } from '@cruise/domain';
import { buildChannels, languageOf, resolveConfig, type ChannelDeps, type ChannelStatus } from './config';
import { ChannelError, type ChannelId, type NotificationChannel } from './types';

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
}
export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 1000 };

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Sends one payload to every enabled channel. A failing channel is retried with exponential backoff (only for
 * errors that can heal: network, 5xx, 429) and never prevents the others from receiving it. Never throws.
 */
export class NotificationRouter {
  constructor(
    private readonly channels: readonly NotificationChannel[],
    readonly statuses: readonly ChannelStatus[] = channels.map((c) => ({ id: c.id, label: c.label, configured: true, enabled: true })),
    private readonly retry: RetryPolicy = DEFAULT_RETRY,
    private readonly sleep: (ms: number) => Promise<void> = sleepReal,
  ) {}

  get enabledChannels(): ChannelId[] {
    return this.channels.map((c) => c.id);
  }

  private async deliver(channel: NotificationChannel, payload: NotificationPayload): Promise<Delivery> {
    let attempts = 0;
    for (;;) {
      attempts++;
      try {
        await channel.send(payload);
        return { channel: channel.id, status: 'sent', attempts, error: null };
      } catch (e) {
        const retryable = !(e instanceof ChannelError) || e.retryable;
        if (!retryable || attempts >= this.retry.attempts) {
          return { channel: channel.id, status: 'failed', attempts, error: (e as Error).message };
        }
        await this.sleep(this.retry.baseDelayMs * 2 ** (attempts - 1));
      }
    }
  }

  async dispatch(payload: NotificationPayload): Promise<Delivery[]> {
    return Promise.all(this.channels.map((c) => this.deliver(c, payload)));
  }

  /** Sends to one channel only (the "send test" button). */
  async sendTest(id: ChannelId, payload: NotificationPayload): Promise<Delivery | null> {
    const channel = this.channels.find((c) => c.id === id);
    return channel ? this.deliver(channel, payload) : null;
  }
}

/** Router for the current contents of data/notifications.json (plus environment overrides). */
export async function createRouterFromConfig(
  readFile: () => Promise<unknown | null>,
  deps: ChannelDeps & { env?: NodeJS.ProcessEnv; sleep?: (ms: number) => Promise<void> } = {},
): Promise<NotificationRouter> {
  const config = resolveConfig(await readFile(), deps.env);
  const { channels, statuses } = buildChannels(config, { ...deps, locale: languageOf(config, deps.env) });
  return new NotificationRouter(channels, statuses, { ...DEFAULT_RETRY, ...config.retry }, deps.sleep);
}
