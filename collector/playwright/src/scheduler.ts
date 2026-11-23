import cron from 'node-cron';
import { serverLocale } from '@cruise/i18n';
import { CollectorLockedError, type Stores } from '@cruise/shared/storage';
import { collectRoutes, type BatchDeps, type BatchOutcome } from './collection/batch';
import type { ReportKind } from '@cruise/analytics';
import { generateDealReport } from './reports/weekly';

/** Once a day (07:00); a route is collected at most once per day anyway. */
export const DEFAULT_CRON = '0 7 * * *';
const POLITE_DELAY_MS = 5000;

/** Collects every configured route once. Returns null (and does nothing) if another collection holds the lock. */
export async function collectAll(
  stores: Stores,
  trigger: 'scheduled' | 'cli' | 'manual',
  options: Pick<BatchDeps, 'registry' | 'browserFactory' | 'config' | 'afterSnapshot'> & { delayBetweenMs?: number; log?: (line: string) => void } = {},
): Promise<BatchOutcome | null> {
  const { delayBetweenMs = POLITE_DELAY_MS, log, ...deps } = options;
  try {
    return await collectRoutes(await stores.routes.list(), { stores, ...deps }, { trigger, delayBetweenMs, ...(log ? { log } : {}) });
  } catch (e) {
    if (e instanceof CollectorLockedError) return null;
    throw e;
  }
}

export function scheduleCollections(stores: Stores, expression: string = DEFAULT_CRON, log: (line: string) => void = console.log) {
  if (!cron.validate(expression)) throw new Error(`Invalid cron expression: ${expression}`);
  return cron.schedule(expression, () => {
    collectAll(stores, 'scheduled', { log: (l) => log(`[collect] ${l}`) }).then(
      (outcome) => log(outcome ? `[collect] run ${outcome.run.id} finished` : '[collect] skipped: another collection is running'),
      (e) => console.error('[collect] run failed', e),
    );
  });
}

export const DEFAULT_WEEKLY_CRON = '0 8 * * 1'; // Mondays 08:00
export const DEFAULT_DAILY_REPORT_CRON = '30 7 * * *'; // every day 07:30, after the collection
export const DEFAULT_MONTHLY_REPORT_CRON = '0 9 1 * *'; // the 1st of every month 09:00

export const DEFAULT_REPORT_CRON: Record<ReportKind, string> = { daily: DEFAULT_DAILY_REPORT_CRON, weekly: DEFAULT_WEEKLY_CRON, monthly: DEFAULT_MONTHLY_REPORT_CRON };

/** Generates the daily, weekly or monthly deal report on a schedule. */
export function scheduleDealReport(stores: Stores, kind: ReportKind, expression: string = DEFAULT_REPORT_CRON[kind], log: (line: string) => void = console.log) {
  if (!cron.validate(expression)) throw new Error(`Invalid cron expression: ${expression}`);
  return cron.schedule(expression, () => {
    generateDealReport(stores, kind, { locale: serverLocale() }).then(
      (r) => log(`[report] ${kind} report ${r.date}: ${r.files.join(', ')}${r.pdfError ? ` (no PDF: ${r.pdfError})` : ''}`),
      (e) => console.error(`[report] ${kind} report failed`, e),
    );
  });
}

/** Generates the weekly report on a schedule. */
export const scheduleWeeklyReport = (stores: Stores, expression: string = DEFAULT_WEEKLY_CRON, log: (line: string) => void = console.log) => scheduleDealReport(stores, 'weekly', expression, log);

/** The three deal reports with their crons (DAILY_REPORT_CRON, WEEKLY_REPORT_CRON, MONTHLY_REPORT_CRON). */
export function scheduleDealReports(stores: Stores, env: Record<string, string | undefined> = process.env, log: (line: string) => void = console.log) {
  const crons: Record<ReportKind, string> = { daily: env.DAILY_REPORT_CRON ?? DEFAULT_DAILY_REPORT_CRON, weekly: env.WEEKLY_REPORT_CRON ?? DEFAULT_WEEKLY_CRON, monthly: env.MONTHLY_REPORT_CRON ?? DEFAULT_MONTHLY_REPORT_CRON };
  for (const kind of ['daily', 'weekly', 'monthly'] as const) scheduleDealReport(stores, kind, crons[kind], log);
  return crons;
}
