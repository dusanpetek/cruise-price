import { describe, expect, it } from 'vitest';
import { AlertRuleInputSchema, AlertRuleSchema, AlertSchema, CABIN_GROUPS, cabinGroupOf } from './index';

describe('cabinGroupOf', () => {
  it.each([
    ['Innenkabine', 'inside'],
    ['Meerblickkabine', 'ocean-view'],
    ['Außenkabine', 'ocean-view'],
    ['Balkonkabine', 'balcony'],
    ['SPA Balkonkabine', 'balcony'],
    ['Verandakabine Komfort', 'balcony'],
    ['Verandakabine Deluxe', 'balcony'],
    ['Junior-Suite', 'junior-suite'],
    ['Junior Suite Balkon', 'junior-suite'], // junior wins over balcony
    ['Suite', 'suite'],
    ['Fernweh Suite', 'suite'],
    ['Schöne Aussicht Suite', 'suite'],
    ['Große Freiheit Suite', 'suite'],
    ['Inside', 'inside'],
    ['Ocean View', 'ocean-view'],
    ['Penthouse', null],
  ])('%s -> %s', (name, group) => {
    expect(cabinGroupOf(name)).toBe(group);
  });

  it('knows the five supported groups', () => {
    expect(CABIN_GROUPS).toEqual(['inside', 'ocean-view', 'balcony', 'junior-suite', 'suite']);
  });
});

describe('alert rules', () => {
  it('fills defaults for a bare new-low rule', () => {
    expect(AlertRuleInputSchema.parse({ type: 'NEW_LOW' })).toEqual({ type: 'NEW_LOW', routeId: null, cabin: null, fare: null, percent: null, targetPrice: null, enabled: true });
  });

  it.each([5, 10, 15, 20])('accepts a %d%% drop threshold', (percent) => {
    expect(AlertRuleInputSchema.safeParse({ type: 'PERCENT_DROP', percent }).success).toBe(true);
  });

  it.each([[null], [7], [25], [0]])('rejects the drop threshold %s', (percent) => {
    expect(AlertRuleInputSchema.safeParse({ type: 'PERCENT_DROP', percent }).success).toBe(false);
  });

  it('requires a positive target price for target rules, optionally per cabin group', () => {
    expect(AlertRuleInputSchema.safeParse({ type: 'TARGET_PRICE' }).success).toBe(false);
    expect(AlertRuleInputSchema.safeParse({ type: 'TARGET_PRICE', targetPrice: -5 }).success).toBe(false);
    expect(AlertRuleInputSchema.parse({ type: 'TARGET_PRICE', targetPrice: 2499, cabin: 'balcony' })).toMatchObject({ cabin: 'balcony', targetPrice: 2499 });
    expect(AlertRuleInputSchema.safeParse({ type: 'NEW_LOW', cabin: 'penthouse' }).success).toBe(false);
  });

  it('accepts a fare on a rule, and still loads rules stored before fares existed', () => {
    expect(AlertRuleInputSchema.parse({ type: 'NEW_LOW', cabin: 'balcony', fare: 'PREMIUM_ALL_IN' })).toMatchObject({ cabin: 'balcony', fare: 'PREMIUM_ALL_IN' });
    expect(AlertRuleInputSchema.safeParse({ type: 'NEW_LOW', fare: '' }).success).toBe(false);
    const stored = { id: 'r', createdAt: '2026-01-01T00:00:00.000Z', routeId: null, type: 'NEW_LOW', cabin: null, percent: null, targetPrice: null, enabled: true };
    expect(AlertRuleSchema.parse(stored).fare).toBeNull();
  });

  it('validates stored rules and alerts', () => {
    expect(AlertRuleSchema.safeParse({ id: 'r', createdAt: '2026-01-01T00:00:00.000Z', routeId: null, type: 'PERCENT_DROP', cabin: null, percent: 10, targetPrice: null, enabled: true }).success).toBe(true);
    const alert = { id: 'a', createdAt: '2026-01-01T00:00:00.000Z', ruleId: null, routeId: 'r', routeName: 'R', provider: 'aida', type: 'NEW_LOW', category: 'Balcony', currentPrice: 2399, referencePrice: 2499, message: 'm', snapshotId: 's', status: 'new', deliveries: [{ channel: 'email', status: 'sent', attempts: 1, error: null }] };
    expect(AlertSchema.safeParse(alert).success).toBe(true);
    expect(AlertSchema.safeParse({ ...alert, status: 'read' }).success).toBe(false);
    expect(AlertSchema.safeParse({ ...alert, deliveries: [{ channel: 'email', status: 'sent', attempts: 0, error: null }] }).success).toBe(false);
  });
});
