# Cruise Price Tracker

Track cruise prices on **AIDA** and **Mein Schiff** over time for 2 adults flying from Frankfurt (FRA): every cabin category, the flight surcharge kept separate, full snapshot history, analytics, charts and collection reports. Release 0.2 collects **live** data with Playwright; Release 0.3 adds alerts, notifications, forecasts, recommendations, rankings and weekly reports; Release 0.4 makes the **fare** (tariff) a first-class part of every price. See [docs/architecture.md](docs/architecture.md).

## Quick start

Requires Node 22+ and pnpm 9 (`corepack enable` picks the pinned version).

```bash
pnpm install
pnpm exec playwright install chromium     # once
pnpm dev                                  # API :8787 + web http://localhost:5173
```

1. Click **Add** and paste a cruise URL from aida.de or meinschiff.com (the provider is detected from the URL).
2. Click **Collect now** on the route. AIDA opens a Chromium window for about a minute; Mein Schiff runs headless.
3. Open the route for KPIs, history analytics and charts, **Snapshot explorer** for every stored snapshot, and **Collection** (top bar) for run status, failures and the daily report.

The first `pnpm dev` also creates two **demo routes with mock history** (their URLs are fake; collecting them live fails, which is a handy way to see the failure diagnostics). Delete them, or run `pnpm dev:mock` to collect them with mock data.

## Language and fare switcher

- The UI is **German by default**; the `DE | EN` toggle in the header switches every screen (the choice is remembered in the browser).
- Texts the server writes itself (notifications, the weekly report, the stored alert messages) use `CRUISE_LANGUAGE` (`de` or `en`, default `de`); notifications can override it with `"language"` in `data/notifications.json`. The intelligence and report endpoints accept `?lang=de|en`.
- On a route page the **Fare** and **Cabin** selectors (e.g. `CLASSIC`, `PREMIUM ALL IN`) switch the whole view: KPIs, recommendation, insight, forecast, savings and all charts are recalculated on the trip total of that fare (and cabin). "All fares (cheapest)" restores the headline view.
- **Favorite:** with *Set as favorite* the current fare and cabin are saved on the route (stored in `data/routes/<id>.json`, `PUT /api/routes/:id/favorite`). The route page then opens with that fare and cabin selected; *Remove favorite* clears it. The selection can still be changed freely. The **overview**, rankings and weekly report use the favorite too: a route with a favorite is shown with its price, trend, forecast, recommendation, insight and deal score for that fare and cabin (marked with ★). If the favorite is no longer offered, the route falls back to the cheapest cabin. The fare comparison and deal finder still cover every fare.

## Adding a route by searching the cruise line

In the *Add* form, **Search the cruise line** opens a search over what AIDA or Mein Schiff offers: by destination, port or ship (all words must match, umlauts and case do not matter) and departure dates. Every result shows the ship, start and end with weekdays, nights, the ports and the advertised price per person; **Pick** fills in the name (title, ship, departure), the URL (for AIDA the journey page with two adults) and the cruise line, and you add the route as usual.

- AIDA is read through AIDA's own search (the one its website uses) in a visible browser window, which takes up to about half a minute; Mein Schiff is read headless from its trip list, about ten seconds. Only the public offer list is read; nothing is booked and nobody logs in.
- Mein Schiff lists thousands of trips and loads them as you scroll, so at most the first 150 in the chosen period are read: set departure dates to search further ahead.
- **Cache:** what the website showed is kept for 12 hours (`data/cache/route-search/`, deletable at any time), so the next search, with other words or dates, is instant and does not open the website. A cached answer needs no browser and no lock; the dialog says when the website was last read and has **Read the website again** (`&refresh=1`). Mein Schiff is cached per period; AIDA once for all offers.
- A search takes the collector lock, like a collection: never two browsers on the sites at once (the API answers 409 while one runs). `GET /api/route-search?provider=aida&query=kanaren&from=2027-03-01&to=2027-03-31&limit=40`.
- Try it from the command line: `pnpm --filter @cruise/collector try-search aida kanaren 2027-03-01 2027-03-31`. In `COLLECTOR_MODE=mock` the search answers from a small fixed catalogue without a browser. If a site changes, the parsers are in `collector/playwright/src/search/`; `pnpm test:live` checks them against the real sites.

