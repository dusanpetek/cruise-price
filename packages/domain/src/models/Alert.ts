import { z } from 'zod';
import { CABIN_GROUPS } from './CabinGroup';
import { PROVIDER_IDS } from './Provider';

export const ALERT_TYPES = ['NEW_LOW', 'PERCENT_DROP', 'TARGET_PRICE'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  NEW_LOW: 'New historical low',
  PERCENT_DROP: 'Percentage drop',
  TARGET_PRICE: 'Target price reached',
};
export const DROP_THRESHOLDS = [5, 10, 15, 20] as const;

const ruleFields = {
  /** null = applies to every route. */
  routeId: z.string().min(1).nullable(),
  type: z.enum(ALERT_TYPES),
  /** null = the headline (cheapest cabin) price. */
  cabin: z.enum(CABIN_GROUPS).nullable(),
  /** Fare code (e.g. PREMIUM_ALL_IN). null = not fare specific. A fare rule compares the TOTAL trip price (cruise + flight). */
  fare: z.string().min(1).nullable().default(null),
  percent: z.number().nullable(),
  targetPrice: z.number().positive().nullable(),
  enabled: z.boolean(),
};

const checkRule = (r: { type: AlertType; percent: number | null; targetPrice: number | null }, ctx: z.RefinementCtx) => {
  if (r.type === 'PERCENT_DROP' && !DROP_THRESHOLDS.some((t) => t === r.percent)) {
    ctx.addIssue({ code: 'custom', path: ['percent'], message: `Threshold must be one of ${DROP_THRESHOLDS.join(', ')}%` });
  }
  if (r.type === 'TARGET_PRICE' && r.targetPrice === null) {
    ctx.addIssue({ code: 'custom', path: ['targetPrice'], message: 'A target price is required' });
  }
};

export const AlertRuleInputSchema = z
  .object({
    ...ruleFields,
    routeId: ruleFields.routeId.default(null),
    cabin: ruleFields.cabin.default(null),
    fare: ruleFields.fare,
    percent: ruleFields.percent.default(null),
    targetPrice: ruleFields.targetPrice.default(null),
    enabled: ruleFields.enabled.default(true),
  })
  .superRefine(checkRule);
export type AlertRuleInput = z.input<typeof AlertRuleInputSchema>;

export const AlertRuleSchema = z
  .object({ id: z.string().min(1), createdAt: z.string().datetime(), ...ruleFields })
  .superRefine(checkRule);
export type AlertRule = z.infer<typeof AlertRuleSchema>;

export const DELIVERY_STATUSES = ['sent', 'failed'] as const;
export const DeliverySchema = z.object({
  channel: z.string(),
  status: z.enum(DELIVERY_STATUSES),
  attempts: z.number().int().min(1),
  error: z.string().nullable(),
});
export type Delivery = z.infer<typeof DeliverySchema>;

export const AlertSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  ruleId: z.string().nullable(),
  routeId: z.string().min(1),
  routeName: z.string(),
  provider: z.enum(PROVIDER_IDS).nullable(),
  type: z.enum(ALERT_TYPES),
  /** Display label of the price series: a cabin group label or "Cheapest cabin". */
  category: z.string(),
  currentPrice: z.number().nonnegative(),
  /** The price the alert compares against (previous low, previous price or target). */
  referencePrice: z.number().nonnegative().nullable(),
  message: z.string(),
  /** The trip price behind the alert: cruise + flight = total. Null on alerts stored before 0.4. */
  cruisePrice: z.number().nonnegative().nullable().default(null),
  flightPrice: z.number().nonnegative().nullable().default(null),
  totalPrice: z.number().nonnegative().nullable().default(null),
  snapshotId: z.string(),
  status: z.enum(['new', 'acknowledged']),
  deliveries: z.array(DeliverySchema),
});
export type Alert = z.infer<typeof AlertSchema>;

/** What a notification channel receives. */
export const NotificationPayloadSchema = z.object({
  route: z.string(),
  category: z.string(),
  alertType: z.enum(ALERT_TYPES),
  currentPrice: z.number(),
  previousPrice: z.number().nullable(),
  cruisePrice: z.number().nullable().default(null),
  flightPrice: z.number().nullable().default(null),
  totalPrice: z.number().nullable().default(null),
  message: z.string(),
  provider: z.string().nullable(),
  url: z.string(),
  createdAt: z.string(),
});
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;
