import { z } from 'zod';
import { PROVIDER_IDS } from './Provider';

export const RUN_TRIGGERS = ['manual', 'scheduled', 'cli'] as const;

export const CollectionResultSchema = z.object({
  routeId: z.string(),
  routeName: z.string(),
  provider: z.enum(PROVIDER_IDS).nullable(),
  status: z.enum(['success', 'failed']),
  durationMs: z.number().nonnegative(),
  snapshotId: z.string().nullable(),
  error: z.string().nullable(),
  /** Id of the failure diagnostics package (screenshot / html / log), when one was captured. */
  failureId: z.string().nullable(),
});
export type CollectionResult = z.infer<typeof CollectionResultSchema>;

export const CollectionRunSchema = z.object({
  id: z.string().min(1),
  trigger: z.enum(RUN_TRIGGERS),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  results: z.array(CollectionResultSchema),
});
export type CollectionRun = z.infer<typeof CollectionRunSchema>;

export const ProviderStatsSchema = z.object({
  collections: z.number().int(),
  successes: z.number().int(),
  failures: z.number().int(),
  averageDurationMs: z.number(),
});
export type ProviderStats = z.infer<typeof ProviderStatsSchema>;

export const DailyReportSchema = z.object({
  date: z.string(),
  generatedAt: z.string().datetime(),
  runs: z.number().int(),
  collections: z.number().int(),
  successes: z.number().int(),
  failures: z.number().int(),
  /** 0..1; 1 when there were no collections. */
  successRate: z.number(),
  averageDurationMs: z.number(),
  providers: z.record(z.string(), ProviderStatsSchema),
});
export type DailyReport = z.infer<typeof DailyReportSchema>;
