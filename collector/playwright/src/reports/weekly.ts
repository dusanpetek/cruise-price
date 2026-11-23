import { analyzePortfolio, buildWeeklyReport, weeklyDealsCsv, weeklyReportCsv, type ReportKind, type WeeklyReport } from '@cruise/analytics';
import type { CruiseSnapshot } from '@cruise/domain';
import type { Stores } from '@cruise/shared/storage';
import { type Locale } from '@cruise/i18n';
import { chromiumFactory, type BrowserFactory } from '../browser/browserFactory';
import { weeklyReportHtml } from './weeklyHtml';

/** Renders HTML to a PDF with headless Chromium. */
export async function renderPdf(html: string, factory: BrowserFactory = chromiumFactory): Promise<Buffer> {
  const browser = await factory.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export interface WeeklyResult {
  kind: ReportKind;
  date: string;
  report: WeeklyReport;
  files: string[];
  /** Set when the PDF could not be rendered; JSON and CSV were still written. */
  pdfError: string | null;
}

/** Builds the daily, weekly or monthly deal report from the stored data and writes reports/<kind>/<kind>-<date>.{json,csv,pdf}. */
export async function generateDealReport(
  stores: Pick<Stores, 'routes' | 'snapshots' | 'weeklyReports'>,
  kind: ReportKind,
  options: { now?: Date; pdf?: boolean; browserFactory?: BrowserFactory; locale?: Locale } = {},
): Promise<WeeklyResult> {
  const { now = new Date(), pdf = true, browserFactory, locale = 'en' } = options;
  const routes = await stores.routes.list();
  const snapshots = new Map<string, CruiseSnapshot[]>();
  for (const r of routes) snapshots.set(r.id, await stores.snapshots.listByRoute(r.id));

  const portfolio = analyzePortfolio(routes.map((route) => ({ route, snapshots: snapshots.get(route.id)! })), now.toISOString(), locale);
  const report = buildWeeklyReport(portfolio, snapshots, now, locale, kind);

  let pdfBuffer: Buffer | undefined;
  let pdfError: string | null = null;
  if (pdf) {
    try {
      pdfBuffer = await renderPdf(weeklyReportHtml(report, locale), browserFactory);
    } catch (e) {
      pdfError = (e as Error).message.split('\n')[0] ?? 'PDF rendering failed';
    }
  }

  const date = now.toISOString().slice(0, 10);
  const files = await stores.weeklyReports.write(date, {
    json: JSON.stringify(report, null, 2) + '\n',
    csv: weeklyReportCsv(report),
    dealsCsv: weeklyDealsCsv(report),
    ...(pdfBuffer ? { pdf: pdfBuffer } : {}),
  }, kind);
  return { kind, date, report, files, pdfError };
}

/** The weekly report (the original one). */
export const generateWeeklyReport = (stores: Pick<Stores, 'routes' | 'snapshots' | 'weeklyReports'>, options: Parameters<typeof generateDealReport>[2] = {}): Promise<WeeklyResult> => generateDealReport(stores, 'weekly', options);
