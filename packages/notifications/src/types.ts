import type { NotificationPayload } from '@cruise/domain';

export const CHANNEL_IDS = ['email', 'teams', 'telegram', 'pushover'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export interface NotificationChannel {
  readonly id: ChannelId;
  readonly label: string;
  /** Throws on failure. Throw a `ChannelError` to say whether a retry makes sense. */
  send(payload: NotificationPayload): Promise<void>;
}

/** `retryable` is true for network errors, 5xx and 429; false for rejections that will not change (bad token, bad request). */
export class ChannelError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'ChannelError';
  }
}

export type FetchFn = typeof fetch;
