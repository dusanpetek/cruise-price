import type { NotificationPayload } from '@cruise/domain';
import { createT, type Locale } from '@cruise/i18n';
import { post } from '../http';
import { priceLine, subjectOf } from '../format';
import type { FetchFn, NotificationChannel } from '../types';

/** Posts an Adaptive Card to a Teams (Workflows) webhook. */
export class TeamsChannel implements NotificationChannel {
  readonly id = 'teams' as const;
  readonly label = 'Microsoft Teams';
  constructor(private readonly webhookUrl: string, private readonly fetchFn: FetchFn = fetch, private readonly locale: Locale = 'en') {}

  send(p: NotificationPayload): Promise<void> {
    const card = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: subjectOf(p, this.locale), weight: 'Bolder', size: 'Medium', wrap: true },
              { type: 'TextBlock', text: p.message, wrap: true },
              { type: 'FactSet', facts: [{ title: createT(this.locale)('Trip price'), value: priceLine(p, this.locale) }, { title: createT(this.locale)('Provider'), value: p.provider ?? 'n/a' }] },
            ],
            actions: [{ type: 'Action.OpenUrl', title: createT(this.locale)('Open route'), url: p.url }],
          },
        },
      ],
    };
    return post(this.fetchFn, this.webhookUrl, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(card) }, 'Teams');
  }
}
