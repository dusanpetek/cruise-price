# Route itinerary and cabin sub-categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a route's ports with arrival/departure times and a Leaflet map popup, and show the price differences between the provider's cabin cards inside each cabin group, without changing any existing price series.

**Architecture:** The itinerary is a new per-route document (`itineraryStore`), filled by the collectors from data the provider sites already deliver (AIDA: the `ports` of the search response; Mein Schiff: the "Reiseverlauf" section, to be investigated). Snapshots get an additive `subcategory` field (schema v5, v4 files migrate on read). The group view is computed on read from existing `cabins`/`options` by `cabinGroupOf`.

**Tech Stack:** TypeScript, zod, vitest, Playwright (collector), React 19 + Vite + Tailwind v4 + react-query, Leaflet (new, frontend only).

**Spec:** `docs/superpowers/specs/2026-11-27-route-itinerary-and-subcategories-design.md`

## Global Constraints

- Snapshots are immutable; old files are never rewritten, `migrateSnapshot` upgrades on read. `SNAPSHOT_SCHEMA_VERSION` becomes 5.
- Every provider card stays its own category in `cabins`/`options`; no existing series (history, forecast, alerts, matrix) may change. `subcategory` is `null` for all cards today.
- Collectors use `ctx.now`, never `new Date()`; selectors live in `collector/playwright/selectors/*.json`.
- Reading the itinerary must never fail a price run: a failure becomes a warning step.
- Map: Leaflet with OpenStreetMap tiles; the Datenschutz page (`apps/frontend/src/pages/Legal/index.tsx`) gets a sentence about the tile requests. No other new runtime dependency.
- Coordinates: hand-maintained table keyed by UN/LOCODE, no geocoding dependency. A route with fewer than two drawable ports shows the port list only, no map.
- Itinerary refresh: any run of a route fills a missing itinerary; later runs overwrite it when the data changed (latest wins). Before it exists the route shows "itinerary not collected yet" and no popup button.
- Bilingual texts via `t(...)` with the German entry in `packages/i18n/src/de.ts`; the Legal pages are German only.
- Out of scope: finer cabin levels below a card (deferred), the AIDA "Premium All In"/Innenkabine collector gaps, price history per sub-category.

## Review Focus

- AIDA `ports` entries with `code: "SEE"`, `name: null` and no times are sea days: listed as "sea day", never drawn, never crash the formatter.
- First stop has only a departure, last stop only an arrival; both must render (no "Invalid Date", no empty cell).
- AIDA times are local wall-clock strings without a zone (`2026-11-29T10:00:00`): format by slicing the string, never through `new Date()`, or the shown time shifts with the viewer's timezone.
- The same port occurs several times (Las Palmas three times): list shows every visit, the map line goes through all of them, markers are not duplicated on top of each other.
- A port with an unknown code/name: listed, not drawn; with fewer than two drawable ports no map is rendered.
- A stored v4 snapshot and an old cached search result (without `itinerary`) still load; the popup button is hidden for the latter.
- Leaflet inside a native `<dialog>` renders grey tiles unless the size is recomputed after `showModal()`; check it on a phone width.

---

### Task 1: Itinerary model and port coordinates

**Files:**
- Create: `packages/domain/src/models/Itinerary.ts`, `packages/domain/src/models/portCoordinates.ts`
- Modify: `packages/domain/src/index.ts` (export both)
- Test: `packages/domain/src/itinerary.test.ts`

**Interfaces:**
- Produces:
  - `ItineraryStopSchema` / `ItineraryStop = { code: string | null; name: string | null; seaDay: boolean; arrival: string | null; departure: string | null }` where `arrival`/`departure` are local `YYYY-MM-DDTHH:mm:ss` strings without zone.
  - `ItinerarySchema` / `Itinerary = { routeId: string; provider: ProviderId; readAt: string /* ISO datetime */; stops: ItineraryStop[] }`.
  - `portCoordinate(stop: Pick<ItineraryStop, 'code' | 'name'>): { lat: number; lng: number } | null` (by UN/LOCODE first, then by a normalized-name alias map for Mein Schiff, which has no codes).
  - `drawableStops(stops: ItineraryStop[]): { stop: ItineraryStop; lat: number; lng: number }[]` (sea days and unknown ports left out, order kept).
  - `formatStopTime(iso: string | null): { date: string; time: string } | null` returning `YYYY-MM-DD` / `HH:mm` by slicing, null for null.

