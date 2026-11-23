import { evaluateAlerts } from '@cruise/analytics';
import type { Alert, CruiseSnapshot, NotificationPayload, Route } from '@cruise/domain';
import { serverLocale } from '@cruise/i18n';
import { createRouterFromConfig, type NotificationRouter } from '@cruise/notifications';
import type { Stores } from '@cruise/shared/storage';

export type AfterSnapshot = (route: Route, snapshot: CruiseSnapshot) => Promise<Alert[]>;

export function toPayload(route: Pick<Route, 'name' | 'url'>, alert: Alert): NotificationPayload {
  return {
    route: route.name,
    category: alert.category,
    alertType: alert.type,
    currentPrice: alert.currentPrice,
    previousPrice: alert.referencePrice,
    cruisePrice: alert.cruisePrice,
    flightPrice: alert.flightPrice,
    totalPrice: alert.totalPrice,
    message: alert.message,
    provider: alert.provider,
    url: route.url,
    createdAt: alert.createdAt,
  };
}

/** The router for the current notification settings; a broken settings file disables notifications instead of failing. */
export async function routerFromStores(stores: Pick<Stores, 'config'>): Promise<NotificationRouter | null> {
  try {
    return await createRouterFromConfig(() => stores.config.readNotifications());
  } catch (e) {
    console.error('[alerts] notifications disabled:', (e as Error).message);
    return null;
  }
}

/**
 * Collection -> analytics -> alert engine -> notification router.
 * Evaluates the alert rules against a route's history right after a new snapshot, stores each alert, and sends it
 * to the configured channels. Snapshots from the mock collector still raise alerts (so the UI can be demoed) but are
 * never sent out. Delivery problems are recorded on the alert and never fail the collection.
 */
export function createAlertPipeline(deps: {
  stores: Pick<Stores, 'snapshots' | 'alerts' | 'alertRules' | 'config'>;
  getRouter?: () => Promise<NotificationRouter | null>;
}): AfterSnapshot {
  const { stores, getRouter = () => routerFromStores(stores) } = deps;
  return async (route, snapshot) => {
    await stores.alertRules.ensureDefaults();
    const [rules, snapshots] = await Promise.all([stores.alertRules.list(), stores.snapshots.listByRoute(route.id)]);
    const candidates = evaluateAlerts({ routeId: route.id, snapshots, rules, locale: serverLocale() });
    if (candidates.length === 0) return [];

    const router = snapshot.source === 'live' ? await getRouter() : null;
    const alerts: Alert[] = [];
    for (const c of candidates) {
      let alert = await stores.alerts.create({
        ruleId: c.ruleId,
        routeId: route.id,
        routeName: route.name,
        provider: route.provider,
        type: c.type,
        category: c.category,
        currentPrice: c.currentPrice,
        referencePrice: c.referencePrice,
        cruisePrice: c.cruisePrice,
        flightPrice: c.flightPrice,
        totalPrice: c.totalPrice,
        message: c.message,
        snapshotId: c.snapshotId,
      });
      if (router && router.enabledChannels.length > 0) {
        alert = await stores.alerts.setDeliveries(alert.id, await router.dispatch(toPayload(route, alert)));
      }
      alerts.push(alert);
    }
    return alerts;
  };
}
