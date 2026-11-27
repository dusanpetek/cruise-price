# OSM port geocoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ports that have no entry in the hand-maintained coordinate table get their position from OpenStreetMap's geocoder (Nominatim), looked up once on the server and cached, so the route map no longer silently skips ports (e.g. the Seychelles on AIDAblu "Mauritius, Seychellen & Madagaskar").

**Architecture:** The collector resolves positions for stops without a table coordinate right after it read the itinerary and stores `lat`/`lng` on the stop (new optional fields), so the browser needs no extra request and no external call. A persistent geocode cache (`<dataDir>/geocode-cache.json`) makes every port a one-time lookup. The table stays the first source and the manual override.

**Tech Stack:** TypeScript, zod, vitest, Node `fetch`; Nominatim (`https://nominatim.openstreetmap.org/search`).

**Origin:** user chose "Nominatim with cache" on 2026-11-27 after the Seychelles ports were missing from the map. This replaces the earlier spec constraint "hand-maintained table, no geocoding dependency" (docs/superpowers/specs/2026-11-27-route-itinerary-and-subcategories-design.md); the table remains.

## Global Constraints

- Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/): at most **1 request per second** (`minIntervalMs: 1100`), a **User-Agent that identifies the app** (default `cruise-price-tracker/1.0 (+https://github.com/dusanpetek/cruise-price)`, overridable with env `GEOCODE_USER_AGENT`), **cache results**, no bulk use. Only the server calls Nominatim, never the browser. Only port names and a country code are sent (no personal data).
- Never fails a price run: any geocoding error leaves the stops without position, is logged with `console.error('[collector] …')`, and the run stays `success`. A failed lookup is not cached as "not found" (only a real empty/ambiguous answer is cached).
- Table first: a stop that `portCoordinate(stop)` resolves is never geocoded and its table coordinate wins over a stored `lat`/`lng`.
- Wrong marker is worse than none: ambiguous answers are not used (rules below). Plain "Santa Cruz" must stay undrawn (its existing pinning test in `packages/domain/src/itinerary.test.ts` stays green).
- Old itinerary files (no `lat`/`lng`) still parse; `lat`/`lng` default to `null`.
- Tests never call the network: the geocoder takes an injectable `fetch` and clock.
- Do not touch the Legal/Datenschutz page; do not touch the untracked `.claude/` files. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Decisions (binding)

- Query rule (AIDA, stop has a `code`): country = first two letters of the UN/LOCODE lowercased (`SCPOV` → `sc`); request `q=<name>`, `countrycodes=<cc>`, `format=jsonv2`, `limit=3`; take the **first** result (Nominatim ranks by importance), after dropping results whose `category`/`type` is a plain administrative `boundary` ONLY IF a non-boundary (`place`, `harbour`, `amenity`, `natural`, `waterway`…) result exists in the same answer. Live check 2026-11-27: "Port Victoria"/sc → Victoria on Mahé (-4.6232, 55.4524); "La Digue"/sc → island (-4.3601, 55.8385) first, an administrative boundary second; "Funchal"/pt → boundary only (kept).
- Query rule (Mein Schiff, no code): `q=<name with its bracket qualifier as free text>` (e.g. `Santa Cruz (La Palma)` → `Santa Cruz La Palma`), no country filter, `limit=3`; accept only if **all returned results lie within 100 km** of the first (an unambiguous place); otherwise cache "ambiguous" (null) and draw nothing. Plain "Santa Cruz" (Tenerife/Sevilla/Asturias) therefore stays undrawn.
- Sea days and stops without a name are never geocoded.
- Cache key `${cc ?? '-'}|${normalized name}` (normalized = lowercase, diacritics folded, trimmed, bracket text kept), value `{ lat, lng, source: 'osm', at: ISO } | { miss: true, at: ISO }`. A `miss` is retried after 30 days. A hit never expires.
- Position on the stop: `lat: number | null`, `lng: number | null` (both null or both set), set only for stops without a table coordinate. `drawableStops` uses `portCoordinate(stop)` first, then `stop.lat/lng`.
- `put` already compares `stops` and answers 'updated' when positions were added, which is wanted.

## File Structure

