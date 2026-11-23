# Architecture (Release 0.4, trip-total pricing)

```
apps/frontend        React + Vite + Tailwind + shadcn-style UI, React Router, Zustand (UI state), TanStack Query, Recharts
apps/api             Thin node:http JSON API over the stores; Vite proxies /api to it in dev
collector/playwright Provider adapters, selector registry, browser factory, collection runner, diagnostics, batch runs, scheduler
  selectors/         aida.json, mein-schiff.json: every locator and text pattern used on the provider sites
packages/domain      Zod schemas + types (Route, CruiseSnapshot v2, CollectionRun, DailyReport, provider detection). Browser-safe.
packages/analytics   ALL calculations: price statistics, history metrics, chart series/filters, run summaries, daily report. Browser-safe.
packages/notifications Channels (email, Teams, Telegram, Pushover), router with retry, settings loading
packages/shared      Small helpers (browser-safe) + `@cruise/shared/storage` (the only code that touches the filesystem)
data/                routes/ snapshots/ runs/ reports/ failures/{screenshots,html,logs}/ collector.lock
```

Dependency direction: `domain` ← `analytics`, `shared` ← `collector` ← `api`. `frontend` uses `domain`, `analytics` and the root of `shared`, never `/storage`.

## Phase rules (from the 0.2 brief) and how they are enforced

| Rule | Where |
| --- | --- |
| No provider-specific code in the frontend | The UI only knows `ProviderId` and labels from `@cruise/domain`; all site knowledge is in `collector/` |
| No selectors in collectors | `selectors/*.json`, validated by Zod at load; collector code only calls `locate(spec)` |
| No filesystem access in the UI | UI talks to `/api`; only `@cruise/shared/storage` imports `node:fs` |
| Only storage owns persistence | routes, snapshots, runs, reports, failure artifacts and the lock are all stores in `shared/storage` |
| Only analytics owns calculations | collectors compute nothing but per-party totals in the SnapshotBuilder; every statistic, series, filter and report metric is in `@cruise/analytics` |

## Collection flow

