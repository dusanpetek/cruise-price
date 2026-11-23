import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeId } from './jsonFile';
import { resolveDataDir } from './paths';

export const WEEKLY_FORMATS = { json: 'application/json', csv: 'text/csv; charset=utf-8', pdf: 'application/pdf' } as const;
export type WeeklyFormat = keyof typeof WEEKLY_FORMATS;
export const REPORT_KINDS = ['daily', 'weekly', 'monthly'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
const REPORT_FILE = /^(daily|weekly|monthly)-(\d{4}-\d{2}-\d{2})(-deals)?\.(json|csv|pdf)$/;

/**
 * Deal reports: data/reports/<kind>/<kind>-<date>.{json,csv,pdf} and <kind>-<date>-deals.csv, for the kinds daily, weekly and
 * monthly. Writing the same date again replaces that day's report. (The weekly report is the original one: same folder as before.)
 */
export function createWeeklyReportStore(dataDir: string = resolveDataDir()) {
  const dirOf = (kind: ReportKind) => join(dataDir, 'reports', kind);
  const nameOf = (kind: ReportKind, date: string, format: WeeklyFormat, deals = false) => `${kind}-${assertSafeId(date)}${deals ? '-deals' : ''}.${format}`;

  return {
    async write(date: string, files: { json: string; csv: string; pdf?: Buffer; dealsCsv?: string }, kind: ReportKind = 'weekly'): Promise<string[]> {
      await mkdir(dirOf(kind), { recursive: true });
      const written: string[] = [];
      const entries: [string, string | Buffer | undefined][] = [
        [nameOf(kind, date, 'json'), files.json],
        [nameOf(kind, date, 'csv'), files.csv],
        [nameOf(kind, date, 'pdf'), files.pdf],
        [nameOf(kind, date, 'csv', true), files.dealsCsv],
      ];
      for (const [name, data] of entries) {
        if (data === undefined) continue;
        await writeFile(join(dirOf(kind), name), data);
        written.push(name);
      }
      return written;
    },

    /** File names, newest first. Without a kind: the reports of every kind. */
    async list(kind?: ReportKind): Promise<string[]> {
      const kinds = kind ? [kind] : REPORT_KINDS;
      const names = await Promise.all(kinds.map(async (k) => {
        try {
          return (await readdir(dirOf(k))).filter((f) => REPORT_FILE.test(f) && f.startsWith(`${k}-`));
        } catch {
          return [];
        }
      }));
      // newest date first; within a date: .json, .csv, -deals.csv
      const date = (f: string) => f.slice(f.indexOf('-') + 1);
      return names.flat().sort((a, b) => (date(a) < date(b) ? 1 : date(a) > date(b) ? -1 : a < b ? 1 : -1));
    },

    /** Returns null for unknown or unsafe names. */
    async read(file: string): Promise<{ data: Buffer; contentType: string } | null> {
      const m = file.match(REPORT_FILE);
      if (!m) return null;
      const kind = m[1] as ReportKind;
      try {
        return { data: await readFile(join(dirOf(kind), nameOf(kind, m[2]!, m[4] as WeeklyFormat, !!m[3]))), contentType: WEEKLY_FORMATS[m[4] as WeeklyFormat] };
      } catch {
        return null;
      }
    },
  };
}
export type WeeklyReportStore = ReturnType<typeof createWeeklyReportStore>;
