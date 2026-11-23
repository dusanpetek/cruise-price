import type { NotificationPayload } from '@cruise/domain';
import type { Locale } from '@cruise/i18n';
import { priceLine, subjectOf } from '../format';
import { post } from '../http';
import type { FetchFn, NotificationChannel } from '../types';

export class PushoverChannel implements NotificationChannel {
  readonly id = 'pushover' as const;
  readonly label = 'Pushover';
  constructor(private readonly appToken: string, private readonly userKey: string, private readonly fetchFn: FetchFn = fetch, private readonly locale: Locale = 'en') {}

  send(p: NotificationPayload): Promise<void> {
    const body = new URLSearchParams({ token: this.appToken, user: this.userKey, title: subjectOf(p, this.locale), message: `${p.message}\n${priceLine(p, this.locale)}`, url: p.url });
    return post(this.fetchFn, 'https://api.pushover.net/1/messages.json', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, 'Pushover');
  }
}
