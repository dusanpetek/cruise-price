# Route itinerary (ports, times, map) and cabin sub-categories

Status: approved by the user (2026-11-27). Open points are marked **OPEN**; decisions the builder may settle are marked **CALL**.

## Intent / why
- Per route the user wants to see where the ship goes and when: ports with arrival and departure times, and the
  route on a map in a popup.
- Inside a cabin category the user wants to see which price differences exist (their words: "welche
  Preisunterschiede es innerhalb einer Kategorie gibt"), e.g. a balcony cabin with and without restricted view.

## Goals
- A route shows its itinerary: ordered ports, arrival/departure date and time, sea days.
- A popup shows the itinerary as a map (ports connected in order) next to the list of ports and times.
- The cabin price view shows, for each of the five cabin groups, every sub-category of that group with its price
  and the spread between cheapest and most expensive.
- Existing price history, forecast, alerts, upgrade analysis and recommendations keep working unchanged.

## Non-goals / anti-goals
- Not a price history per sub-category as a new analytics product; the first version shows the current prices.
- Not a new provider; AIDA and Mein Schiff only.
- Anti-goal: breaking the series of an existing cabin category (e.g. "Balkonkabine" must not split into several
  series; its history stays one line).
- No live per-request scraping from the API: data comes from the collector runs (AIDA opens a visible browser
  window, so an on-demand request cannot work).

## Constraints
- Snapshots are immutable; old files stay as they are and are migrated on read (`migrateSnapshot`).
- Collectors use `ctx.now`, selectors live in `selectors/*.json`, bilingual texts via `t(...)`.
- External map tiles are a third-party request from the user's browser: the Datenschutz page
  (`apps/frontend/src/pages/Legal`) needs a sentence about it.

## What the live check showed (2026-11-27, read-only)
- **AIDA:** the search response the collector already reads (`search.cruise.json`, field `ports`) contains per port
  `code` (UN/LOCODE, e.g. `ESSPC`), `name`, `arrivalDateTime`, `departureDateTime`. Today only the names are kept.
  The first port has only a departure, the last only an arrival; sea days appear as `code: "SEE"` with no name and
  no times. The item also has a `cruiseItemVariant` field of unknown meaning.
- **Mein Schiff:** the trip page has a "Reiseverlauf" section; no times were visible in the page text. Whether it
  needs a click or loads later is unknown.
- **Cabins:** both sites already list variants as separate top-level cards. Mein Schiff: Innenkabine, Außenkabine,
  Balkonkabine, SPA Balkonkabine, Junior Suite Balkon, three named suites. AIDA: Innenkabine, Meerblickkabine,
  Balkonkabine, Panorama Balkonkabine, Suite. `cabinGroupOf` maps e.g. "SPA Balkonkabine" and "Panorama
  Balkonkabine" to the group `balcony`, so these variants are the sub-categories seen so far.
- Collector warnings seen: AIDA "PREMIUM ALL IN for Balkonkabine" not readable (10 s timeout), no fares for
  Innenkabine; Mein Schiff tariff PUR not available. Not part of this work.

## Approaches (cabin sub-categories)
1. **Sub-category as a second level (chosen).** `cabins` and `options` get an optional `subcategory`
   (snapshot v5, old files migrate). The category keeps its cheapest price as headline, so history, forecast and
   alerts are unchanged. New: a view with all sub-categories of a group and their spread.
2. **Every sub-category its own category.** Least code, but "Balkonkabine" history breaks and matrix, alerts and
   upgrade analysis multiply. Rejected.
3. **Separate dataset next to the snapshots, collected less often.** Clean, but no per-sub-category history.
   Rejected.

## Design

### Itinerary
- New domain model `Itinerary`: `stops: { code, name, country?, arrival: ISO|null, departure: ISO|null, seaDay: boolean }[]`.
  Stored per route (new `itineraryStore` beside `routeStore`), not in price snapshots, because it does not change
  with each price run.
- Collector: AIDA reads `ports` from the search response it already uses; Mein Schiff reads the "Reiseverlauf"
  section (**OPEN**, see below). A route without an itinerary gets it on its first collector run; a failure to read it
  becomes a warning and never fails the price run.
- Coordinates: a static table keyed by UN/LOCODE in `packages/domain` (or `shared`) for the ports on offer;
  ports without an entry are listed but not drawn. **CALL:** the table starts from the ports found in the search
  results of both providers; the builder decides how it is generated and checked.
- API: `GET /api/routes/:id/itinerary`.

### Map popup
- A popup (native `<dialog>`, same pattern as `RouteSearchDialog`) opened from the route detail and the route
  search result. Left/top: map with markers in order and a line; right/bottom: list of ports with arrival and
  departure; sea days shown as such.
- **CALL (recommended):** Leaflet with OpenStreetMap tiles, plus a sentence on the Datenschutz page.
  Alternative without third-party requests: a plain SVG map without tiles. **OPEN:** confirm the choice
  (the tile-less map is less pretty but needs no privacy text).
- Must work on a phone (the app was just made mobile-responsive).

### Sub-categories
- `CabinPriceSchema` and `PricingOptionSchema` get `subcategory: string | null` (default null). Snapshot schema
  version 5; `migrateSnapshot` adds `subcategory: null` to v4 documents.
- **First version:** the sub-categories of a group are the provider's own cards inside it (e.g. "Balkonkabine",
  "SPA Balkonkabine" in `balcony`), shown by the group view below. The new `subcategory` field exists but stays
  null until a provider exposes levels below a card (see "Calls made after the builder check").