- Modify `packages/domain/src/models/Itinerary.ts` (stop fields, `drawableStops`), test `packages/domain/src/itinerary.test.ts`.
- Create `packages/shared/src/storage/geocodeStore.ts` (+ export + `createStores` entry `geocodes`), test next to the other store tests.
- Create `collector/playwright/src/geocoding/nominatim.ts` (geocoder), `collector/playwright/src/geocoding/resolvePositions.ts`, tests `collector/playwright/src/geocoding.test.ts`.
- Modify `collector/playwright/src/runner/collectionRunner.ts` and `collection/batch.ts` (wire it), test in `collector.test.ts`.
- Create `collector/playwright/src/cli/resolve-positions.ts` + script `positions:resolve` in `collector/playwright/package.json`.
- Modify README.md / docs/architecture.md (short paragraph).

---

### Task 1: Position fields on stops (domain)

**Files:** Modify `packages/domain/src/models/Itinerary.ts`; Test `packages/domain/src/itinerary.test.ts`.

**Interfaces — Produces:** `ItineraryStop` gains `lat: number | null` and `lng: number | null` (zod `.number().min(-90).max(90).nullable().default(null)` / `-180..180`, a refinement that both are null or both set). `drawableStops` order of precedence: `portCoordinate(stop)` then `stop.lat/lng`. Everywhere an `ItineraryStop` literal is built in the repo (`aidaStops`, `parseMeinSchiffItinerary`, `MockCollector`, test helpers, frontend) must still type-check — add `lat: null, lng: null` where object literals need it (find with `pnpm -r exec tsc --noEmit`).

- [ ] **Step 1: Write failing tests:** (a) a stop without `lat`/`lng` parses to `lat: null, lng: null`; (b) `{lat: 10}` without `lng` is rejected; (c) `drawableStops` draws a stop with unknown code but `lat/lng` set, in order, and a table port ignores a different stored `lat/lng` (table wins); (d) an old stored itinerary object (no fields) still parses through `ItinerarySchema`.
- [ ] **Step 2:** run `pnpm vitest run packages/domain/src/itinerary.test.ts`, expect FAIL.
- [ ] **Step 3:** implement; fix all type errors the new required output fields cause.
- [ ] **Step 4:** `pnpm vitest run` and `pnpm -r exec tsc --noEmit` pass. Commit `feat(domain): optional stored position on itinerary stops`.

### Task 2: Geocode cache and Nominatim geocoder

**Files:** Create `packages/shared/src/storage/geocodeStore.ts` (+ export in `storage/index.ts`, `createStores` entry `geocodes`), `collector/playwright/src/geocoding/nominatim.ts`, `collector/playwright/src/geocoding/resolvePositions.ts`; Test `packages/shared/src/storage/*.test.ts` (follow the neighbouring store tests) and `collector/playwright/src/geocoding.test.ts`.

**Interfaces — Produces:**
- `createGeocodeStore(dataDir?)`: `get(key: string): Promise<GeocodeEntry | null>`, `put(key: string, entry: GeocodeEntry): Promise<void>`; one JSON file `geocode-cache.json` (atomic writes via the existing `writeJsonAtomic`, tolerant of a missing or corrupt file: treated as empty, never throws on read); `GeocodeEntry = { lat: number; lng: number; source: 'osm'; at: string } | { miss: true; at: string }`.
- `createNominatimGeocoder(opts?: { fetch?: typeof fetch; userAgent?: string; minIntervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> }): { geocode(q: { name: string; country: string | null }): Promise<{ lat: number; lng: number } | null> }` implementing the query rules above; serial queue enforcing `minIntervalMs` between requests; throws on network errors / non-2xx (so the caller does not cache a failure); returns `null` for no/ambiguous results.
- `resolveStopPositions(stops: ItineraryStop[], deps: { geocoder; store: GeocodeStore; now: () => Date; log?: (msg: string) => void }): Promise<ItineraryStop[]>`: for each non-sea-day stop with a name and no `portCoordinate(stop)` and no `lat/lng`: cache lookup by key (hit → use; `miss` younger than 30 days → skip; older → retry); else `geocoder.geocode`; success → cache hit + set `lat/lng` on the returned copy; `null` → cache `miss`; a thrown error → log, do not cache, leave the stop unchanged, and continue with the other stops (do not hammer after an error: stop geocoding for the rest of this call after 2 consecutive errors). Never mutates its input; returns stops in the same order.