- [ ] **Step 1: Write the failing tests** in `itinerary.test.ts`: `portCoordinate({code:'ESSPC',name:null})` is non-null and `portCoordinate({code:'XXXXX',name:null})` is null; a name-only stop (`name:'Funchal/Madeira'`) resolves through the alias map; `drawableStops` drops `{code:'SEE',name:null,seaDay:true,...}` and keeps order with three `ESLPA` visits; `formatStopTime('2026-11-29T10:00:00')` equals `{ date:'2026-11-29', time:'10:00' }` and `formatStopTime(null)` is null; `ItineraryStopSchema` accepts a stop with `arrival: null` and rejects `arrival: '2026-11-29'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/domain/src/itinerary.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the two model files with the signatures above. The coordinate table holds the ports of the live check (Las Palmas ESLPA, Santa Cruz de La Palma ESSPC, Agadir MAAGA, Puerto del Rosario ESFUE, Arrecife ESACE, Funchal PTFNC) and is extended in Task 5 from the real search results; take coordinates from an authoritative source (UN/LOCODE data or the port's own record), never from memory.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): itinerary model and port coordinates`.

### Task 2: Snapshot schema v5 with `subcategory`

**Files:**
- Modify: `packages/domain/src/models/CruiseSnapshot.ts` (`CabinPriceSchema`, `SNAPSHOT_SCHEMA_VERSION`, `migrateSnapshot`), `packages/domain/src/models/Fare.ts` (`pricingOptionShape`)
- Modify: every test or fixture that hard-codes `schemaVersion: 4` (find with `grep -rn "schemaVersion" --include='*.ts' packages collector apps`)
- Test: add to the existing snapshot tests (the file that covers `migrateSnapshot`; find it with `grep -ln migrateSnapshot -r packages --include='*.test.ts'`)

**Interfaces:**
- Produces: `CabinPrice.subcategory: string | null` and `PricingOption.subcategory: string | null`, both `z.string().min(1).nullable().default(null)`; `SNAPSHOT_SCHEMA_VERSION = 5`; `migrateSnapshot` upgrades v4 → v5 by adding `subcategory: null` to every cabin and option.

- [ ] **Step 1: Write the failing tests:** a v4 document with one cabin and one option parses through `parseSnapshot` to `schemaVersion: 5` with `cabins[0].subcategory === null` and `options[0].subcategory === null` and all prices unchanged; a v2 and a v3 document still migrate all the way; `SnapshotInputSchema` without `subcategory` parses to `null`.
- [ ] **Step 2: Run** the snapshot test file. Expected: FAIL (literal 4 vs 5).
- [ ] **Step 3: Implement** the fields, the version bump and the v4→v5 step (chain after `withTripPrices`); update the hard-coded versions found in Step "Files".
- [ ] **Step 4: Run** `pnpm vitest run`. Expected: all PASS (existing snapshot stores read old files).
- [ ] **Step 5: Commit** `feat(domain): snapshot v5 with optional cabin subcategory`.

### Task 3: Itinerary store

**Files:**
- Create: `packages/shared/src/storage/itineraryStore.ts`
- Modify: `packages/shared/src/storage/index.ts` (export, add `itineraries: createItineraryStore(dataDir)` to `createStores`)
- Test: `packages/shared/src/storage/itineraryStore.test.ts` (follow the neighbouring store tests: temp dir per test)

**Interfaces:**
- Consumes: `Itinerary`, `ItinerarySchema` (Task 1), `assertSafeId`, `readJson`, `writeJsonAtomic` as in `routeStore.ts`.
- Produces: `createItineraryStore(dataDir?)` with `get(routeId): Promise<Itinerary | null>`, `put(itinerary: Itinerary): Promise<'created' | 'updated' | 'unchanged'>` (compares `stops` only, ignoring `readAt`; unchanged → nothing written), `remove(routeId): Promise<void>` (no error when missing). Files live at `<dataDir>/itineraries/<routeId>.json`. `type ItineraryStore`.