`runCollection(route)`: resolve the collector from the URL → launch Chromium (headless unless the provider needs a window) → `collector.collect(ctx)` returns `CollectedCruise` (cabins with per-person package and flight prices) → `SnapshotBuilder` computes party totals and the headline (cheapest cabin) → `snapshots.create` (validated, checksummed, create-only). It never throws: a failure becomes `diagnostics` plus a **failure package** (full-page PNG, HTML dump, JSON log with the error, URL, title and every step's timing) under `data/failures/`.

`collectRoutes(routes)` wraps that for a batch: takes `data/collector.lock` (a second run is refused, stale locks from dead processes or older than 30 min are taken over), runs routes one after another with a pause between them, writes `data/runs/<id>.json`, and regenerates `data/reports/daily-report.json` (plus `daily-<date>.json`).

Triggers: the UI ("Collect now", "Collect all"), `pnpm collect`, and the scheduler (`pnpm schedule`, or `ENABLE_SCHEDULER=1` on the API process; default `0 7 * * *`, daily).

**How often a route is collected:** `collectRoutes` skips a route that is too soon to collect again (`collection/frequency.ts`, `skipDecision`): a cruise that leaves within six months at most once a day (a stored *live* snapshot from today, UTC day); a cruise that leaves in *more than six months* at most once a week (next collection on the seventh day after the last real price). The departure is the one of the newest snapshot that has one; without any, the daily rule applies. Failed attempts, manual snapshots and mock data do not count. The API answers a single-route request with 409 `ALREADY_COLLECTED_TODAY` or `ALREADY_COLLECTED_THIS_WEEK` (with `nextCollection`); `?force=1` on a single route lifts the weekly limit only (`skipDecision(..., {ignoreWeekly})`); "collect all" leaves such routes out and answers 409 `ALREADY_COLLECTED` only when nothing was left to collect; a run in which every route was skipped is not recorded.

### Providers

| | AIDA | Mein Schiff |
| --- | --- | --- |
| Browser | **visible** Chromium window (aida.de answers headless Chromium with HTTP 403) | headless |
| Party | `pax[adults]=2` forced in the URL, then verified against the page ("2 Erwachsene" only) | verified against the dialog ("2 Gäste"); the URL carries no party |
| Cruise info | the site's own `detail.cruise.json` response | page heading, ship heading, date range |
| Cabin prices | per-person price on each cabin card, no flight selected | cabin cards in the "Reise anpassen" dialog |
| Flight | select "Frankfurt - AIDA - Frankfurt", read the cards again: the difference is the flight | switch the dialog to "Flug ab/bis", set both airports to FRA, read "Gesamtpreis": the difference to the own-travel total is the flight |

Checked live: on both sites the flight cost is identical for every cabin category, so Mein Schiff measures it once and applies it to all cards.

## Data model

Snapshot **v2** (`schemaVersion: 2`): provider, source (`live` / `mock` / `manual`), `cruise` (name, ship, departure, nights), `party` (adults, airport), `cabins[]` (per person and party totals, flight kept separate), and the headline `packagePrice` / `flightSurcharge` (cheapest cabin, whole party). Files are never rewritten; v1 (MVP) files are upgraded in memory on read.

Persistence hardening: Zod validation before every save, create-only writes, a sha256 checksum over each snapshot (edits and truncation are detected on read; `inspect()` reports corrupt files, `listByRoute()` skips them with a warning), and path-safe ids.

## Analytics definitions

| Metric | Definition |
| --- | --- |
| Best / worst price ever | min / max headline `packagePrice` |
| Days since lowest | whole days from the most recent snapshot at the minimum to the latest snapshot |
| Change since first | latest − first (absolute and %) |
| Change last 30 days | latest − the last snapshot at least 30 days older than the latest; `null` with less history |
| Savings potential / diffToMin | current − min |
| Trend | sign of current − previous snapshot |

Chart filters: date range (30 d / 90 d / all, measured back from the latest snapshot) and cabin category (headline = cheapest cabin). The provider filter lives on the collection dashboard.

## Operating notes

- AIDA collection opens a Chromium window for roughly a minute per route. The scheduler therefore needs a machine that is awake and logged in; it is opt-in for that reason.
- Both sites can change. See [selector-maintenance.md](selector-maintenance.md).
- Be considerate: collection is sequential, one page visit per route per run, with a pause between routes. Check the providers' terms of use for your usage.

## Release 0.3: decision engine

```
Collection -> Analytics -> Alert engine -> Notification router -> Channels
```

After each stored snapshot, the **alert pipeline** (`collector/alerts/pipeline.ts`) evaluates the alert rules (`analytics/alerts.ts`), stores each alert (`data/alerts/`) and, for live snapshots, sends it through the router. Delivery results are recorded on the alert and never fail the collection.

All calculations live in `@cruise/analytics`:

| Module | What |
| --- | --- |
| `alerts.ts` | NEW_LOW (strictly below every earlier price), PERCENT_DROP (vs the previous collection), TARGET_PRICE (crossing), per cabin group |
| `forecast.ts` | OLS linear regression over the last 60 days, horizons 7/30/60 days, 95% prediction interval, confidence = min(1, n/30) x R², walk-forward backtest (directional accuracy and MAPE), savings projection |
| `recommendation.ts` | BUY (within 3% of the historical low), WAIT (confident forecast of a >=3% drop within 30 days), MONITOR otherwise or with fewer than 14 snapshots; confidence 0..1; past-call accuracy check |
| `savings.ts` | potential savings, largest peak-to-trough drop, volatility (coefficient of variation) and stability score, booking-window buckets |
| `insights.ts` | template-based text; no language model, nothing leaves the machine |
| `intelligence.ts` | per-route analysis, provider scorecard, deal score, portfolio rankings |
| `weeklyReport.ts` | weekly report data and CSV |

Deal score (0-100): 30% savings position (100 at the historical low), 20% forecast, 10% stability, 25% recommendation, 15% provider score.

**Not built (by decision):** Forecasting V2 (Prophet) stays optional behind the same interface and needs a Python runtime, so it is deferred. V1 only uses price over time; cabin, provider and departure are recorded in the forecast context for a later model.

**Booking windows** compare prices in 30-day buckets of "days before departure". They need history that spans more than one bucket, so they say "not enough history" until then.

## Release 0.4: fares

**Model.** Snapshot **v3** adds `fares[]` (code, name, provider, included / excluded services, `refundable`, `selectableCabin`; the last two are null unless the site says so) and `options[]` (cabin x fare x flight, with `cruisePrice + flightPrice = totalPrice`, enforced by the schema), plus `warnings[]`. A cabin's headline price is its cheapest fare, so earlier analytics, alerts and charts keep working. v1 and v2 files upgrade in memory to "no fares", never invented.

**Extraction** (selectors and patterns in `selectors/*.json`):

| | AIDA | Mein Schiff |
| --- | --- | --- |
| Where | the booking flow's "Wählen Sie einen Tarif" step, deep-linked per cabin code (`cabinItemsVariant` in the site's own JSON) | the dialog's tariff tab, then every cabin card per tariff |
| Prices | party price per fare; ALL IN upgrades from the step after choosing CLASSIC / PREMIUM | per-person card price x adults |
| Services | the "Tarifpaket enthält" list (included only) | a list with tick / cross icons (SVG path in the registry) |
| Flight | measured once (same for every cabin and fare, checked live) and added to every option | measured under the last tariff read |
| Failure policy | one cabin or upgrade failing is a warning; no fares at all fails the collection | one tariff failing is a warning; no tariffs at all fails the collection |

