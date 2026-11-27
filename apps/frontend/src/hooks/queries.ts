import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlertRuleInput, Favorite, RouteInput } from '@cruise/domain';
import { api, type AlertQuery } from '@/lib/api';
import { useUi } from '@/store/ui';

export const useRoutes = () => useQuery({ queryKey: ['routes'], queryFn: api.listRoutes });

/** Polls so snapshots written by the background scheduler show up without a reload. */
export const useSnapshots = (routeId: string | undefined) =>
  useQuery({
    queryKey: ['snapshots', routeId],
    queryFn: () => api.listSnapshots(routeId!),
    enabled: !!routeId,
    refetchInterval: 15_000,
  });

export const useRuns = () => useQuery({ queryKey: ['runs'], queryFn: api.listRuns, refetchInterval: 15_000 });
export const useDailyReport = () => useQuery({ queryKey: ['report'], queryFn: api.dailyReport, refetchInterval: 15_000 });

export function useRouteMutations() {
  const qc = useQueryClient();
  const refreshRoutes = () => qc.invalidateQueries({ queryKey: ['routes'] });
  return {
    create: useMutation({ mutationFn: (input: RouteInput) => api.createRoute(input), onSuccess: refreshRoutes }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: RouteInput }) => api.updateRoute(id, input),
      onSuccess: refreshRoutes,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteRoute(id), onSuccess: refreshRoutes }),
    favorite: useMutation({ mutationFn: ({ id, favorite }: { id: string; favorite: Favorite }) => api.setFavorite(id, favorite),
      onSuccess: () => Promise.all([refreshRoutes(), qc.invalidateQueries({ queryKey: ['intelligence'] }), qc.invalidateQueries({ queryKey: ['route-intelligence'] })]),
    }),
  };
}

/** A collection changes snapshots, runs and the daily report, so refresh all of them (even after a failed run). */
function useRefreshCollection() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['snapshots'] }),
      qc.invalidateQueries({ queryKey: ['runs'] }),
      qc.invalidateQueries({ queryKey: ['report'] }),
      qc.invalidateQueries({ queryKey: ['intelligence'] }),
      qc.invalidateQueries({ queryKey: ['route-intelligence'] }),
      qc.invalidateQueries({ queryKey: ['alerts'] }),
    ]);
}

export function useSnapshotMutations(routeId: string) {
  const refresh = useRefreshCollection();
  return {
    collect: useMutation({ mutationFn: (force?: boolean) => api.collectRoute(routeId, force === true), onSettled: refresh }),
    addManual: useMutation({
      mutationFn: (v: { packagePrice: number; flightSurcharge: number }) => api.addManualSnapshot(routeId, v),
      onSuccess: refresh,
    }),
  };
}

export function useCollectAll() {
  const refresh = useRefreshCollection();
  return useMutation({ mutationFn: api.collectAll, onSettled: refresh });
}

/** Portfolio-wide analysis; refreshed after every collection and by polling, so the dashboard follows the scheduler. */
export const useIntelligence = () => {
  const language = useUi((u) => u.language);
  return useQuery({ queryKey: ['intelligence', language], queryFn: api.intelligence, refetchInterval: 15_000 });
};

export const useItinerary = (routeId: string | undefined) =>
  useQuery({ queryKey: ['itinerary', routeId], queryFn: () => api.getItinerary(routeId!), enabled: !!routeId });

export const useRouteIntelligence = (id: string | undefined) => {
  const language = useUi((u) => u.language);
  return useQuery({ queryKey: ['route-intelligence', id, language], queryFn: () => api.routeIntelligence(id!), enabled: !!id, refetchInterval: 15_000 });
};

export const useAlerts = (q: AlertQuery = {}) => useQuery({ queryKey: ['alerts', q], queryFn: () => api.listAlerts(q), refetchInterval: 15_000 });

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.acknowledgeAlert, onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }) });
}

export const useAlertRules = () => useQuery({ queryKey: ['alert-rules'], queryFn: api.listRules });

export function useRuleMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['alert-rules'] });
  return {
    create: useMutation({ mutationFn: (input: AlertRuleInput) => api.createRule(input), onSuccess: refresh }),
    remove: useMutation({ mutationFn: api.deleteRule, onSuccess: refresh }),
  };
}

export const useChannels = () => useQuery({ queryKey: ['channels'], queryFn: api.channels });
export const useTestChannel = () => useMutation({ mutationFn: api.testChannel });

export const useWeeklyReports = () => useQuery({ queryKey: ['weekly-reports'], queryFn: api.weeklyReports });

export function useGenerateWeeklyReport() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.generateWeeklyReport, onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-reports'] }) });
}

/** Deal reports (daily, weekly, monthly): the list and the generator. */
export const useDealReports = () => useQuery({ queryKey: ['deal-reports'], queryFn: api.dealReports });

export function useGenerateDealReport() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.generateDealReport, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['deal-reports'] }), qc.invalidateQueries({ queryKey: ['weekly-reports'] })]) });
}

export const useRouteSearch = () => useMutation({ mutationFn: api.searchRoutes });

export const useAskCopilot = () => useMutation({ mutationFn: api.askCopilot });

/** Whether the server wants a sign-in and whether this browser has one. Not retried: a failure means the server is unreachable. */
export const useSession = () => useQuery({ queryKey: ['session'], queryFn: api.session, retry: false });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.login, onSuccess: () => qc.invalidateQueries({ queryKey: ['session'] }) });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      // Nothing of the signed-in session stays in memory.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      qc.setQueryData(['session'], { authRequired: true, authenticated: false });
    },
  });
}