- [ ] **Step 1: Write the failing tests:** `get` of an unknown route is `null`; `put` returns `'created'` then `'unchanged'` for the same stops with a later `readAt` (file `readAt` stays the first), then `'updated'` when a time changes and `get` returns the new stops; `remove` twice does not throw; an unsafe id is rejected like in `routeStore`.
- [ ] **Step 2: Run** `pnpm vitest run packages/shared/src/storage/itineraryStore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the store; compare with `stableStringify` from `./stableJson`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): itinerary store`.

### Task 4: Cabin group breakdown (analytics)

**Files:**
- Create: `packages/analytics/src/cabinGroups.ts`; Modify: `packages/analytics/src/index.ts`
- Test: `packages/analytics/src/cabinGroups.test.ts` (use `packages/analytics/src/testing.ts` helpers for snapshots; the 95 % coverage threshold of this package applies)

**Interfaces:**
- Consumes: `cabinGroupOf`, `CABIN_GROUPS`, `CruiseSnapshot` from `@cruise/domain`.
- Produces: `cabinGroupBreakdown(snapshot: CruiseSnapshot, fareCode?: string | null): CabinGroupBreakdown[]` with
  `CabinGroupEntry = { category: string; subcategory: string | null; tripPerPerson: number; tripTotal: number; deltaToCheapest: number }` and
  `CabinGroupBreakdown = { group: CabinGroup | null; entries: CabinGroupEntry[]; spread: number }`.
  Groups in `CABIN_GROUPS` order, `null` (unrecognised categories) last, empty groups omitted; entries ascending by `tripTotal`; `deltaToCheapest` = entry total minus the group's cheapest total; `spread` = most expensive minus cheapest (0 for one entry). Without `fareCode` it reads `cabins` (cheapest fare of each), with it `options` of that fare.

- [ ] **Step 1: Write the failing tests** with the live-check data: Mein Schiff cards `Balkonkabine` (trip 999+flight) and `SPA Balkonkabine` (1399+flight) land in group `balcony` with `deltaToCheapest` 400 and `spread` 400; `Große Freiheit Suite`, `Weitblick Suite`, `Schöne Aussicht Suite` land in `suite`, `Junior Suite Balkon` in `junior-suite`; AIDA `Panorama Balkonkabine` joins `Balkonkabine`; an unknown category `Foo` ends up in the `group: null` entry; with a `fareCode` only that fare's options are used; a snapshot without cabins returns `[]`.
- [ ] **Step 2: Run** `pnpm vitest run packages/analytics/src/cabinGroups.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `cabinGroupBreakdown`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(analytics): cabin group breakdown`.

### Task 5: AIDA itinerary parsing and search results

**Files:**
- Modify: `collector/playwright/src/search/aida.ts` (`AidaItem.ports` gains `code`, `arrivalDateTime`, `departureDateTime`; `aidaResults`), `packages/domain/src/models/RouteSearch.ts` (`RouteSearchResult.itinerary?: ItineraryStop[]`), `collector/playwright/src/search/routeSearch.ts` (re-export if it re-exports AIDA helpers), `packages/domain/src/models/portCoordinates.ts` (extend table)
- Test: `collector/playwright/src/search.test.ts` (extend the AIDA fixture at the top with codes and times from the live check)

**Interfaces:**
- Consumes: `ItineraryStop` (Task 1).
- Produces: `aidaStops(ports: AidaItem['ports']): ItineraryStop[]` (exported): `code: 'SEE'` or a missing name → `seaDay: true`, `name: null`; names run through the existing `titleCase`; times passed through as given, empty strings → null. `aidaResults` sets `itinerary: aidaStops(item.ports)` on every result (the `ports: string[]` field stays as it is).

