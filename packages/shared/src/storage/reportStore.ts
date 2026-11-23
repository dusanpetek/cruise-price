import { join } from 'node:path';
import { DailyReportSchema, type DailyReport } from '@cruise/domain';
import { readJson, writeJsonAtomic } from './jsonFile';
import { resolveDataDir } from './paths';

/** data/reports/daily-report.json is always the latest report; daily-<date>.json keeps each day. */
export function createReportStore(dataDir: string = resolveDataDir()) {
  const dir = join(dataDir, 'reports');
  return {
    async writeDaily(report: DailyReport): Promise<void> {
      const valid = DailyReportSchema.parse(report);
      await writeJsonAtomic(join(dir, `daily-${valid.date}.json`), valid);
      await writeJsonAtomic(join(dir, 'daily-report.json'), valid);
    },

    async readDaily(): Promise<DailyReport | null> {
      try {
        return DailyReportSchema.parse(await readJson(join(dir, 'daily-report.json')));
      } catch {
        return null;
      }
    },
  };
}
export type ReportStore = ReturnType<typeof createReportStore>;
