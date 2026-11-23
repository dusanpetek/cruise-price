import { ALERT_TYPE_LABELS, type NotificationPayload } from '@cruise/domain';
import { createT, type Locale } from '@cruise/i18n';

export const subjectOf = (p: NotificationPayload, locale: Locale = 'en') => {
  const t = createT(locale);
  return `${t(ALERT_TYPE_LABELS[p.alertType])}: ${p.route} (${t(p.category.split(' · ')[0]!)}${p.category.includes(' · ') ? ` · ${p.category.split(' · ').slice(1).join(' · ')}` : ''})`;
};

/** Cruise, flight and total together; just the compared price when an older payload has no breakdown. */
export const priceLine = (p: NotificationPayload, locale: Locale = 'en'): string => {
  const t = createT(locale);
  return p.totalPrice !== null && p.cruisePrice !== null && p.flightPrice !== null
    ? t('Total: {total} € (cruise {cruise} € + flight {flight} €)', { total: Math.round(p.totalPrice), cruise: Math.round(p.cruisePrice), flight: Math.round(p.flightPrice) })
    : t('Current price: {price} €', { price: Math.round(p.currentPrice) });
};

export function textOf(p: NotificationPayload, locale: Locale = 'en'): string {
  return [subjectOf(p, locale), p.message, priceLine(p, locale), p.url].join('\n');
}