- [ ] **Step 1: Write the failing tests:** with the live-check `ports` (8 entries incl. `SEE`), `aidaStops` returns 8 stops; stop 1 has `departure: '2026-11-28T22:00:00'`, `arrival: null`; stop 2 `arrival: '2026-11-29T10:00:00'`, `departure: '2026-11-29T20:00:00'`, `name: 'Santa Cruz/La Palma'`; the `SEE` entry is `{ seaDay: true, name: null, arrival: null, departure: null }`; the last stop has only `arrival`; `aidaResults(...)[0].itinerary` has length 8 and `.ports` is unchanged (existing test still passes).
- [ ] **Step 2: Run** `pnpm vitest run collector/playwright/src/search.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `aidaStops`, wire it in, add the optional field to `RouteSearchResult`. Add the codes of the ports found by `pnpm --filter @cruise/collector try-search aida` to the coordinate table (a small helper script under `collector/playwright/src/cli/` that prints the distinct `code name` pairs missing from the table is allowed; coordinates from an authoritative source).
- [ ] **Step 4: Run** `pnpm vitest run`. Expected: PASS (cache of old results lacks the field and still validates since it is optional).
- [ ] **Step 5: Commit** `feat(collector): AIDA itinerary stops from the search response`.

### Task 6: Itinerary collection during price runs

**Files:**
- Modify: `collector/playwright/src/providers/CruiseProviderCollector.ts` (optional method), `collector/playwright/src/collectors/AidaCollector.ts`, `collector/playwright/src/collectors/MockCollector.ts`, `collector/playwright/src/search/aida.ts` (export a lookup), `collector/playwright/src/runner/collectionRunner.ts`, `collector/playwright/src/collection/batch.ts`
- Test: `collector/playwright/src/collector.test.ts` (runner tests with fake collectors; it already covers `runCollection`)

**Interfaces:**
- Consumes: `ItineraryStore` (Task 3), `aidaStops` (Task 5), `aidaJourneyId` from `parsers/fares`.
- Produces:
  - `CruiseProviderCollector.readItinerary?(ctx: CollectionContext): Promise<ItineraryStop[] | null>`.
  - `findAidaItinerary(page: Page, journeyId: string): Promise<ItineraryStop[] | null>` in `search/aida.ts`: reuses the existing retrying search fetch and returns the stops of the item whose `cruiseItemVariant[].journeyIdentifier` equals `journeyId`, else null.
  - `CollectionRunnerDeps.itineraries?: ItineraryStore`; `BatchDeps.stores` additionally accepts `Partial<Pick<Stores, 'itineraries'>>`, passed through to `runCollection`.
  - In `runCollection`, after a successful `collect` and snapshot store, when `collector.readItinerary` and `deps.itineraries` exist: `diagnostics.step('read-itinerary', ...)` reads and `itineraries.put({ routeId, provider, readAt: startedAt.toISOString(), stops })`; any error or `null` is caught inside the step wrapper so the outcome stays `success` (the failure is only visible as a failed step; do not call `finish` with an error).
  - `MockCollector.readItinerary` returns a fixed three-stop itinerary (two drawable ports with times, one sea day) so e2e and mock mode work.

- [ ] **Step 1: Write the failing tests** in `collector.test.ts`: a fake collector with `readItinerary` returning stops → outcome `success`, `itineraries.get(route.id)` has them, the step list contains `read-itinerary`; a second run with changed stops → `put` returns `'updated'`; `readItinerary` throwing → outcome is still `success`, snapshot stored, no itinerary written, the step is marked failed; a collector without `readItinerary` → no step, no write; a run without `deps.itineraries` → unchanged behaviour.
- [ ] **Step 2: Run** `pnpm vitest run collector/playwright/src/collector.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified; `AidaCollector.readItinerary` opens no new page flow of its own beyond `findAidaItinerary(await ctx.getPage(), aidaJourneyId(ctx.url))` run after the price steps (the visible window is already open).
- [ ] **Step 4: Run** `pnpm vitest run`, then `pnpm --filter @cruise/collector try-live '<the AIDA URL of data/routes/0bcc7c48-….json>'` with the itinerary store wired (it needs `itineraries` in `createStores`, already done in Task 3; pass `stores` through `collectRoutes` as today). Expected: tests PASS; the live run lists `ok read-itinerary` and `<data dir>/itineraries/<id>.json` holds 8 stops.
- [ ] **Step 5: Commit** `feat(collector): collect the itinerary with every price run`.

### Task 7: API endpoint

**Files:**
- Modify: `apps/api/src/app.ts` (route regex at line ~341 gains `itinerary`; handler; delete of a route also removes its itinerary), `apps/frontend/src/lib/api.ts`, `apps/frontend/src/hooks/queries.ts`
- Test: `apps/api/src/api.test.ts` (follow the existing route endpoint tests; `stores` there come from `createStores`)

