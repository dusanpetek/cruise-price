import { detectProviderId } from '@cruise/domain';
import { searchRoutes } from '../search/routeSearch';

/** Debug helper: pnpm --filter @cruise/collector try-search <aida|mein-schiff> [query] [from] [to] */
const [provider, query, from, to] = process.argv.slice(2);
if (provider !== 'aida' && provider !== 'mein-schiff') {
  console.error('Usage: pnpm --filter @cruise/collector try-search <aida|mein-schiff> [query] [from YYYY-MM-DD] [to YYYY-MM-DD]');
  process.exit(2);
}
const t0 = Date.now();
const out = await searchRoutes(provider, { query: query ?? null, from: from ?? null, to: to ?? null, limit: 8 });
console.log(`${out.total} matches (${out.capped ? 'capped, ' : ''}${((Date.now() - t0) / 1000).toFixed(1)} s), showing ${out.results.length}`);
for (const r of out.results) console.log(`${r.startDate} - ${r.endDate}  ${String(r.nights).padStart(2)}n  ${String(r.pricePerPerson ?? '–').padStart(5)} €${r.flightIncluded ? ' +Flug' : ''}  ${r.ship ?? ''} | ${r.title} | ${detectProviderId(r.url)} ${r.url.slice(0, 110)}`);