**Analytics** (`@cruise/analytics/fares.ts`): trip total, fare comparison, savings, services comparison (explicit extras vs "unknown"), value score (60% price, 40% services; unknown services neutral), per-option deal score and outlook, fare dashboard, cabin x fare matrix, deal finder, highlights. Fare analysis uses the **total** trip price; the earlier headline analytics use the cruise price and the UI shows them with the flight as totals.

**"Always show cruise, flight and total":** one component (`PriceTriple`, and `PriceHeaders` / `PriceCells` for tables) computes the total itself, so the three numbers cannot disagree; charts plot totals with a tooltip that lists all three; alert messages, notification payloads and the weekly report carry the breakdown. A component test and e2e tests check it.

**Not tracked:** other flight variants ("flight premium", no flight) are not offered as separate options by either site's flow, so every option uses the configured FRA flight.

## Trip total is the basis of everything

**Golden rule:** the largest price in the UI is the trip total, and nothing is ranked, forecast, alerted or scored on the cruise price alone.

```
cruiseTotal  = cruisePerPerson x passengers
flightTotal  = flightPerPerson x passengers
tripTotal    = cruiseTotal + flightTotal + mandatoryFees
tripPerPerson = tripTotal / passengers
```

**Stored together** (snapshot v4): `pricing` on every snapshot (the headline: the cabin with the lowest *trip* total), and per cabin and per cabin x fare option: cruise, flight and trip, per person and in total, plus `mandatoryFees`. The schema refuses a document whose trip total is not cruise + flight + fees, or whose legacy headline fields (`packagePrice`, `flightSurcharge`) disagree with `pricing`. All of it is derived in one function (`makePricing`), so the numbers cannot drift. v1-v3 files upgrade in memory (per-person and trip prices derived from the stored totals, fees 0); nothing on disk is rewritten.

| Specification name | Stored as |
| --- | --- |
| cruiseTotal / flightTotal / tripTotal | `pricing.*` on the snapshot; `packageTotal` / `flightTotal` / `tripTotal` on cabins; `cruisePrice` / `flightPrice` / `totalPrice` on options |
| cruisePerPerson / flightPerPerson / tripPerPerson | the same fields with `PerPerson` (`packagePerPerson` on cabins) |
| mandatoryFees | `mandatoryFees` everywhere; 0 today, because neither provider shows a separate mandatory charge in what is collected |

**Optional services** (insurance, drink packages, excursions, ...) are not in the trip total. They are not collected; the one place an optional package shows up is as a fare's included services (for example "Getränkepaket ALL IN" is part of the ALL IN fare, which is priced as its own fare).

**Where the trip total is used:** statistics (current / lowest / highest / savings / trend), series for charts, forecasts (per route, cabin and fare), recommendations, alerts (every rule, with or without a fare), rankings, deal scores, provider comparison, weekly report. History is stored for cruise, flight and trip separately in every snapshot; the route page charts the trip total by default and offers cruise and flight history on request.

**Scores (0-100):**