- Finer levels below the cards are filled only if a provider shows them (**OPEN**, see below).
- View: in the cabin comparison, a group expands to its sub-categories with price (per person and trip total) and
  the spread to the cheapest one. Existing charts and alerts keep using the group/category headline only.

## Calls made after the builder check
- **Series stay as they are (answers "headline vs. cards"):** every provider card remains its own category in
  `cabins`/`options`, exactly as today, so matrix, history, forecast and alerts see no change and v5 is purely
  additive. The "group view" is computed on read by `cabinGroupOf`: it lists all categories of a group, each with its
  own price, and the spread to the cheapest. The earlier phrase "category keeps its cheapest price as headline" only
  applies once a provider has levels *below* a card (then the card's price is the cheapest level, and `subcategory`
  names the level). `subcategory` is therefore null for all cards today.
- **Itinerary refresh:** any collector run of a route fills a missing itinerary; later runs overwrite it when the
  provider's data changed (latest read wins; the previous version is not kept). Until it is read the route shows
  "itinerary not collected yet" with no popup button.
- **Coordinates:** a hand-maintained table keyed by UN/LOCODE, no new dependency. A route with fewer than two drawable
  ports shows the port list only, without a map.
- **Mein Schiff scope:** AIDA first. Mein Schiff is a separate task; if its pages show no times, it shows ports
  only (names, in order, no times) and the model allows `arrival`/`departure` null for a whole provider.

## Open points (must be settled before or during the plan)
1. **OPEN – Mein Schiff itinerary:** do the trip pages expose port times, and where (click, lazy load, XHR)?
   Needs a read-only look at the "Reiseverlauf" section. Until then Mein Schiff routes show ports without times
   or no itinerary.
2. **DEFERRED – finer cabin levels at AIDA** (user decided: start with the visible provider cards, check the finer levels separately afterwards): meaning of `cruiseItemVariant` and whether the detail JSON
   (`cabinItemsVariant`, `cabinCode`) has price levels below the five cards. Also whether Mein Schiff's
   `cabinCategoryType` codes (`INUS2V`, `IKUS2V`) hide sub-types. If not, sub-categories stay the visible cards.
3. **DECIDED – map style:** Leaflet with OpenStreetMap tiles, plus a sentence on the Datenschutz page (user, 2026-11-27).
4. **OPEN – existing collector gaps** ("Premium All In" timeout at AIDA, missing fares for Innenkabine): out of
   scope here, but they affect how complete a sub-category comparison is.

## Left to the builder
Store layout and file names, the port-coordinate table's source, the base-card rule per provider, UI details of the
popup and the expandable group, tests (fixtures from the live check, v4→v5 migration, itinerary parsing incl. sea
days and missing arrival/departure).