**Interfaces:**
- Consumes: `stores.itineraries` (Task 3).
- Produces: `GET /api/routes/:id/itinerary` → 200 `Itinerary` or 200 `null` when not collected, 404 for an unknown route; frontend `api.getItinerary(id): Promise<Itinerary | null>` and `useItinerary(routeId: string | undefined)` (react-query key `['itinerary', routeId]`, disabled without id).

- [ ] **Step 1: Write the failing tests:** unknown route → 404; known route without itinerary → 200 body `null`; after `stores.itineraries.put(...)` → 200 with the stops; deleting the route removes the itinerary file.
- [ ] **Step 2: Run** `pnpm vitest run apps/api/src/api.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** endpoint, delete cleanup, `api.getItinerary` and `useItinerary`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): route itinerary endpoint`.

### Task 8: Map popup, group view, privacy text

**Files:**
- Create: `apps/frontend/src/components/RouteMapDialog.tsx`, `apps/frontend/src/components/CabinGroupTable.tsx`
- Modify: `apps/frontend/package.json` (add `leaflet` and `@types/leaflet`, exact versions at least two weeks old), `apps/frontend/src/pages/RouteDetail/index.tsx` (popup button, group table), `apps/frontend/src/components/RouteSearchDialog.tsx` (popup button per result with `r.itinerary`), `apps/frontend/src/pages/Legal/index.tsx` (Datenschutz sentence), `packages/i18n/src/de.ts`, `apps/frontend/src/lib/utils.ts` (+ test in `utils.test.ts`) for a pure `stopLabel` helper
- Test: `apps/frontend/src/lib/utils.test.ts`; e2e in `e2e/app.spec.ts` (runs with the mock collector)

**Interfaces:**
- Consumes: `drawableStops`, `formatStopTime`, `ItineraryStop` (Task 1), `useItinerary` (Task 7), `cabinGroupBreakdown` (Task 4), `RouteSearchResult.itinerary` (Task 5).
- Produces:
  - `RouteMapDialog({ open, title, stops, onClose }: { open: boolean; title: string; stops: ItineraryStop[]; onClose: () => void })`: native `<dialog>` with `showModal()`/`close()` like `RouteSearchDialog`; stop list (name, `date time` arrival and departure, "sea day" label, `—` for missing times) and, only when `drawableStops(stops).length >= 2`, a Leaflet map: OSM tile layer with attribution "© OpenStreetMap contributors", one `L.circleMarker` per distinct port (no default marker icons, so no image asset handling in Vite), an `L.polyline` through all drawable visits in order, `fitBounds`, and `map.invalidateSize()` after the dialog opened; the map is destroyed on close/unmount; stacked layout on phone width, side by side from `lg`.
  - `stopLabel(stop: ItineraryStop): string` in `utils.ts`: name, or `t('Sea day')` for sea days, or `t('Unknown port')`.
  - `CabinGroupTable({ breakdown, currency }: { breakdown: CabinGroupBreakdown[]; currency: string })`: per group a heading (`CABIN_GROUP_LABELS`, or `t('Other')` for `null`), rows of category, trip per person, trip total, difference to the cheapest (`+400 €` style via `formatMoney`), and the spread in the heading; group with one entry shows no difference. Fed by `cabinGroupBreakdown(latestSnapshot, fareCode)` in `RouteDetail`, next to the existing cabin comparison, with `data-testid="cabin-group-table"`.
  - Datenschutz paragraph (German): the route map loads map tiles from OpenStreetMap, the browser sends its IP address and the requested map section to the tile servers of the OpenStreetMap Foundation (Art. 6 Abs. 1 lit. f DSGVO), and the tiles are only requested when the map is opened.
  - RouteDetail shows the button "Route and times" only when `useItinerary` returns data, else the muted text "Itinerary not collected yet".

