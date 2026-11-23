import { createTransport } from 'nodemailer';
import { isLocale, serverLocale, type Locale } from '@cruise/i18n';
import { z } from 'zod';
import { EmailChannel, type MailTransport } from './channels/email';
import { PushoverChannel } from './channels/pushover';
import { TelegramChannel } from './channels/telegram';
import { TeamsChannel } from './channels/teams';
import type { ChannelId, FetchFn, NotificationChannel } from './types';

const enabled = z.boolean().default(true);

/** data/notifications.json. Every channel is optional and stays off until it is complete. */
export const NotificationConfigSchema = z.object({
  email: z.object({ enabled, smtpUrl: z.string(), from: z.string(), to: z.string() }).partial().optional(),
  teams: z.object({ enabled, webhookUrl: z.string() }).partial().optional(),
  telegram: z.object({ enabled, botToken: z.string(), chatId: z.string() }).partial().optional(),
  pushover: z.object({ enabled, appToken: z.string(), userKey: z.string() }).partial().optional(),
  language: z.enum(['de', 'en']).optional(),
  retry: z.object({ attempts: z.number().int().min(1).max(10), baseDelayMs: z.number().int().min(0) }).partial().optional(),
});
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

/** Environment variables override the file, so secrets can stay out of it. */
export function resolveConfig(file: unknown, env: NodeJS.ProcessEnv = process.env): NotificationConfig {
  const cfg = NotificationConfigSchema.parse(file ?? {});
  const pick = <T extends object>(base: T | undefined, overrides: Record<string, string | undefined>) => ({
    ...base,
    ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v)),
  });
  return {
    ...cfg,
    email: pick(cfg.email, { smtpUrl: env.SMTP_URL, from: env.SMTP_FROM, to: env.SMTP_TO }),
    teams: pick(cfg.teams, { webhookUrl: env.TEAMS_WEBHOOK_URL }),
    telegram: pick(cfg.telegram, { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }),
    pushover: pick(cfg.pushover, { appToken: env.PUSHOVER_TOKEN, userKey: env.PUSHOVER_USER }),
  };
}

/** Language of the messages: the file's `language`, else CRUISE_LANGUAGE, else German. */
export function languageOf(config: NotificationConfig, env: NodeJS.ProcessEnv = process.env): Locale {
  return isLocale(config.language) ? config.language : serverLocale(env);
}

export interface ChannelStatus {
  id: ChannelId;
  label: string;
  /** All required settings are present. */
  configured: boolean;
  /** configured and not switched off. */
  enabled: boolean;
}

export interface BuiltChannels {
  channels: NotificationChannel[];
  statuses: ChannelStatus[];
}

export interface ChannelDeps {
  fetchFn?: FetchFn;
  createMailTransport?: (smtpUrl: string) => MailTransport;
}

/** Builds the channels that are configured and enabled, and reports the status of all four (never the secrets). */
export function buildChannels(config: NotificationConfig, deps: ChannelDeps & { locale?: Locale } = {}): BuiltChannels {
  const { fetchFn = fetch, createMailTransport = (url: string) => createTransport(url), locale = 'en' } = deps;
  const { email, teams, telegram, pushover } = config;
  const channels: NotificationChannel[] = [];
  const statuses: ChannelStatus[] = [];

  const register = (id: ChannelId, label: string, configured: boolean, isEnabled: boolean | undefined, make: () => NotificationChannel) => {
    const on = configured && isEnabled !== false;
    statuses.push({ id, label, configured, enabled: on });
    if (on) channels.push(make());
  };

  register('email', 'Email (SMTP)', !!(email?.smtpUrl && email.from && email.to), email?.enabled, () => new EmailChannel(createMailTransport(email!.smtpUrl!), email!.from!, email!.to!, locale));
  register('teams', 'Microsoft Teams', !!teams?.webhookUrl, teams?.enabled, () => new TeamsChannel(teams!.webhookUrl!, fetchFn, locale));
  register('telegram', 'Telegram', !!(telegram?.botToken && telegram.chatId), telegram?.enabled, () => new TelegramChannel(telegram!.botToken!, telegram!.chatId!, fetchFn, locale));
  register('pushover', 'Pushover', !!(pushover?.appToken && pushover.userKey), pushover?.enabled, () => new PushoverChannel(pushover!.appToken!, pushover!.userKey!, fetchFn, locale));

  return { channels, statuses };
}
