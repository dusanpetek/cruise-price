import { createStores } from '@cruise/shared/storage';
import { collectAll } from '../scheduler';

const outcome = await collectAll(createStores(), 'cli', { log: console.log });
if (!outcome) {
  console.error('Another collection is already running (data/collector.lock). Nothing done.');
  process.exit(2);
}
const failed = outcome.run.results.filter((r) => r.status === 'failed').length;
console.log(`Run ${outcome.run.id}: ${outcome.run.results.length - failed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