- [ ] **Step 1: Write the failing tests:** `stopLabel` for a named stop, a sea day and a nameless non-sea-day stop; e2e: with the mock collector, collect a route, open its detail page, assert `cabin-group-table` is visible, click "Route and times", assert the dialog lists the sea-day row and (with two drawable mock ports) a `.leaflet-container` is present, then close it with Escape.
- [ ] **Step 2: Run** `pnpm vitest run apps/frontend/src/lib/utils.test.ts` and `pnpm playwright test e2e/app.spec.ts -g itinerary`. Expected: FAIL.
- [ ] **Step 3: Implement** the two components, helper, wiring, German strings, the dependency (`pnpm --filter @cruise/frontend add leaflet@<version> && pnpm --filter @cruise/frontend add -D @types/leaflet`) and `import 'leaflet/dist/leaflet.css'` inside `RouteMapDialog.tsx`.
- [ ] **Step 4: Run** `pnpm vitest run`, `pnpm --filter @cruise/frontend build`, the e2e command, and `pnpm playwright test e2e/mobile.spec.ts` plus one manual look at 375 px width (no grey tiles, no horizontal scroll). Expected: all PASS.
- [ ] **Step 5: Commit** `feat(frontend): route map popup, cabin group view and tile privacy text`.

### Task 9: Mein Schiff itinerary (investigation first, then parser)

**Files:**
- Create: `collector/playwright/src/parsers/meinSchiffItinerary.ts`, `collector/playwright/src/__fixtures__/meinSchiffItinerary.txt`
- Modify: `collector/playwright/src/collectors/MeinSchiffCollector.ts`, `collector/playwright/selectors/mein-schiff.json` (+ its schema in `src/selectors/schema.ts` if a selector is added), `docs/selector-maintenance.md`
- Test: `collector/playwright/src/parsers.test.ts`

**Interfaces:**
- Consumes: `ItineraryStop` (Task 1), `readItinerary?` hook (Task 6).
- Produces: `parseMeinSchiffItinerary(lines: string[]): ItineraryStop[]` — one stop per port in order; `code: null`; `arrival`/`departure` filled only when the page states times, otherwise `null` (ports-only fallback); sea days as `seaDay: true`.

- [ ] **Step 1: Investigate (read-only, throwaway script in `/tmp`, like `/tmp/livecheck/script/raw.mjs`):** open the Mein Schiff trip page of `data/routes/0857e75f-….json`, expand "Reiseverlauf" (click or scroll as needed), and record in `docs/selector-maintenance.md` where the ports and any times appear (click target, lazy load, or XHR JSON). Save the visible text of the section as `__fixtures__/meinSchiffItinerary.txt`. Decision rule: times found → parse them; none found → the parser returns names only.
- [ ] **Step 2: Write the failing tests** from the fixture: stop count and order equal the fixture's ports, a sea-day line becomes `seaDay: true`, times (if present in the fixture) land in `arrival`/`departure` as `YYYY-MM-DDTHH:mm:ss`, a fixture without times yields `null` times and still parses.
- [ ] **Step 3: Run** `pnpm vitest run collector/playwright/src/parsers.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `parseMeinSchiffItinerary` and `MeinSchiffCollector.readItinerary` (opens the section per Step 1, locates it through the selector file, never throws for a missing section: returns `null`); run `try-live` on the Mein Schiff route and check `itineraries/<id>.json`.
- [ ] **Step 5: Run** `pnpm vitest run`. Expected: PASS. **Commit** `feat(collector): Mein Schiff itinerary`.

---

## Self-review

- **Spec coverage:** itinerary model/store/API/popup (Tasks 1, 3, 7, 8); AIDA source (5, 6); Mein Schiff separate task with ports-only fallback (9); Leaflet and Datenschutz sentence (8); v5 additive `subcategory` and the group view without touching series (2, 4, 8); refresh/overwrite rule and "not collected yet" (3, 6, 8); coordinate table and `<2` ports rule (1, 8); finer levels and collector gaps stay out of scope (Global Constraints).
- **Types:** `ItineraryStop`, `Itinerary`, `ItineraryStore.put/get/remove`, `readItinerary?`, `aidaStops`, `findAidaItinerary`, `cabinGroupBreakdown`, `CabinGroupBreakdown`, `RouteMapDialog` props are defined once and used with the same names in later tasks.
- **Execution order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9; Tasks 2, 3, 4 are independent of each other after Task 1, Task 9 can run any time after Task 6.
