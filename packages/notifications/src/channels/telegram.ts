import type { NotificationPayload } from '@cruise/domain';
import type { Locale } from '@cruise/i18n';
import { textOf } from '../format';
import { post } from '../http';
import type { FetchFn, NotificationChannel } from '../types';

export class TelegramChannel implements NotificationChannel {
  readonly id = 'telegram' as const;
  readonly label = 'Telegram';
  constructor(private readonly botToken: string, private readonly chatId: string, private readonly fetchFn: FetchFn = fetch, private readonly locale: Locale = 'en') {}

  send(p: NotificationPayload): Promise<void> {
    return post(
      this.fetchFn,
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: this.chatId, text: textOf(p, this.locale), disable_web_page_preview: true }) },
      'Telegram',
    );
  }
}