- [ ] **Step 1: Write failing tests** (all with injected fake `fetch`, fake clock/sleep): query URL/params (AIDA: `countrycodes=sc`, `limit=3`, `format=jsonv2`, the User-Agent header present); AIDA choice: first non-boundary result preferred over an earlier boundary only when a non-boundary exists, boundary-only answers keep the first; Mein Schiff: consistent results (within 100 km) accepted, "Santa Cruz" fixture (Tenerife 28.47,-16.25 / Sevilla 37.39,-5.99 / Asturias 43.19,-5.77) → `null`; qualifier text `Santa Cruz (La Palma)` is sent as `Santa Cruz La Palma`; two consecutive geocodes wait ≥ `minIntervalMs` (fake sleep records it); non-2xx → throws; store: round trip, missing file → null, corrupt file → null and writable again; `resolveStopPositions`: table port skipped (fetch not called), sea day skipped, hit cached (second call makes no request), `miss` skipped within 30 days and retried after, error not cached and other stops still processed, after 2 consecutive errors no more requests, order and input immutability.
- [ ] **Step 2:** run the new test files, expect FAIL.
- [ ] **Step 3:** implement; country of a code = `code.slice(0, 2).toLowerCase()` when `code` matches `/^[A-Z]{5}$/` else `null`; distance by the haversine formula.
- [ ] **Step 4:** `pnpm vitest run`, `pnpm -r exec tsc --noEmit` pass. Commit `feat(collector): Nominatim geocoder with a persistent cache`.

### Task 3: Wire it into price runs, backfill CLI, docs

**Files:** Modify `collector/playwright/src/runner/collectionRunner.ts`, `collector/playwright/src/collection/batch.ts`; Create `collector/playwright/src/cli/resolve-positions.ts`; Modify `collector/playwright/package.json` (script `"positions:resolve": "tsx src/cli/resolve-positions.ts"`), `README.md`, `docs/architecture.md`; Test `collector/playwright/src/collector.test.ts`.

**Interfaces — Consumes:** `resolveStopPositions`, `createNominatimGeocoder`, `GeocodeStore`.
**Produces:** `CollectionRunnerDeps.geocoder?: { geocode(...) }` and `geocodes?: GeocodeStore` (both optional; default: none → no geocoding, existing behaviour). `BatchDeps.stores` additionally accepts `Partial<Pick<Stores, 'geocodes'>>`; `collectRoutes` passes `geocodes` and, when `process.env.GEOCODE !== '0'`, a default `createNominatimGeocoder()` (kill switch `GEOCODE=0`; mock mode `COLLECTOR_MODE=mock` never geocodes — also no default geocoder when the collector is a mock one; implement as: only create the default geocoder when `collectorModeFromEnv() === 'live'`).
In `runCollection`'s `read-itinerary` block: after `readItinerary` returned non-empty stops and before `itineraries.put`, `stops = await resolveStopPositions(stops, …)` inside the same try/catch (a failure there is logged like the other read-itinerary failures and the unresolved stops are still stored).
`resolve-positions.ts` CLI: for every stored itinerary of `createStores()` resolve positions with the live geocoder and `put` the result, printing `route name: n resolved, m unresolved`; `--dry-run` prints without writing; exits non-zero only on an unexpected crash.

- [ ] **Step 1: Write failing tests** in `collector.test.ts` with a fake geocoder: a run whose itinerary has an unknown port stores it with `lat/lng` from the geocoder; a throwing geocoder → run `success`, itinerary stored without positions, one `console.error`; no geocoder in deps → unchanged behaviour (existing tests stay green); the second run with the same data answers `unchanged` (positions cached, `put` 'unchanged') and makes no geocoder call.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** implement; add the CLI; document in README.md and docs/architecture.md (one paragraph each: where the positions come from, table first, the cache file `data/geocode-cache.json`, `GEOCODE=0`, `GEOCODE_USER_AGENT`, the backfill command `docker compose exec app pnpm --filter @cruise/collector positions:resolve`) and add `data/geocode-cache.json` to `.gitignore`.
- [ ] **Step 4:** `pnpm vitest run` (all pass), `pnpm -r exec tsc --noEmit`, `pnpm --filter @cruise/frontend build`. Then ONE read-only live check against the real Nominatim (1 request per second, a handful of requests): run the geocoder on `{name: 'Port Victoria', country: 'sc'}`, `{name: 'La Digue', country: 'sc'}`, `{name: 'Santa Cruz', country: null}` (expect null), `{name: 'Santa Cruz (La Palma)', country: null}` through a throwaway script outside the repo and report the results. Commit `feat(collector): resolve missing port positions via OSM during price runs`.
