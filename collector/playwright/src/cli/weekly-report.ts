import { isReportKind } from '@cruise/analytics';
import { serverLocale } from '@cruise/i18n';
import { createStores } from '@cruise/shared/storage';
import { generateDealReport } from '../reports/weekly';

// pnpm report:weekly [daily|weekly|monthly]
const kind = process.argv[2] ?? 'weekly';
if (!isReportKind(kind)) {
  console.error('Usage: pnpm report:weekly [daily|weekly|monthly]');
  process.exit(2);
}
const result = await generateDealReport(createStores(), kind, { locale: serverLocale() });
console.log(`${kind} report ${result.date}: ${result.files.join(', ')}`);
if (result.pdfError) console.warn(`PDF skipped: ${result.pdfError}`);