## Route itinerary and cabin groups

- **Itinerary and map:** the route page has a **route map** button that opens a popup with the ports in order (local arrival and departure times, sea days marked). The collector reads the itinerary with every price run (`data/itineraries/<routeId>.json`, `GET /api/routes/:id/itinerary`) and overwrites it only when the provider's data changed. The map uses OpenStreetMap tiles, which your browser requests **only when the map is opened**. Until a route has an itinerary the page says "Itinerary not collected yet". Routes collected weekly (far-away cruises) and routes already priced today get their itinerary at the next run that actually collects them (or via **Collect anyway**).
- **Cabin group view:** the price differences between a provider's cabin cards inside a group (the optional `subcategory` of a cabin; null for every provider card today).

## Deal intelligence (0.6)

Everything is calculated on the **trip total** (cruise + flight + fees) and explained; nothing is a black box and no language model is involved.

- **Deal finder** (`/deals`): every cabin and fare of every route, filtered by provider, route, ship, cabin category (or group), fare type, departure month, duration, maximum budget and "below the historical average", ranked by *cheapest*, *best value* (fare value score), *best forecast* (expected saving by waiting) or *biggest recent price drop*. Quick searches answer "balconies under 3.000 € including flights" and "suites below the historical average". Filtering is done in the browser on the analysis, so it is instant.
- **Fare value score** (0-100, per fare within its cabin): 35% price difference, 20% included benefits, 15% historical pricing, 10% forecast, 10% flexibility, 10% availability. 90+ excellent, 75-89 good, 60-74 neutral, below 60 poor value. One fare per cabin is marked ★ recommended.
- **Upgrade analyzer**: for every fare, each step up a cabin group (inside, ocean view, balcony, junior suite, suite): cost, percentage, upgrade score and value (what the upgrade has usually cost minus today's price) and a verdict (recommended / worth considering / not worth it). An upgrade of at most 5% is always recommended. *Best upgrade opportunity* is on the overview.
- **Last-minute intelligence and booking window** (on every route page): price around 180/120/90/60/30/14/7 days before departure, when the lowest prices occurred (e.g. "11-18 days before departure"), average price drop and rise, stability, and the recommended booking window in days before departure (`recommendedBookingWindow: {from, to}`).
- **Recommendation engine 2.0**: `BUY_NOW`, `LIKELY_GOOD`, `WAIT`, `WAIT_FOR_DROP`, `MONITOR`, `AVOID` from the price position, the forecast, volatility, the fare value score and the upgrade score. **Every recommendation carries its explanation** (`reason` plus the `explanation` lines: price position, forecast, volatility, fare value, upgrade, number of snapshots) and the factors it is based on.
- **Deal score** (0-100) = mean of historical position, forecast opportunity, price trend and, where they exist, fare value and upgrade value. It ranks the routes (*Top opportunities*) and colours the **deal heatmap** (`/heatmap`: routes against cabin groups; strong ≥ 65, neutral 45-64, poor < 45, always written out as well as coloured).
- **Cruise Copilot** (`/copilot`, `POST /api/copilot`): five kinds of questions in English or German ("Which cruise is my best deal?", "Is PREMIUM worth the surcharge?", "Should I book now?", "When was this route historically cheapest?", "Which balcony offer is best under 3.500 €?") answered with a recommendation, reasoning, confidence and supporting metrics. It understands questions by keyword rules over the analysis; a question it cannot place gets example questions instead of an invented answer.
- **Advanced forecast dashboard** (forecast page): current price, 30-day forecast and potential saving, expected price range, savings projection, confidence by horizon, forecast accuracy and the recommendation timeline.
- **Deal reports**: daily, weekly and monthly, as JSON, CSV and PDF (best deals, top price drops, best fares, best upgrades, forecast summary, recommendations). Overview buttons, `pnpm --filter @cruise/collector report:weekly [daily|weekly|monthly]`, or the scheduler (`DAILY_REPORT_CRON` default `30 7 * * *`, `WEEKLY_REPORT_CRON` `0 8 * * 1`, `MONTHLY_REPORT_CRON` `0 9 1 * *`). Files: `data/reports/<kind>/<kind>-<date>.*`; `GET/POST /api/reports/deals`.
- **Historical intelligence dataset** (`data/intelligence/<routeId>.json`, rewritten after every collection, `GET /api/routes/:id/dataset`): historical lows and highs per cabin and fare, booking window statistics, fare statistics, deal score history and recommendation history. It is derived from the snapshots and can always be rebuilt.

The success metrics of the brief (forecast accuracy > 75%, recommendation accuracy > 85%, alert precision > 90%) are *targets*: the platform measures forecast and recommendation accuracy by walk-forward backtests (forecast page, reports) and reports "not yet measurable" until there is enough history. Response time (< 3 s) is covered by tests: filtering 2.400 offers takes milliseconds, and analysing 12 routes with 40 collections plus a copilot question takes well under three seconds.

## Fares (0.4)

Every collection stores every cabin x fare, always as **cruise + flight = trip total** (2 adults, flights from FRA). The trip total is the largest number on every screen, and **everything is ranked, forecast, alerted and scored on it**, never on the cruise price alone: a cheap fare with an expensive flight can cost more than a dearer fare with a cheap flight, and the app treats it that way. Per-person and total prices for cruise, flight and trip are stored together; mandatory fees are part of the model (0 today: neither provider shows a separate mandatory charge).

- **Fares page** (`/routes/:id/fares`): cheapest, most expensive, best-value fare and largest saving per cabin; fares compared with difference, percentage and savings; **what the extra money buys** (extra cost and benefits); the **cabin x fare matrix** (sort by cabin, total price, fare or savings); fare evolution chart, outlook per fare ("PREMIUM likely drops 8%") and a **fare against another fare over time**.
- **Deal finder** (`/deals`): top deals, best value, lowest total price, lowest flight cost, best balcony and best suite offer across all routes. Deal score 0-100 = (position in its own history + forecast opportunity + current discount) / 3; the best fare is chosen by trip total (50%), forecast (20%), services (20%) and flexibility (10%).
- **Alerts**: on the Alerts page choose a cabin and optionally a fare for a new low, a drop or a target. Every rule compares the **trip total**; every alert says cruise + flight = total.
- **Weekly report** adds an executive deal summary (best deal, best balcony, best suite, biggest drop, best fare) to the JSON and PDF, plus `weekly-<date>-deals.csv`.

What the sites offer (checked live): **AIDA** CLASSIC, PREMIUM and COMFORT ALL IN per cabin, plus the ALL IN upgrades of CLASSIC and PREMIUM (priced in the next booking step); not every fare is offered for every cabin. **Mein Schiff** PRO, PLUS and PUR (PUR is often unavailable). Fares such as AIDA "VARIO" only appear if a sailing offers them.

**Unknown stays unknown.** AIDA lists only what a fare includes, so a service missing from a list is *unknown*, never "not included"; Mein Schiff marks services with a tick or a cross, and an icon the collector does not recognise is unknown too. Refundability and "specific cabin selectable" are only set when the site's own wording says so, otherwise they show as unknown. Snapshots collected before 0.4 show **fare: unknown**; they are never rewritten.

A collection now takes longer: Mein Schiff a few seconds, **AIDA about a minute per route** (a visible browser window walks through each cabin's fare step). Gaps (a fare that could not be read) are stored as warnings on the snapshot and shown in the explorer.

## Booking intelligence (0.3)

- **Overview** (`/`): best booking opportunities, highest savings potential, 30-day forecast summary, top-10 deal ranking, volatility/stability rankings, provider scorecard and the weekly report.
- **Route page**: a BUY / WAIT / MONITOR recommendation with a confidence, a plain-language insight, forecast (7 / 30 / 60 days) and savings analytics. **Forecast and charts** adds five charts (history + forecast, 95% confidence band, forecast accuracy, recommendation timeline, savings projection), each with CSV/PNG export.
- **Alerts** (`/alerts`): new historical low, 5/10/15/20% drop, target trip total, per cabin group (Inside, Ocean View, Balcony, Junior Suite, Suite). Evaluated after every collection on the trip total. A target alert fires once when the price *crosses* the target. (Targets you set before 0.4 were cruise prices; they now mean trip totals, so review them.)
- **Weekly report**: `pnpm --filter @cruise/collector report:weekly`, the Overview button, or every Monday 08:00 with the scheduler. Written to `data/reports/weekly/` as JSON, CSV and PDF. Daily and monthly deal reports work the same way (see *Deal intelligence*).

Forecasts are a linear trend over the last 60 days: a statistical extrapolation, not a promise. Accuracy is measured by walk-forward backtests and shown as "not yet measurable" until there is enough history (about 40 days). Recommendation and forecast quality targets can only be judged once real history has accumulated; the demo data is synthetic.

### Notifications

Off until configured. Put credentials in `data/notifications.json` (git-ignored, never served by the API) or environment variables, then use **Send test** on the Alerts page:

```json
{
  "email":    { "smtpUrl": "smtps://user:pass@smtp.example.com", "from": "me@example.com", "to": "me@example.com" },
  "teams":    { "webhookUrl": "https://..." },
  "telegram": { "botToken": "123:abc", "chatId": "42" },
  "pushover": { "appToken": "...", "userKey": "..." },
  "retry":    { "attempts": 3, "baseDelayMs": 1000 }
}
```

Environment overrides: `SMTP_URL`, `SMTP_FROM`, `SMTP_TO`, `TEAMS_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `PUSHOVER_TOKEN`, `PUSHOVER_USER`. Failed sends are retried with exponential backoff (only for errors that can heal: network, 5xx, 429). Alerts from mock data are recorded but never sent.

## Automatic collection

```bash
pnpm schedule                        # node-cron, default 0 7 * * * (daily; COLLECT_CRON to change)
ENABLE_SCHEDULER=1 pnpm dev          # or run the scheduler inside the API process
pnpm collect                         # one run now, exits non-zero if any route failed
```

**How often a route is collected:** a route is collected at most once a day. A cruise that leaves in **more than six months** changes little, so it is collected **at most once a week** (the seventh day after the last real price) and is left out of the general collection (scheduler, `pnpm collect`, "Collect all") until then. Collecting such a route by hand ("Collect now") before that day is refused with the last and the next possible day, like the once-a-day refusal. The error offers **Collect anyway** (`POST /api/routes/:id/collect?force=1`), which lifts the weekly limit for that one collection; the daily limit and "Collect all" are never affected. In the route list such cruises carry the mark **collected weekly**. Only real (live) prices count; failed attempts, manual and mock snapshots do not. The departure date is the one of the newest snapshot; a route that has none yet is collected daily until it has one.

Runs never overlap (`data/collector.lock`). Because AIDA needs a visible browser window, the machine must be awake and logged in.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm dev:mock` | Seed demo data if empty, then API + frontend (live / mock collectors) |
| `pnpm collect` / `pnpm schedule` | Collect all routes once / on a schedule (also schedules the weekly report) |
| `pnpm --filter @cruise/collector try-live <url>` | Collect one URL into a temp dir and print the result (selector debugging) |
| `pnpm test` / `pnpm test:coverage` | Vitest unit + integration tests / with the 80% coverage gate |
| `pnpm test:e2e` | Playwright e2e on a throwaway data dir with mock collectors |
| `pnpm test:live` | Opt-in: collects the real AIDA and Mein Schiff pages (needs network; not for CI) |
| `pnpm typecheck` / `pnpm build` / `pnpm run ci` | Type check / production build / typecheck + coverage + build |

Data lives in `data/` (override with an **absolute** `CRUISE_DATA_DIR`). Provider site changes: [docs/selector-maintenance.md](docs/selector-maintenance.md).

## Cruise line logos

The route list, the route page and the deal finder show the mark of the cruise line (AIDA: the lips; Mein Schiff / TUI Cruises: the smile with the dot, without lettering). The SVGs are embedded as base64 data URIs in `apps/frontend/src/assets/providerLogos.ts`, so there are no image files to deploy; to change one, replace the SVG source string there. The logos belong to their owners.

## Hosting

Runs on a small VPS with Docker (Caddy with HTTPS in front; the app has its own login page, optionally with an authenticator code): see [docs/deployment.md](docs/deployment.md). Shared web hosting (e.g. all-inkl) cannot run it: it needs a long-running Node process and Chromium.

## Troubleshooting

If `pnpm` fails with `Cannot find matching keyid` (an outdated corepack), run with `COREPACK_INTEGRITY_KEYS=0` or update corepack.
