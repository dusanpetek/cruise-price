import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProviderId } from '@cruise/domain';
import { createStores } from '@cruise/shared/storage';
import { collectRoutes } from '../collection/batch';

/** Debug helper: collect ONE url into a throwaway data dir and print the snapshot and diagnostics. */
const url = process.argv[2];
const provider = url ? detectProviderId(url) : null;
if (!url || !provider) {
  console.error('Usage: pnpm --filter @cruise/collector try-live <aida.de or meinschiff.com URL>');
  process.exit(2);
}

const stores = createStores(await mkdtemp(join(tmpdir(), 'cruise-try-')));
const route = await stores.routes.create({ name: 'try-live', provider, url });
const { outcomes } = await collectRoutes([route], { stores }, { trigger: 'cli', log: console.log });
const [outcome] = outcomes;
for (const st of outcome!.diagnostics.steps) console.log(`  ${st.ok ? 'ok  ' : 'FAIL'} ${st.name} ${(st.durationMs / 1000).toFixed(1)}s${st.error ? ' :: ' + st.error.split('\n')[0] : ''}`);
console.log(JSON.stringify(outcome!.snapshot ?? outcome!.diagnostics, null, 2));
console.log('data dir:', stores.dataDir);
process.exit(outcome!.snapshot ? 0 : 1);