| Score | Formula |
| --- | --- |
| Deal score | (historical position + forecast opportunity + current discount) / 3. Historical position: 100 at the lowest trip total ever, 0 at the highest. Forecast opportunity: 50 = no expected move, higher when the trip total is expected to *rise* (book now), scaled by forecast confidence. Current discount: how far below the historical average, 20% below = 100 |
| Fare score (best fare) | 50% trip total (cheapest = 100), 20% forecast, 20% included services (unknown = 50), 10% flexibility (refundable, cabin choice; unknown = 50) |
| Best cabin | the cabin whose best option has the highest deal score |

**Airport comparison (0.5):** the flight is already stored separately per option, with its airport code, so another airport only adds options.

## Internationalisation and fare views

- `@cruise/i18n` holds the dictionary (English text is the key, `de.ts` the German text), `createT(locale)` and `interpolate`. Library functions take a `locale` argument (default English); the API takes `?lang=`, and server-side texts default to `CRUISE_LANGUAGE` (German). A test scans all sources and fails when a `t('…')` key has no German text or the placeholders differ.
- The frontend has a global `t()` that reads the language store (default `de`); the app remounts on a language change, so every page picks it up. Alert messages are rebuilt from the stored numbers (`alertMessage`) so they follow the current language.
- A route page works on a *selection* `{cabin, fareCode}`: `selectionSeries` builds the trip-total observations, `analyzeSeries` derives analytics, forecast, recommendation, savings, insight and deal score from them. The charts use the same series; the cabin comparison and price band accept a `fareCode`.

## Release 0.6: deal intelligence

All modules are pure functions in `@cruise/analytics`; the API and the UI only call them.

- `recommendation.ts`: `recommend(series, forecast, locale, {fareValue, upgradeScore})` returns `{action, confidence, reason, explanation[], factors}`. Actions: BUY_NOW (within 3% of the historical low), LIKELY_GOOD (up to 8% above, no drop expected, or a poor-value fare at the low), WAIT_FOR_DROP (a confident forecast of a drop of at least 3%), WAIT (more than 15% above the low), AVOID (more than 25% above, or a poor-value fare well above its low), MONITOR (not enough history or no signal). Accuracy counts BUY_NOW/LIKELY_GOOD as right if no price 3% lower followed within 30 days, WAIT/WAIT_FOR_DROP/AVOID if the price fell by at least 2%.
- `fares.ts`: `fareValueScore` (35/20/15/10/10/10), `dealScoreBreakdown` (mean of historical position, forecast opportunity, trend, fare value, upgrade value; trend = change over the last 7 days, 10% lower = 100), `OptionIntelligence` carries ship, departure, duration, historical average, expected saving, recent change and the recommended fare of its cabin.
- `upgrades.ts`: `analyzeUpgrades` over neighbouring cabin groups at the same fare; score = 100 - 50 x (today's cost / usual cost), or by percentage with fewer than 3 earlier observations.
- `timing.ts`: `lastMinuteIntelligence` and `recommendBookingWindow` from the days before departure of every collection (window = where prices came within half the volatility, 2-10%, of the low; rounded to 5 days, at least 10 days wide).
- `dealSearch.ts`: `searchDeals(options, filters, mode)` (four ranking modes) and `dealFilterChoices`; shared by the deal finder.
- `copilot.ts`: `askCopilot(question, portfolio, locale)`: keyword rules for the intent (English and German), entity matching for route, fare, cabin group and budget, answers built from the existing analysis. The portfolio is built in the language of the request, so the reasoning follows it.
- `historical.ts`: `buildHistoricalDataset`; the collection batch writes it to `data/intelligence/<routeId>.json` after every stored snapshot (a failure there never fails the collection).
- `intelligence.ts`: `analyzeRoute` adds ship, upgrades, last-minute, booking window and, per cabin group, deal score, value score, upgrade score and the heat level; `analyzePortfolio` adds the ranked upgrades and the best one. A route's favorite fare and cabin still replaces the cheapest cabin as its headline, now including fare value and upgrade value.
- Reports: `buildWeeklyReport(..., kind)` for `daily | weekly | monthly` (period 1, 7 or 30 days), with best upgrades and the forecast summary; the store keeps `data/reports/<kind>/`.

