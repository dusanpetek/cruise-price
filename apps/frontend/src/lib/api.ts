import type { CopilotAnswer, Portfolio, ReportKind, RouteIntelligence } from '@cruise/analytics';
import {
  AlertRuleSchema,
  AlertSchema,
  CollectionRunSchema,
  CruiseSnapshotSchema,
  DailyReportSchema,
  RouteSchema,
  parseSnapshot,
  type Alert,
  type AlertRule,
  type AlertRuleInput,
  type CollectionRun,
  type CruiseSnapshot,
  type DailyReport,
  type Route,
  type Favorite,
  type Itinerary,
  type ProviderId,
  type RouteSearchOutcome,
  type RouteInput,
} from '@cruise/domain';
import { z } from 'zod';
import { currentLocale, t } from './i18n';

/** An answer of the API that said no: the message for the user, the HTTP status and the machine-readable code (if any). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Fired when the API says the session is over (signed out elsewhere, expired); the sign-in gate then asks again. */
export const UNAUTHENTICATED_EVENT = 'cruise:unauthenticated';

export interface Session {
  /** False when the server runs without sign-in (local development). */
  authRequired: boolean;
  authenticated: boolean;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && (body as { code?: string } | null)?.code === 'UNAUTHENTICATED') window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    const failed = (body as { diagnostics?: { error?: string } } | null)?.diagnostics?.error;
    throw new ApiError((body as { error?: string } | null)?.error ?? failed ?? t('Request failed ({status})', { status: res.status }), res.status, (body as { code?: string } | null)?.code ?? null);
  }
  return body;
}

export const weeklyReportUrl = (file: string) => `/api/reports/weekly/${file}`;
export const dealReportUrl = (file: string) => `/api/reports/deals/${file}`;
export const failureUrl = (kind: 'screenshots' | 'html' | 'logs', id: string) => `/api/failures/${kind}/${id}`;

export interface ChannelStatus {
  id: string;
  label: string;
  configured: boolean;
  enabled: boolean;
}

export interface AlertQuery {
  provider?: string;
  type?: string;
  since?: string;
}

export const api = {
  session: async (): Promise<Session> => (await request('/auth/session')) as Session,
  login: async (input: { username: string; password: string; code?: string }): Promise<void> =>
    void (await request(`/auth/login?lang=${currentLocale()}`, { method: 'POST', body: JSON.stringify(input) })),
  logout: async (): Promise<void> => void (await request('/auth/logout', { method: 'POST' })),
  intelligence: async (): Promise<Portfolio> => (await request(`/intelligence?lang=${currentLocale()}`)) as Portfolio,
  routeIntelligence: async (id: string): Promise<RouteIntelligence> => (await request(`/routes/${id}/intelligence?lang=${currentLocale()}`)) as RouteIntelligence,
  getItinerary: async (id: string): Promise<Itinerary | null> => (await request(`/routes/${id}/itinerary`)) as Itinerary | null,
  listAlerts: async (q: AlertQuery = {}): Promise<Alert[]> => {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return z.array(AlertSchema).parse(await request(`/alerts${params.size ? `?${params}` : ''}`));
  },
  acknowledgeAlert: async (id: string): Promise<Alert> => AlertSchema.parse(await request(`/alerts/${id}/acknowledge`, { method: 'POST' })),
  listRules: async (): Promise<AlertRule[]> => z.array(AlertRuleSchema).parse(await request('/alert-rules')),
  createRule: async (input: AlertRuleInput): Promise<AlertRule> => AlertRuleSchema.parse(await request('/alert-rules', { method: 'POST', body: JSON.stringify(input) })),
  deleteRule: async (id: string): Promise<void> => void (await request(`/alert-rules/${id}`, { method: 'DELETE' })),
  channels: async (): Promise<ChannelStatus[]> => (await request('/notifications')) as ChannelStatus[],
  testChannel: async (channel: string): Promise<void> => void (await request('/notifications/test', { method: 'POST', body: JSON.stringify({ channel }) })),
  weeklyReports: async (): Promise<string[]> => z.array(z.string()).parse(await request('/reports/weekly')),
  generateWeeklyReport: async (): Promise<{ date: string; files: string[]; pdfError: string | null }> =>
    (await request(`/reports/weekly?lang=${currentLocale()}`, { method: 'POST' })) as { date: string; files: string[]; pdfError: string | null },

  listRoutes: async (): Promise<Route[]> => z.array(RouteSchema).parse(await request('/routes')),
  createRoute: async (input: RouteInput): Promise<Route> =>
    RouteSchema.parse(await request('/routes', { method: 'POST', body: JSON.stringify(input) })),
  updateRoute: async (id: string, input: RouteInput): Promise<Route> =>
    RouteSchema.parse(await request(`/routes/${id}`, { method: 'PUT', body: JSON.stringify(input) })),
  searchRoutes: async (params: { provider: ProviderId; query: string; from: string; to: string; refresh?: boolean }): Promise<RouteSearchOutcome> => {
    const q = new URLSearchParams({ provider: params.provider, lang: currentLocale() });
    if (params.query.trim()) q.set('query', params.query.trim());
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.refresh) q.set('refresh', '1');
    return (await request(`/route-search?${q}`)) as RouteSearchOutcome;
  },
  askCopilot: async (question: string): Promise<CopilotAnswer> =>
    (await request(`/copilot?lang=${currentLocale()}`, { method: 'POST', body: JSON.stringify({ question }) })) as CopilotAnswer,
  generateDealReport: async (kind: ReportKind): Promise<{ kind: ReportKind; date: string; files: string[]; pdfError: string | null }> =>
    (await request(`/reports/deals?kind=${kind}&lang=${currentLocale()}`, { method: 'POST' })) as { kind: ReportKind; date: string; files: string[]; pdfError: string | null },
  dealReports: async (): Promise<string[]> => z.array(z.string()).parse(await request('/reports/deals')),
  setFavorite: async (id: string, favorite: Favorite): Promise<Route> =>
    RouteSchema.parse(await request(`/routes/${id}/favorite`, { method: 'PUT', body: JSON.stringify(favorite) })),
  deleteRoute: async (id: string): Promise<void> => void (await request(`/routes/${id}`, { method: 'DELETE' })),
  listSnapshots: async (routeId: string): Promise<CruiseSnapshot[]> =>
    z.array(z.unknown()).parse(await request(`/routes/${routeId}/snapshots`)).map(parseSnapshot),
  addManualSnapshot: async (routeId: string, input: { packagePrice: number; flightSurcharge: number }) =>
    CruiseSnapshotSchema.parse(await request(`/routes/${routeId}/snapshots`, { method: 'POST', body: JSON.stringify(input) })),
  /** `force`: collect anyway although the cruise leaves in more than six months and was collected within the week. */
  collectRoute: async (routeId: string, force = false) => void (await request(`/routes/${routeId}/collect?lang=${currentLocale()}${force ? '&force=1' : ''}`, { method: 'POST' })),
  collectAll: async () => void (await request(`/collect?lang=${currentLocale()}`, { method: 'POST' })),
  listRuns: async (): Promise<CollectionRun[]> => z.array(CollectionRunSchema).parse(await request('/runs?limit=100')),
  dailyReport: async (): Promise<DailyReport | null> => {
    const body = await request('/reports/daily');
    return body ? DailyReportSchema.parse(body) : null;
  },
};
