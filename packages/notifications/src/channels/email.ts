import type { NotificationPayload } from '@cruise/domain';
import type { Locale } from '@cruise/i18n';
import { subjectOf, textOf } from '../format';
import { ChannelError, type NotificationChannel } from '../types';

export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/** SMTP via nodemailer. `createTransport` is injected so the channel can be tested without a mail server. */
export class EmailChannel implements NotificationChannel {
  readonly id = 'email' as const;
  readonly label = 'Email (SMTP)';
  constructor(private readonly transport: MailTransport, private readonly from: string, private readonly to: string, private readonly locale: Locale = 'en') {}

  async send(p: NotificationPayload): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.from, to: this.to, subject: `[Cruise Price Tracker] ${subjectOf(p, this.locale)}`, text: textOf(p, this.locale) });
    } catch (e) {
      // SMTP replies: 4xx are temporary, 5xx permanent. Connection problems have no response code and are retried.
      const code = (e as { responseCode?: number }).responseCode;
      throw new ChannelError(`Email: ${(e as { code?: string }).code ?? (e as Error).name}${code ? ` (${code})` : ''}`, !code || code < 500);
    }
  }
}
