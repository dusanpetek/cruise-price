import { expect, test, type Page } from '@playwright/test';

// The suite below runs in English; a fresh browser context (no stored preference) shows the German default.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('cruise-ui')) localStorage.setItem('cruise-ui', JSON.stringify({ state: { language: 'en' }, version: 0 }));
  });
});

const demo = /^Demo: Mediterranean/;
/** The routes list in the sidebar; route names also appear in dashboard widgets, so scope to it. */
const sidebar = (page: Page) => page.getByRole('region', { name: 'Routes' });
const openDemo = async (page: Page) => {
  await page.goto('/');
  await sidebar(page).getByRole('link', { name: demo }).click();
  await expect(page.getByRole('heading', { name: demo })).toBeVisible();
  await expect(page.getByTestId('kpi-current')).toBeVisible(); // history loaded
};

test('collection dashboard starts empty and lists the routes', async ({ page }) => {
  await page.goto('/collection');
  await expect(page.getByRole('heading', { name: 'Collection', exact: true })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: demo })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: /^Demo: Norwegian/ })).toBeVisible();
  await expect(page.getByTestId('widget-last-collection')).toContainText('Never');
  await expect(page.getByTestId('widget-success-rate')).toContainText('n/a');
  for (const w of ['routes-processed', 'failed-routes', 'last-failure']) await expect(page.getByTestId(`widget-${w}`)).toBeVisible();
});

test('route can be added, edited and deleted, and survives reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Name').fill('E2E Route');
  await page.getByLabel('URL').fill('https://aida.de/e2e');
  await page.getByRole('button', { name: 'Add route' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Route' })).toBeVisible();

  await page.reload();
  await expect(sidebar(page).getByRole('link', { name: /^E2E Route/ })).toBeVisible();

  await page.getByRole('button', { name: 'Edit E2E Route' }).click();
  await page.getByLabel('Name').fill('E2E Renamed');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(sidebar(page).getByRole('link', { name: /^E2E Renamed/ })).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete E2E Renamed' }).click();
  await expect(sidebar(page).getByRole('link', { name: /^E2E Renamed/ })).toHaveCount(0);
});

test('route page shows price KPIs and the history analytics', async ({ page }) => {
  await openDemo(page);
  for (const id of ['current', 'lowest', 'highest', 'savings', 'trend']) await expect(page.getByTestId(`kpi-${id}`)).toBeVisible();
  for (const id of ['best', 'worst', 'days-since-low', 'since-first', '30d']) await expect(page.getByTestId(`hist-${id}`)).toBeVisible();
  await expect(page.getByTestId('hist-30d')).not.toContainText('n/a'); // 90 days of seeded history
});

test('execute a collection: snapshot, run record and dashboard update', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Collect now' }).click();
  await expect(page.getByRole('button', { name: 'Collect now' })).toBeEnabled();

  await page.getByRole('link', { name: 'Collection', exact: true }).click();
  await expect(page).toHaveURL(/\/collection$/);
  await expect(page.getByTestId('widget-last-collection')).not.toContainText('Never');
  await expect(page.getByTestId('widget-success-rate')).toContainText('100%');
  await expect(page.getByTestId('widget-routes-processed')).toContainText('1');
  await expect(page.getByTestId('run-row').first()).toContainText('Demo: Mediterranean');
  await expect(page.getByTestId('daily-report')).toContainText('1 collections');
});

test('manual snapshots update the dashboard', async ({ page }) => {
  await openDemo(page);
  await page.getByLabel('Package €', { exact: true }).fill('1');
  await page.getByLabel('Flight €', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Add manual' }).click();
  // the headline is the total (1 + 2), always with its cruise and flight parts
  await expect(page.getByTestId('kpi-lowest')).toContainText('€3');
  await expect(page.getByTestId('kpi-current')).toContainText('Cruise €1 + Flight €2');
});

test('snapshot explorer lists history and expands cabin prices', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('link', { name: 'Snapshot explorer' }).click();
  await expect(page).toHaveURL(/\/routes\/[^/]+\/snapshots$/);
  await expect(page.getByRole('heading', { name: 'Snapshot explorer' })).toBeVisible();
  await expect(page.getByTestId('snapshot-row').first()).toBeVisible();
  expect(await page.getByTestId('snapshot-row').count()).toBeGreaterThan(5);

  // The newest row may be a manual snapshot (no cabin data), so expand a collected one.
  await page.getByTestId('snapshot-row').filter({ hasText: 'mock' }).first().getByRole('button').click();
  const detail = page.getByTestId('snapshot-detail');
  await expect(detail).toContainText('Innenkabine');
  await expect(detail).toContainText('Balkonkabine');
  await expect(detail).toContainText('flights from FRA');
  await expect(detail).toContainText('PREMIUM ALL IN'); // every fare of every cabin is stored
  await expect(detail.locator('thead')).toContainText(/Cruise.*Flight.*Total/);
});

test('charts: trip total history by default, cruise and flight history on request', async ({ page }) => {
  await openDemo(page);
  for (const id of ['trip', 'cabins', 'band']) {
    await expect(page.getByTestId(`chart-${id}`).locator('svg.recharts-surface').first()).toBeVisible();
  }
  await expect(page.getByTestId('chart-trip')).toContainText('Trip total history');
  await expect(page.getByTestId('chart-cruise')).toHaveCount(0); // optional
  await expect(page.getByTestId('chart-flight')).toHaveCount(0);

  await page.getByLabel('Show cruise price history').check();
  await page.getByLabel('Show flight price history').check();
  for (const id of ['cruise', 'flight']) await expect(page.getByTestId(`chart-${id}`).locator('svg.recharts-surface').first()).toBeVisible();

  await page.getByRole('button', { name: '30 days' }).click();
  await expect(page.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Cabin category').selectOption('Balkonkabine');
  await expect(page.getByTestId('chart-trip')).toContainText('Balkonkabine');
  await expect(page.getByTestId('chart-trip').locator('svg.recharts-surface').first()).toBeVisible();
  await expect(page.getByTestId('chart-trip').getByRole('img').first()).toHaveAccessibleName(/Trip total \(cruise plus flight\)/);
});

test('the route page leads with the trip total and shows best fare and best cabin as cruise + flight = total', async ({ page }) => {
  await openDemo(page);
  // an earlier test added a manual snapshot (no fare data) as the newest; collect so fares exist
  await page.getByRole('button', { name: 'Collect now' }).click();
  await expect(page.getByRole('button', { name: 'Collect now' })).toBeEnabled();
  const current = page.getByTestId('kpi-current');
  await expect(current).toContainText('Current trip total');
  await expect(current).toContainText(/Cruise .* \+ Flight /);
  for (const id of ['kpi-lowest', 'kpi-highest']) await expect(page.getByTestId(id)).toContainText('trip total', { ignoreCase: true });
  await expect(page.getByTestId('kpi-savings')).toContainText('Potential savings');
  for (const id of ['kpi-best-fare', 'kpi-best-cabin']) {
    await expect(page.getByTestId(id).getByTestId('price-parts')).toContainText(/Cruise .* \+ Flight /);
    await expect(page.getByTestId(id)).toContainText(/Score \d+\/100/);
  }
  // the headline number is the total: current trip total = cruise + flight as shown beneath it
  const total = Number((await current.locator('.text-2xl').innerText()).replace(/[^\d]/g, ''));
  const [, cruise, flight] = (await current.innerText()).replace(/,/g, '').match(/Cruise €(\d+)\s\+\sFlight €(\d+)/)!.map(Number) as [number, number, number];
  expect(total).toBe(cruise + flight);
});


test('dark mode toggles the theme class', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  await page.getByRole('button', { name: /Theme/ }).click(); // system -> light
  await expect(html).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: /Theme/ }).click(); // light -> dark
  await expect(html).toHaveClass(/dark/);
});

// ---- Release 0.3: booking intelligence ----

test('overview shows the intelligence widgets for every route', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Booking intelligence' })).toBeVisible();
  for (const w of ['opportunities', 'savings', 'forecast', 'ranking', 'upgrade', 'volatility', 'providers', 'reports']) {
    await expect(page.getByTestId(`widget-${w}`)).toBeVisible();
  }
  await expect(page.getByTestId('widget-ranking').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByTestId('widget-savings').locator('tbody tr')).toHaveCount(2);
  await expect(page.getByTestId('widget-forecast').getByRole('listitem').first()).toContainText('confidence');
  await expect(page.getByTestId('widget-providers')).toContainText('AIDA');
  await expect(page.getByTestId('widget-providers')).toContainText('Mein Schiff');
});

test('every route gets a recommendation with a confidence and an insight', async ({ page }) => {
  await openDemo(page);
  const card = page.getByTestId('intelligence-card');
  await expect(card).toContainText(/(BUY NOW|LIKELY GOOD|WAIT FOR DROP|WAIT|MONITOR|AVOID)\s*·\s*\d+%/);
  await expect(page.getByTestId('insight')).toContainText('Recommendation:');
  await expect(page.getByTestId('forecast-line')).toContainText('30 days');
  await expect(page.getByTestId('savings-line')).toContainText('volatility');
});

test('forecast page renders the five charts, filters by cabin and exports data', async ({ page }) => {
  await openDemo(page);
  // A manual snapshot from an earlier test has no cabin data and is the newest; collect so the per-cabin analysis has something to show.
  await page.getByRole('button', { name: 'Collect now' }).click();
  await expect(page.getByRole('button', { name: 'Collect now' })).toBeEnabled();
  await page.getByRole('link', { name: 'Forecast and charts' }).click();
  await expect(page).toHaveURL(/\/routes\/[^/]+\/forecast$/);
  await expect(page.getByTestId('recommendation-card')).toContainText(/BUY NOW|LIKELY GOOD|WAIT|MONITOR|AVOID/);
  await expect(page.getByTestId('forecast-numbers')).toContainText('In 30 days');
  for (const id of ['forecast', 'confidence', 'accuracy', 'timeline', 'projection', 'range', 'forecast-confidence']) {
    await expect(page.getByTestId(`chart-${id}`).locator('svg.recharts-surface').first()).toBeVisible();
    await expect(page.getByTestId(`chart-${id}`).getByRole('img').first()).toBeVisible(); // described for screen readers
  }
  await expect(page.getByTestId('chart-accuracy')).toContainText('direction correct');

  await page.getByLabel('Cabin category').selectOption('Balkonkabine');
  await expect(page.getByTestId('chart-forecast')).toContainText('Balkonkabine');
  await expect(page.getByTestId('chart-projection')).toContainText('Balkonkabine');
  await expect(page.getByTestId('group-table')).toContainText('Balcony');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Savings projection', exact: false }).filter({ hasText: 'CSV' }).click();
  expect((await download).suggestedFilename()).toBe('savings-projection.csv');
});

test('alert center: rules, a collection that triggers an alert, filtering and acknowledging', async ({ page }) => {
  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'Alert center' })).toBeVisible();
  await expect(page.getByTestId('rule-row')).toHaveCount(2); // defaults: new historical low, 10% drop

  await page.getByLabel('Target trip total (€, cruise + flight)').fill('5000');
  await page.getByLabel('Route', { exact: true }).selectOption({ label: 'Demo: Mediterranean (AIDA, mock data)' });
  await page.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.getByTestId('rule-row')).toHaveCount(3);

  // The target alert fires when the price crosses it: put the price above the target first, then collect (mock price is well below).
  await openDemo(page);
  await page.getByLabel('Package €', { exact: true }).fill('99999');
  await page.getByRole('button', { name: 'Add manual' }).click();
  await expect(page.getByTestId('kpi-current')).toContainText('99,999');
  await page.getByRole('button', { name: 'Collect now' }).click();
  await expect(page.getByRole('button', { name: 'Collect now' })).toBeEnabled();

  await page.getByRole('link', { name: /Alerts/ }).click();
  const row = page.getByTestId('alert-row').filter({ hasText: 'Target price reached' }).first();
  await expect(row).toContainText('Demo: Mediterranean');
  await expect(row).toContainText(/Trip total: .* \(cruise .* \+ flight .*\)/); // alerts always say what the whole trip costs
  await expect(row).toContainText('new');
  await expect(page.getByRole('navigation', { name: 'Main' })).toContainText(/\d+ new|\d/);

  const filters = page.getByRole('group', { name: 'Alert filters' });
  await filters.getByLabel('Alert type').selectOption('PERCENT_DROP');
  await expect(page.getByTestId('alert-row').filter({ hasText: 'Target price reached' })).toHaveCount(0);
  await filters.getByLabel('Alert type').selectOption('TARGET_PRICE');
  await filters.getByLabel('Provider').selectOption('mein-schiff');
  await expect(page.getByTestId('alert-row')).toHaveCount(0);
  await filters.getByLabel('Provider').selectOption('');

  await page.getByTestId('alert-row').filter({ hasText: 'Target price reached' }).first().getByRole('button', { name: /Acknowledge/ }).click();
  await expect(page.getByTestId('alert-row').filter({ hasText: 'Target price reached' }).first()).toContainText('acknowledged');

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Delete rule: Cheapest cabin: trip total reaches 5000/ }).click();
  await expect(page.getByTestId('rule-row')).toHaveCount(2);
});

test('notification channels stay off until configured, and cannot be tested', async ({ page }) => {
  await page.goto('/alerts');
  const rows = page.getByTestId('channel-row');
  await expect(rows).toHaveCount(4);
  for (const name of ['Email (SMTP)', 'Microsoft Teams', 'Telegram', 'Pushover']) await expect(page.getByTestId('channels-panel')).toContainText(name);
  await expect(page.getByTestId('channels-panel')).toContainText('not configured');
  for (const send of await rows.getByRole('button', { name: 'Send test' }).all()) await expect(send).toBeDisabled();
});

test('weekly report can be generated and downloaded', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('generate-weekly').click();
  const links = page.getByTestId('widget-reports').getByRole('link');
  await expect(links.filter({ hasText: /weekly-.*\.json/ })).toBeVisible();
  await expect(links.filter({ hasText: /weekly-\d{4}-\d{2}-\d{2}\.csv/ })).toBeVisible();
  await expect(links.filter({ hasText: /weekly-.*\.pdf/ })).toBeVisible();

  const csv = await page.request.get(await links.filter({ hasText: /weekly-\d{4}-\d{2}-\d{2}\.csv/ }).getAttribute('href').then((h) => h!));
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('route,provider,current');
  const pdf = await page.request.get(await links.filter({ hasText: /\.pdf/ }).getAttribute('href').then((h) => h!));
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
});

// ---- Release 0.4: fares ----

/** Opens the fare page of the demo route and waits until it is really there (the route page has a chart filter with the same label). */
const openFares = async (page: Page) => {
  await openDemo(page);
  await page.getByRole('link', { name: 'Fares', exact: true }).click();
  await expect(page).toHaveURL(/\/routes\/[^/]+\/fares$/);
  await expect(page.getByTestId('fare-comparison')).toBeVisible();
};

const money = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n).replace(/\u00a0/g, ' ');

test('fare page compares fares within a cabin, always as cruise + flight = total', async ({ page }) => {
  await openFares(page);

  await page.getByLabel('Cabin category').selectOption('Balkonkabine');
  const rows = page.getByTestId('fare-row');
  await expect(rows).toHaveCount(3); // CLASSIC, PREMIUM, PREMIUM ALL IN
  await expect(rows.first()).toContainText('CLASSIC');
  await expect(rows.first()).toContainText('cheapest');
  await expect(rows.nth(1)).toContainText('PREMIUM');
  await expect(rows.nth(1)).toContainText(/\+\d/); // difference to the cheapest
  await expect(rows.nth(1)).toContainText('%');

  // the table headers and every row carry all three prices; the total is the cell with the heaviest type
  await expect(page.getByTestId('fare-comparison').locator('thead')).toContainText(/Cruise.*Flight.*Total/);
  await expect(page.getByTestId('fare-comparison').getByTestId('price-total')).toHaveCount(3);

  for (const id of ['fare-cheapest', 'fare-most-expensive', 'fare-best-value', 'fare-largest-saving']) await expect(page.getByTestId(id)).toBeVisible();
  for (const id of ['fare-cheapest', 'fare-most-expensive', 'fare-best-value']) {
    await expect(page.getByTestId(id).getByTestId('price-parts')).toContainText(/Cruise .* \+ Flight /);
  }
  await expect(page.getByTestId('fare-largest-saving')).toContainText('PREMIUM ALL IN → CLASSIC');
  await expect(page.getByTestId('fare-largest-saving')).toContainText('%');
});

test('the total is cruise plus flight in every fare row', async ({ page }) => {
  await openFares(page);
  await page.getByLabel('Cabin category').selectOption('Balkonkabine');
  const cells = page.getByTestId('fare-row').first().locator('td');
  const n = async (i: number) => Number((await cells.nth(i).innerText()).replace(/[^\d]/g, ''));
  const [cruise, flight, total] = [await n(1), await n(2), await n(3)];
  expect(cruise).toBeGreaterThan(0);
  expect(flight).toBeGreaterThan(0);
  expect(total).toBe(cruise + flight);
  expect(money(total)).toBeTruthy();
});

test('services comparison shows the extra cost and keeps unlisted services unknown', async ({ page }) => {
  await openFares(page);
  await page.getByLabel('Cabin category').selectOption('Balkonkabine');
  await page.getByLabel('From').selectOption({ label: 'CLASSIC' });
  await page.getByLabel('to', { exact: true }).selectOption({ label: 'PREMIUM' });
  const panel = page.getByTestId('services-comparison');
  await expect(page.getByTestId('extra-cost')).toContainText(/Extra cost: €?\d/);
  await expect(panel).toContainText('Wunschkabine');
  // the mock AIDA fares list only what is included, so what CLASSIC does not list is unknown, never "not included"
  await expect(panel).toContainText('Listed for PREMIUM; unknown for CLASSIC');
  await expect(panel).toContainText('Specific cabin selectable: no → yes');
  await expect(panel).toContainText('Refundable: unknown → unknown');
});

test('cabin x fare matrix is sortable and every cell shows cruise, flight and total', async ({ page }) => {
  await openFares(page);
  const matrix = page.getByTestId('fare-matrix');
  await expect(matrix.getByTestId('matrix-row')).toHaveCount(3);
  await expect(matrix.locator('thead')).toContainText('CLASSIC');
  await expect(matrix.locator('thead')).toContainText('PREMIUM ALL IN');
  await expect(matrix.getByTestId('matrix-row').first().getByTestId('price-parts').first()).toContainText(/Cruise .* \+ Flight /);
  await expect(matrix).toContainText('not offered'); // PREMIUM ALL IN is not offered for the inside cabin

  await page.getByLabel('Sort by').selectOption('savings');
  await expect(matrix.getByTestId('matrix-row').first()).toContainText('Suite'); // the dearest cabin has the biggest swing
  await page.getByLabel('Sort by').selectOption('total');
  await expect(matrix.getByTestId('matrix-row').first()).toContainText('Innenkabine');
  await page.getByLabel('Sort by').selectOption('fare');
  await expect(matrix.locator('thead th').nth(1)).toContainText('CLASSIC');
});

test('fare evolution, outlook per fare, and a fare against another fare over time', async ({ page }) => {
  await openFares(page);
  await page.getByLabel('Cabin category').selectOption('Balkonkabine');
  await expect(page.getByTestId('chart-fare-evolution').locator('svg.recharts-surface').first()).toBeVisible();
  await expect(page.getByTestId('chart-fare-evolution').getByRole('img').first()).toBeVisible();
  await expect(page.getByTestId('fare-outlook').getByRole('listitem')).toHaveCount(3);
  await expect(page.getByTestId('fare-outlook')).toContainText(/(CLASSIC|PREMIUM|PREMIUM ALL IN) likely (stable|drops|rises)|not enough history/);

  await page.getByLabel('Compare', { exact: true }).selectOption({ label: 'Balkonkabine + CLASSIC' });
  await page.getByLabel('with', { exact: true }).selectOption({ label: 'Balkonkabine + PREMIUM' });
  await expect(page.getByTestId('chart-fare-duel')).toContainText('Balkonkabine + CLASSIC vs Balkonkabine + PREMIUM');
  await expect(page.getByTestId('chart-fare-duel').locator('svg.recharts-surface').first()).toBeVisible();
  await expect(page.getByTestId('duel-difference')).toContainText(/costs .*more than Balkonkabine \+ CLASSIC \(total price\)/);
});

test('deal finder ranks cabins and fares, each with cruise, flight and total', async ({ page }) => {
  await page.goto('/deals');
  await expect(page.getByRole('heading', { name: 'Deal finder' })).toBeVisible();
  const rows = page.getByTestId('deal-results').getByTestId('deal-row');
  await expect(rows.first()).toBeVisible();
  // every offer shows cruise, flight and total together, the total largest
  await expect(rows.first().getByTestId('price-total')).toBeVisible();
  await expect(rows.first().getByTestId('price-parts')).toContainText(/Cruise .* \+ Flight /);
  await expect(page.getByTestId('deal-count')).toContainText(/\d+ offers match/);
  await expect(page.getByTestId('mode-bestValue')).toHaveAttribute('aria-pressed', 'true');

  // ranking mode "cheapest": by trip total
  await page.getByTestId('mode-cheapest').click();
  await expect(page.getByTestId('mode-cheapest')).toHaveAttribute('aria-pressed', 'true');
  const totals = (await rows.getByTestId('price-total').allInnerTexts()).map((t) => Number(t.replace(/[^\d]/g, '')));
  expect(totals.length).toBeGreaterThan(3);
  expect(totals).toEqual([...totals].sort((a, b) => a - b));

  // "balcony cabins under 3.000 EUR including flights"
  await page.getByTestId('preset-balcony').click();
  await expect(page.getByLabel('Cabin category')).toHaveValue('group:balcony');
  await expect(page.getByLabel('Maximum budget (€, trip total)')).toHaveValue('3000');
  const balconies = page.getByTestId('deal-results').getByTestId('deal-row');
  const n = await balconies.count();
  for (let i = 0; i < n; i++) {
    await expect(balconies.nth(i)).toContainText(/Balkon|Balcony/);
    expect(Number((await balconies.nth(i).getByTestId('price-total').innerText()).replace(/[^\d]/g, ''))).toBeLessThanOrEqual(3000);
  }

  // a budget nobody meets
  await page.getByLabel('Maximum budget (€, trip total)').fill('10');
  await expect(page.getByTestId('deal-results')).toContainText('No offer matches these filters');
  await expect(rows).toHaveCount(0);

  // filter by fare, ship and route, then reset
  await page.getByTestId('preset-reset').click();
  const all = await rows.count();
  await page.getByLabel('Fare type').selectOption({ label: 'PREMIUM ALL IN' });
  await expect(rows.first()).toContainText('PREMIUM ALL IN');
  expect(await rows.count()).toBeLessThan(all);
  await page.getByTestId('preset-reset').click();
  await page.getByLabel('Search', { exact: true }).fill('mediterranean');
  await expect(rows.first()).toContainText('Mediterranean');
  await page.getByLabel('Search', { exact: true }).fill('');
  await page.getByLabel('Departure month').selectOption({ index: 1 });
  await expect(rows.first()).toBeVisible();

  // every offer links to its route's fares
  await page.getByTestId('preset-reset').click();
  await rows.first().getByRole('link').first().click();
  await expect(page).toHaveURL(/\/routes\/[^/]+\/fares$/);
});

test('deal finder: forecast and price drop rankings, and quick searches', async ({ page }) => {
  await page.goto('/deals');
  await page.getByTestId('mode-bestForecast').click();
  await expect(page.getByTestId('deal-count')).toContainText('expected saving');
  await expect(page.getByTestId('deal-forecast').first()).toBeVisible();
  await page.getByTestId('mode-biggestDrop').click();
  await expect(page.getByTestId('deal-count')).toContainText('price fall');
  await expect(page.getByTestId('deal-recent').first()).toBeVisible();
  await page.getByTestId('preset-suites').click();
  await expect(page.getByLabel('Cabin category')).toHaveValue('group:suite');
  await expect(page.getByLabel('Below the historical average')).toBeChecked();
  await page.getByTestId('preset-forecast').click();
  await expect(page.getByTestId('mode-bestForecast')).toHaveAttribute('aria-pressed', 'true');
});

test('overview highlights the cheapest fare, best value and largest saving as cruise + flight = total', async ({ page }) => {
  await page.goto('/');
  const w = page.getByTestId('widget-fares');
  await expect(w).toContainText('Cheapest fare');
  await expect(w).toContainText('Most expensive fare');
  await expect(w).toContainText('Best value fare');
  await expect(w.getByTestId('highlight-largest')).toContainText('→');
  await expect(w.getByTestId('price-parts').first()).toContainText(/Cruise .* \+ Flight /);
  // the routes' own tables show the three prices too
  await expect(page.getByTestId('widget-savings').locator('thead')).toContainText(/Cruise.*Flight.*Total/);
});

test('fare-specific alert rules: pick a cabin and a fare', async ({ page }) => {
  await page.goto('/alerts');
  await page.getByLabel('Alert type', { exact: false }).last().selectOption('NEW_LOW');
  await page.getByLabel('Cabin category').selectOption('balcony');
  await page.getByLabel('Fare').selectOption({ label: 'PREMIUM ALL IN' });
  await page.getByRole('button', { name: 'Add rule' }).click();
  const rule = page.getByTestId('rule-row').filter({ hasText: 'PREMIUM ALL IN' });
  await expect(rule).toContainText('Balcony · PREMIUM ALL IN: new historical low');
  await page.getByLabel('Alert type', { exact: false }).last().selectOption('TARGET_PRICE');
  await page.getByLabel('Fare').selectOption({ label: 'CLASSIC' });
  await expect(page.getByLabel('Target trip total (€, cruise + flight)')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await rule.getByRole('button', { name: /Delete rule/ }).click();
  await expect(page.getByTestId('rule-row').filter({ hasText: 'PREMIUM ALL IN' })).toHaveCount(0);
});

test('weekly report includes the executive deal summary', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('generate-weekly').click();
  const link = page.getByTestId('widget-reports').getByRole('link').filter({ hasText: /weekly-.*deals\.csv/ });
  await expect(link).toBeVisible();
  const csv = await (await page.request.get((await link.getAttribute('href'))!)).text();
  expect(csv.split('\n')[0]).toBe('headline,route,provider,cabin,fare,cruisePrice,flightPrice,totalPrice,dealScore,fareScore,weekChangePct');
  expect(csv).toContain('Best deal,');
  expect(csv).toContain('Best balcony,');
  expect(csv).toContain('Best suite,');
  expect(csv).toContain('Best fare,');
});

test('a route collected before fares were tracked says "fare unknown" instead of inventing one', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).getByRole('button', { name: 'Add', exact: true }).click().catch(() => undefined);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Name').fill('Manual only');
  await page.getByLabel('URL').fill('https://aida.de/manual-only');
  await page.getByRole('button', { name: 'Add route' }).click();
  await page.getByLabel('Package €', { exact: true }).fill('1500');
  await page.getByRole('button', { name: 'Add manual' }).click();
  await expect(page.getByTestId('kpi-current')).toContainText('Cruise €1,500');
  await page.getByRole('link', { name: 'Fares', exact: true }).click();
  await expect(page.getByTestId('no-fares')).toContainText('Fare: unknown');
});


test('German is the default language and the toggle switches the whole UI and survives reload', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('navigation', { name: 'Hauptmenü' }).getByRole('link', { name: 'Angebote' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DE', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Deals' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  await page.getByRole('button', { name: 'DE', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Hauptmenü' })).toBeVisible();
  await context.close();
});

test('the route page is German by default: recommendation, insight and labels', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('link', { name: demo }).first().click();
  await expect(page.getByTestId('kpi-current')).toContainText('Aktueller Reisepreis gesamt');
  await expect(page.getByTestId('insight')).toContainText('Empfehlung');
  await expect(page.getByTestId('chart-trip')).toContainText('Verlauf des Reisepreises');
  await context.close();
});

test('fare switcher: choosing a fare changes KPIs, insight and charts, and "all fares" restores the headline', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Collect now' }).click(); // make sure the newest snapshot has every fare
  await expect(page.getByRole('button', { name: 'Collect now' })).toBeEnabled();
  await page.reload(); // settle on the newest snapshot before reading the headline
  await expect(page.getByTestId('kpi-current')).toBeVisible();
  const fare = page.getByLabel('Fare', { exact: true });
  await expect(fare).toBeVisible();
  const options = await fare.locator('option').allInnerTexts();
  expect(options).toEqual(expect.arrayContaining(['All fares (cheapest)', 'CLASSIC', 'PREMIUM', 'PREMIUM ALL IN']));

  const headline = (await page.getByTestId('kpi-current').textContent())!.replace(/\s+/g, ' ').trim();
  await expect(page.getByTestId('view-label')).toContainText('all fares (cheapest)');

  await fare.selectOption({ label: 'PREMIUM ALL IN' });
  await expect(page.getByTestId('view-label')).toContainText('PREMIUM ALL IN');
  await expect(page.getByTestId('chart-trip')).toContainText('PREMIUM ALL IN');
  await expect(page.getByTestId('insight')).toContainText('PREMIUM ALL IN');
  await expect(page.getByTestId('kpi-current')).not.toHaveText(headline); // dearer fare: another trip total
  await expect(page.getByTestId('kpi-current')).toContainText(/Cruise .* \+ Flight /);

  // the cabin list is limited to the cabins that offer the fare, and a cabin can be combined with it
  await page.getByLabel('Cabin category').selectOption('Balkonkabine');
  await expect(page.getByTestId('view-label')).toContainText('PREMIUM ALL IN · Balkonkabine');
  await expect(page.getByTestId('chart-trip')).toContainText('PREMIUM ALL IN · Balkonkabine');

  await fare.selectOption({ label: 'All fares (cheapest)' });
  await page.getByLabel('Cabin category').selectOption({ index: 0 });
  await expect(page.getByTestId('kpi-current')).toHaveText(headline);
});

test('favorite fare and cabin: set per route, opens selected by default, and can be removed', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Collect now' }).click();
  await expect(page.getByRole('button', { name: 'Collect now' })).toBeEnabled();
  const fare = page.getByLabel('Fare', { exact: true });
  await expect(page.getByTestId('favorite-set')).toBeDisabled(); // nothing chosen yet
  await expect(page.getByTestId('favorite-label')).toHaveCount(0);

  await fare.selectOption({ label: 'PREMIUM ALL IN' });
  await page.getByLabel('Cabin category').selectOption('Balkonkabine');
  await page.getByTestId('favorite-set').click();
  await expect(page.getByTestId('favorite-label')).toContainText('PREMIUM ALL IN · Balkonkabine');
  await expect(page.getByTestId('favorite-set')).toBeDisabled(); // already the favorite

  // another route, then back: the favorite is selected again without touching the selects
  await sidebar(page).getByRole('link', { name: /^Demo: Norwegian/ }).click();
  await expect(page.getByRole('heading', { name: /^Demo: Norwegian/ })).toBeVisible();
  await sidebar(page).getByRole('link', { name: demo }).click();
  await expect(page.getByTestId('view-label')).toContainText('PREMIUM ALL IN · Balkonkabine');
  await expect(fare.locator('option:checked')).toHaveText('PREMIUM ALL IN');

  // it survives a reload and a language change, even when the stored view preference is gone
  await page.reload();
  await expect(page.getByTestId('view-label')).toContainText('PREMIUM ALL IN · Balkonkabine');

  // changing the view does not touch the favorite; removing it keeps the current view
  await fare.selectOption({ label: 'CLASSIC' });
  await expect(page.getByTestId('favorite-label')).toContainText('PREMIUM ALL IN · Balkonkabine');
  await page.getByTestId('favorite-clear').click();
  await expect(page.getByTestId('favorite-label')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('view-label')).toContainText('all fares (cheapest)');
});

test('snapshot explorer and fare page are fully German by default', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('link', { name: demo }).first().click();
  await expect(page.getByTestId('kpi-current')).toBeVisible();

  await page.getByRole('link', { name: 'Snapshot-Explorer' }).click();
  const snapshots = page.locator('main');
  await expect(snapshots).toContainText('Snapshots gespeichert');
  await page.getByTestId('snapshot-row').first().getByRole('button').click();
  await expect(page.getByTestId('snapshot-detail')).toBeVisible();
  for (const english of ['snapshots stored', 'Collected', 'Provider', 'Source', 'Show more', 'departs', ' nights', ' adults']) await expect(snapshots).not.toContainText(english);

  await page.getByRole('link', { name: /^← / }).click();
  await page.getByRole('link', { name: 'Tarife', exact: true }).click();
  await expect(page.getByTestId('fare-comparison')).toBeVisible();
  const fares = page.locator('main');
  await expect(fares).toContainText('Tarife im Vergleich');
  await expect(fares).toContainText('Ausblick je Tarif');
  await expect(fares).toContainText('günstigster');
  for (const english of ['fares compared', 'Outlook per fare', 'cheapest', 'Extra cost', 'Every cabin and fare', 'confidence', 'saves ', 'not offered', 'unknown']) await expect(fares).not.toContainText(english);
  await context.close();
});

test('the overview uses the favorite fare and cabin of a route when one is set', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Collect now' }).click();
  await expect(page.getByRole('button', { name: 'Collect now' })).toBeEnabled();

  await page.goto('/');
  const row = page.getByTestId('widget-savings').getByRole('row').filter({ hasText: demo }).first();
  await expect(page.getByTestId('route-focus')).toHaveCount(0);

  await sidebar(page).getByRole('link', { name: demo }).click();
  await page.getByLabel('Fare', { exact: true }).selectOption({ label: 'PREMIUM ALL IN' });
  await page.getByLabel('Cabin category').selectOption('Balkonkabine');
  await page.getByTestId('favorite-set').click();
  await expect(page.getByTestId('favorite-label')).toBeVisible();

  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByTestId('route-focus').first()).toContainText('PREMIUM ALL IN · Balkonkabine');
  await expect(row.getByTestId('route-focus')).toBeVisible();
  // the route page insight and the overview agree on the focus
  await sidebar(page).getByRole('link', { name: demo }).click();
  await expect(page.getByTestId('insight')).toContainText('PREMIUM ALL IN');
  await page.getByTestId('favorite-clear').click();
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByTestId('route-focus')).toHaveCount(0);
});

test('overview widgets never need horizontal scrolling on laptop and desktop widths', async ({ page }) => {
  for (const width of [1100, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('widget-savings')).toBeVisible();
    const overflowing = await page.locator('[data-testid^="widget-"]').evaluateAll((els) =>
      els.flatMap((el) => [el, ...el.querySelectorAll('*')]).filter((e) => e.scrollWidth > e.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)).map((e) => `${e.closest('[data-testid]')?.getAttribute('data-testid')}@${(e as HTMLElement).className.toString().slice(0, 40)}`),
    );
    expect(overflowing, `width ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `page at ${width}`).toBe(true);
  }
});

test('long route names wrap in the route list instead of being cut off', async ({ page, request }) => {
  const name = 'Eine sehr lange Reise: Kanaren mit Madeira ab Las Palmas, 7 Nächte, inklusive Flug ab Frankfurt und Premium All In';
  const created = await (await request.post('/api/routes', { data: { name, provider: 'aida', url: 'https://aida.de/finden/CO07270313/CLASSIC' } })).json();
  try {
    await page.goto('/');
    const link = sidebar(page).getByRole('link', { name: new RegExp(name.slice(0, 20)) });
    await expect(link).toBeVisible();
    const label = link.getByText(name, { exact: true });
    await expect(label).toBeVisible();
    const cut = await label.evaluate((el) => ({ clipped: el.scrollWidth > el.clientWidth + 1, ellipsis: getComputedStyle(el).textOverflow === 'ellipsis', lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) }));
    expect(cut.clipped).toBe(false);
    expect(cut.ellipsis).toBe(false);
    expect(cut.lines).toBeGreaterThan(1); // it wraps
    // the edit and delete buttons are still reachable
    await expect(sidebar(page).getByRole('button', { name: `Edit ${name}` })).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: `Delete ${name}` })).toBeVisible();
  } finally {
    await request.delete(`/api/routes/${created.id}`);
  }
});

test('the whole route card is clickable, while edit and delete keep working on their own', async ({ page }) => {
  await page.goto('/');
  const card = sidebar(page).getByRole('listitem').filter({ hasText: demo });
  const box = (await card.boundingBox())!;
  // click the empty bottom-left corner of the card, away from the name and the buttons
  await card.click({ position: { x: 6, y: box.height - 6 } });
  await expect(page.getByRole('heading', { name: demo })).toBeVisible();
  await expect(page).toHaveURL(/\/routes\/[^/]+$/);

  await page.goto('/');
  await sidebar(page).getByRole('button', { name: /^Edit Demo: Mediterranean/ }).click();
  await expect(page).toHaveURL(/localhost:5173\/$/); // the button does not navigate
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
});

// ---- Release 0.6: deal intelligence ----

test('fare value score: every fare has a score with its band, and one fare per cabin is recommended', async ({ page }) => {
  await openFares(page);
  await page.getByLabel('Cabin category').selectOption('Balkonkabine');
  const values = page.getByTestId('fare-comparison').getByTestId('fare-value');
  await expect(values).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(values.nth(i).getByTestId('value-badge')).toContainText(/\d+\s*·\s*(Excellent|Good|Neutral|Poor) value/);
  await expect(page.getByTestId('fare-comparison').getByText('★ recommended')).toHaveCount(1);
});

test('upgrade analyzer: cost, percentage, score and a verdict for every cabin step', async ({ page }) => {
  await openFares(page);
  const card = page.getByTestId('upgrade-analyzer');
  await expect(card).toBeVisible();
  const rows = card.getByTestId('upgrade-row');
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText(/Recommended upgrade|Worth considering|Not worth it/);
  await expect(rows.first()).toContainText(/Upgrade score \d+\/100/);
  await expect(rows.first()).toContainText('→');
  await expect(rows.first()).toContainText('%');
  await card.getByLabel('Fare').selectOption({ index: 1 });
  await expect(rows.first()).toBeVisible();
});

test('the overview ranks the top opportunities with their ship and shows the best upgrade', async ({ page }) => {
  await page.goto('/');
  const ranking = page.getByTestId('widget-ranking');
  await expect(ranking).toContainText('Top opportunities');
  await expect(ranking.getByTestId('opportunity-row').first()).toContainText(/Score \d+/);
  await expect(ranking.getByTestId('opportunity-row').first()).toContainText(/AIDA|Mein Schiff|Ship/);
  const best = page.getByTestId('widget-upgrade').getByTestId('best-upgrade');
  await expect(best).toContainText('→');
  await expect(best).toContainText(/Recommended upgrade|Worth considering|Not worth it/);
});

test('route page: explained recommendation, booking window and last-minute intelligence', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Collect now' }).click();
  await expect(page.getByRole('button', { name: 'Collect now' })).toBeEnabled();
  await page.reload();
  await expect(page.getByTestId('kpi-current')).toBeVisible();
  const why = page.getByTestId('explanation');
  await expect(why).toContainText('Price position');
  await expect(why).toContainText('Forecast');
  await expect(why).toContainText('Volatility');
  await expect(why).toContainText('Based on');
  const timing = page.getByTestId('timing-card');
  await expect(timing).toBeVisible();
  await expect(page.getByTestId('booking-window')).toContainText(/\d+-\d+ days before departure/);
  await expect(page.getByTestId('lowest-window')).toContainText(/Historical lowest prices occurred \d+-\d+ days before departure/);
  await expect(page.getByTestId('timing-marks').getByRole('listitem')).toHaveCount(7);
  for (const label of ['Average price drop', 'Average price rise', 'Best timing window', 'Price stability']) await expect(page.getByTestId('timing-metrics')).toContainText(label);
});

test('forecast page: advanced dashboard with current price, 30-day forecast, potential saving, price range and confidence', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('link', { name: 'Forecast and charts' }).click();
  const card = page.getByTestId('forecast-summary-card');
  await expect(card).toContainText('Current');
  await expect(card).toContainText('Forecast 30 days');
  await expect(page.getByTestId('potential-saving')).toContainText(/Potential saving|Expected extra cost/);
  for (const id of ['range', 'forecast-confidence']) {
    await expect(page.getByTestId(`chart-${id}`).locator('svg.recharts-surface').first()).toBeVisible();
    await expect(page.getByTestId(`chart-${id}`).getByRole('img').first()).toBeVisible();
  }
  await expect(page.getByTestId('chart-range')).toContainText('Expected price range');
  await expect(page.getByTestId('explanation')).toContainText('Price position');
});

test('deal heatmap: every route against the cabin groups, strong / neutral / poor with text and links', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Heatmap' }).click();
  await expect(page.getByRole('heading', { name: 'Deal heatmap' })).toBeVisible();
  await expect(page.getByTestId('heat-legend')).toContainText('Strong deal');
  await expect(page.getByTestId('heat-legend')).toContainText('Poor deal');
  const cells = page.getByTestId('heat-cell');
  await expect(cells.first()).toBeVisible();
  expect(await cells.count()).toBeGreaterThan(3);
  for (const level of await cells.evaluateAll((els) => els.map((e) => e.getAttribute('data-level')))) expect(['strong', 'neutral', 'poor']).toContain(level);
  await expect(cells.first()).toContainText(/Strong deal|Neutral|Poor deal/); // the level is written out, not only coloured
  await expect(cells.first()).toHaveAttribute('aria-label', /Deal score \d+/);
  await expect(page.getByTestId('heatmap').locator('thead')).toContainText('Balcony');
  await cells.first().click();
  await expect(page).toHaveURL(/\/routes\/[^/]+$/);
});

test('cruise copilot: answers the five typical questions with recommendation, reasoning, confidence and metrics', async ({ page }) => {
  await page.goto('/copilot');
  await expect(page.getByRole('heading', { name: 'Cruise Copilot' })).toBeVisible();
  const examples = page.getByTestId('copilot-example');
  await expect(examples).toHaveCount(5);

  await examples.nth(0).click(); // best deal
  const answer = page.getByTestId('copilot-turn').first();
  await expect(answer.getByTestId('copilot-recommendation')).toContainText(/Best deal right now: .* \(cruise .* \+ flight .*\)\./);
  await expect(answer.getByTestId('copilot-reasoning')).toContainText('Deal score');
  await expect(answer.getByTestId('copilot-confidence')).toContainText(/\d+%/);
  await expect(answer.getByTestId('copilot-metrics')).toContainText('Trip total');
  await expect(answer.getByTestId('copilot-deals').getByRole('listitem').first()).toContainText('(Cruise');

  await examples.nth(1).click(); // is PREMIUM worth the surcharge
  await expect(page.getByTestId('copilot-turn').first().getByTestId('copilot-recommendation')).toContainText(/^(Yes|No|It is a close call|PREMIUM)/);
  await expect(page.getByTestId('copilot-turn').first().getByTestId('copilot-metrics')).toContainText('Surcharge');

  await examples.nth(2).click(); // book now
  await expect(page.getByTestId('copilot-turn').first().getByTestId('copilot-recommendation')).toContainText(/^Recommendation for .*: (BUY NOW|LIKELY GOOD|WAIT FOR DROP|WAIT|MONITOR|AVOID)\./);
  await expect(page.getByTestId('copilot-turn').first().getByTestId('copilot-reasoning')).toContainText('Price position');

  await examples.nth(3).click(); // when was it cheapest
  await expect(page.getByTestId('copilot-turn').first().getByTestId('copilot-recommendation')).toContainText(/The lowest trip total of .* was .* days before departure\./);

  await examples.nth(4).click(); // balcony under budget
  await expect(page.getByTestId('copilot-turn').first().getByTestId('copilot-answer')).toHaveAttribute('data-intent', 'best_under_budget');
  await expect(page.getByTestId('copilot-turn')).toHaveCount(5);
});

test('cruise copilot: free text, German questions, unknown questions and an empty input', async ({ page }) => {
  await page.goto('/copilot');
  await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled();
  await page.getByLabel('Your question').fill('Tell me a joke');
  await page.getByRole('button', { name: 'Ask' }).click();
  const first = page.getByTestId('copilot-turn').first();
  await expect(first.getByTestId('copilot-recommendation')).toContainText('I could not match this question');
  await expect(first).toContainText('Is PREMIUM worth the surcharge?'); // suggestions
  await expect(page.getByLabel('Your question')).toHaveValue('');

  await page.getByLabel('Your question').fill('Should I book the Mediterranean now?');
  await page.getByLabel('Your question').press('Enter');
  await expect(page.getByTestId('copilot-turn').first().getByTestId('copilot-recommendation')).toContainText('Mediterranean');
});

test('cruise copilot answers in German by default', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.goto('/copilot');
  await expect(page.getByRole('heading', { name: 'Kreuzfahrt-Copilot' })).toBeVisible();
  await page.getByTestId('copilot-example').nth(2).click(); // Soll ich jetzt buchen?
  const a = page.getByTestId('copilot-turn').first();
  await expect(a.getByTestId('copilot-recommendation')).toContainText(/^Empfehlung für .*: /);
  await expect(a.getByTestId('copilot-reasoning')).toContainText('Preisposition');
  await expect(a).toContainText('Kennzahlen zur Begründung');
  await page.getByTestId('copilot-example').nth(1).click(); // Lohnt sich der Aufpreis für PREMIUM?
  await expect(page.getByTestId('copilot-turn').first().getByTestId('copilot-recommendation')).toContainText(/Ja|Nein|knapp|günstigste Tarif/);
  await context.close();
});

test('deal reports: daily, weekly and monthly can be generated and downloaded', async ({ page }) => {
  await page.goto('/');
  for (const kind of ['daily', 'weekly', 'monthly']) {
    await page.getByTestId(`generate-${kind}`).click();
    const json = page.getByTestId('widget-reports').getByRole('link').filter({ hasText: new RegExp(`${kind}-\\d{4}-\\d{2}-\\d{2}\\.json`) });
    await expect(json).toBeVisible();
    const report = await (await page.request.get((await json.getAttribute('href'))!)).json();
    expect(report).toMatchObject({ kind, bestUpgrades: expect.any(Array), forecastSummary: expect.any(Array), deals: expect.any(Object) });
    expect(report.routes.length).toBeGreaterThan(0);
  }
  const pdf = page.getByTestId('widget-reports').getByRole('link').filter({ hasText: /monthly-.*\.pdf/ });
  await expect(pdf).toBeVisible();
  expect(((await (await page.request.get((await pdf.getAttribute('href'))!)).body()).subarray(0, 4)).toString()).toBe('%PDF');
});

test('the new pages are fully German by default', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  const english = ['Deal finder', 'Quick searches', 'Ranking', 'Cheapest', 'Best value', 'offers match', 'Fare type', 'Departure month', 'Strong deal', 'Poor deal', 'Why this recommendation', 'Booking timing', 'Recommended booking window', 'Upgrade analyzer', 'Top opportunities', 'Best upgrade opportunity', 'Deal reports', 'Potential saving', 'Expected price range', 'Reset filters'];
  const clean = async (path: string) => {
    await page.goto(path);
    await expect(page.locator('main')).toContainText(/\S/);
    await page.waitForTimeout(300);
    const text = await page.locator('main').innerText();
    for (const word of english) expect(text, `${path}: "${word}"`).not.toContain(word);
  };
  await clean('/deals');
  await expect(page.getByRole('heading', { name: 'Angebotssuche' })).toBeVisible();
  await expect(page.getByTestId('mode-bestForecast')).toContainText('Beste Prognose');
  await clean('/heatmap');
  await expect(page.getByRole('heading', { name: 'Angebots-Heatmap' })).toBeVisible();
  await expect(page.getByTestId('heat-legend')).toContainText('Starkes Angebot');
  await clean('/');
  await expect(page.getByTestId('widget-ranking')).toContainText('Top-Gelegenheiten');
  await page.goto('/');
  await page.getByRole('link', { name: /^Demo: Mediterranean/ }).first().click();
  await expect(page.getByTestId('kpi-current')).toBeVisible();
  await expect(page.getByTestId('timing-card')).toContainText('Buchungszeitpunkt');
  await expect(page.getByTestId('timing-card')).toContainText('Empfohlenes Buchungsfenster');
  await expect(page.getByTestId('explanation')).toContainText('Preisposition');
  await page.getByRole('link', { name: 'Tarife', exact: true }).click();
  await expect(page.getByTestId('fare-comparison')).toBeVisible();
  await expect(page.getByTestId('upgrade-analyzer')).toContainText('Upgrade-Analyse');
  await expect(page.getByTestId('upgrade-analyzer')).toContainText(/Empfohlenes Upgrade|Überlegenswert|Lohnt sich nicht/);
  await expect(page.getByTestId('fare-comparison')).toContainText('Tarifwert-Score');
  await context.close();
});

test('the route list shows the cruise line logo and the ship of every route', async ({ page }) => {
  await page.goto('/');
  const card = (name: RegExp) => sidebar(page).getByRole('listitem').filter({ hasText: name });
  const aida = card(/^Demo: Mediterranean/);
  await expect(aida.getByTestId('provider-logo')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/); // embedded, no file to load
  await expect(aida.getByTestId('route-ship')).toContainText(/AIDA/);
  await expect(aida.getByTestId('route-ship')).not.toContainText('🚢'); // no ship icon
  // the name of the cruise line is not written out (the logo says it); screen readers still get it
  await expect(aida.locator('span:not(.sr-only)').filter({ hasText: /^AIDA$/ })).toHaveCount(0);
  await expect(aida.locator('.sr-only')).toHaveText(' (AIDA)');
  const ms = card(/^Demo: Norwegian/);
  await expect(ms.getByTestId('provider-logo')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
  await expect(ms.getByTestId('route-ship')).toContainText(/Mein Schiff/);
  // the logo is a real image
  for (const logo of [aida.getByTestId('provider-logo'), ms.getByTestId('provider-logo')]) {
    expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  // only the mark, not the lettering: neither the colours of "AIDA" nor the navy of "Cruises" are in the images
  const svgOf = async (logo: ReturnType<typeof aida.getByTestId>) => logo.evaluate((img: HTMLImageElement) => atob(img.src.split(',')[1]!));
  const aidaSvg = await svgOf(aida.getByTestId('provider-logo'));
  const msSvg = await svgOf(ms.getByTestId('provider-logo'));
  for (const letterColour of ['#0094CA', '#CC3300', '#FFCC00', '#009F48']) expect(aidaSvg).not.toContain(letterColour);
  expect(msSvg).not.toContain('#002C58');
  expect(aidaSvg).toContain('#E53212'); // the red lips
  // the whole card still opens the route
  await ms.click({ position: { x: 6, y: 6 } });
  await expect(page.getByRole('heading', { name: /^Demo: Norwegian/ })).toBeVisible();
});

test('the route card shows the start and the end of the trip with weekdays (without full stop or comma)', async ({ page }) => {
  await page.goto('/');
  const dates = sidebar(page).getByRole('listitem').filter({ hasText: /Demo: Mediterranean/ }).getByTestId('route-dates');
  await expect(dates).toHaveText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}\/\d{2}\/\d{4} – (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}\/\d{2}\/\d{4}$/);
  const [start, end] = (await dates.innerText()).split(' – ').map((d) => {
    const [, dd, mm, yyyy] = d.match(/(\d{2})\/(\d{2})\/(\d{4})/)!;
    return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));
  }) as [number, number];
  expect(end).toBeGreaterThan(start);
  // the weekday really belongs to the date
  const weekday = (await dates.innerText()).split(' – ')[0]!.slice(0, 3);
  expect(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(start).getUTCDay()]).toBe(weekday);
  await expect(dates).toHaveAttribute('title', /\d+ nights/);
});

test('in German the trip dates read "Sa 13.03.2027 – Sa 20.03.2027"', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.goto('/');
  const dates = page.getByRole('region', { name: 'Routen' }).getByRole('listitem').filter({ hasText: /Demo: Mediterranean/ }).getByTestId('route-dates');
  await expect(dates).toHaveText(/^(Mo|Di|Mi|Do|Fr|Sa|So) \d{2}\.\d{2}\.\d{4} – (Mo|Di|Mi|Do|Fr|Sa|So) \d{2}\.\d{2}\.\d{4}$/);
  await context.close();
});

test('the route cards are sorted by cruise line and then by departure date', async ({ page, request }) => {
  const make = async (name: string, provider: 'aida' | 'mein-schiff', url: string) => (await (await request.post('/api/routes', { data: { name, provider, url } })).json()) as { id: string };
  // three more routes without a collection (no departure date): they come last within their cruise line
  const extra = [await make('Zeta without date', 'aida', 'https://aida.de/finden/CO07270313/CLASSIC'), await make('Alpha without date', 'aida', 'https://aida.de/finden/CO07270313/CLASSIC'), await make('Beta without date', 'mein-schiff', 'https://www.meinschiff.com/de/trips/x')];
  try {
    await page.goto('/');
    const cards = sidebar(page).getByRole('listitem');
    await expect(cards.filter({ hasText: /without date/ })).toHaveCount(3);
    await expect(sidebar(page).getByTestId('route-dates').first()).toBeVisible(); // the analysis (departures) has loaded
    const names = await cards.evaluateAll((els) => els.map((el) => ({ text: (el as HTMLElement).innerText.split('\n')[0]!, sr: el.querySelector('.sr-only')?.textContent ?? '', date: el.querySelector('[data-testid="route-dates"]')?.textContent ?? '' })));
    const providers = names.map((n) => n.sr.replace(/[() ]/g, ''));
    // all AIDA routes first, then all Mein Schiff routes
    expect(providers).toEqual([...providers].sort((a, b) => a.localeCompare(b)));
    // within a cruise line: the dated routes by departure, the undated ones last (by name)
    for (const provider of ['AIDA', 'MeinSchiff']) {
      const own = names.filter((n) => n.sr.replace(/[() ]/g, '') === provider);
      const dated = own.filter((n) => n.date !== '');
      const undated = own.filter((n) => n.date === '');
      expect(own.map((n) => n.text)).toEqual([...dated, ...undated].map((n) => n.text));
      expect(undated.map((n) => n.text)).toEqual([...undated.map((n) => n.text)].sort((a, b) => a.localeCompare(b)));
      const toTime = (d: string) => { const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/)!; return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])); };
      const times = dated.map((n) => toTime(n.date.split(' – ')[0]!));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  } finally {
    for (const r of extra) await request.delete(`/api/routes/${r.id}`);
  }
});

test('the ship icon is the favicon, and the icon with the title links to the start page', async ({ page }) => {
  await openDemo(page);
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute('href', '/favicon.svg');
  await expect(icon).toHaveAttribute('type', 'image/svg+xml');
  const res = await page.request.get('/favicon.svg');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('svg');
  const svg = await res.text();
  expect(svg).toContain('M12 2v2'); // the same ship as in the header
  expect(svg).not.toMatch(/<script|href=|onload/i);

  // title and icon are one link to the start page, from any page
  const home = page.getByTestId('home-link');
  await expect(home).toHaveAttribute('href', '/');
  await expect(home).toContainText('Cruise Price Tracker');
  await expect(home.locator('svg')).toBeVisible();
  await expect(page).toHaveURL(/\/routes\//);
  await home.locator('svg').click(); // the icon
  await expect(page).toHaveURL(/localhost:5173\/$/);
  await expect(page.getByRole('heading', { name: 'Booking intelligence' })).toBeVisible();

  await page.goto('/deals');
  await page.getByText('Cruise Price Tracker').click(); // the title
  await expect(page).toHaveURL(/localhost:5173\/$/);
});

test('in German the start link is named "Kreuzfahrt-Preisradar"', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.goto('/deals');
  await expect(page.getByTestId('home-link')).toContainText('Kreuzfahrt-Preisradar');
  await expect(page.getByTestId('home-link')).toHaveAttribute('title', 'Zur Startseite');
  await page.getByRole('link', { name: /Kreuzfahrt-Preisradar/ }).click();
  await expect(page).toHaveURL(/localhost:5173\/$/);
  await context.close();
});

// ---- searching a cruise line instead of typing the route ----

const openSearch = async (page: Page) => {
  await page.goto('/');
  await sidebar(page).getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByTestId('open-route-search').click();
  await expect(page.getByTestId('route-search')).toBeVisible();
  return page.getByTestId('route-search');
};

test('route search: find a cruise at the cruise line, pick it, and the route form is filled in', async ({ page, request }) => {
  const dialog = await openSearch(page);
  await expect(dialog.getByLabel('Cruise line')).toHaveValue('aida');
  await dialog.getByLabel('Destination, port or ship').fill('kanaren');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  const results = dialog.getByTestId('route-search-result');
  await expect(results.first()).toBeVisible();
  await expect(dialog.getByTestId('route-search-count')).toContainText('2 cruises found');
  await expect(results.first()).toContainText('Kanaren & Madeira ab Gran Canaria');
  await expect(results.first()).toContainText('AIDAcosma');
  await expect(results.first()).toContainText(/Sat 13\/03\/2027 – Sat 20\/03\/2027/); // start and end with weekdays
  await expect(results.first()).toContainText('7 nights');
  await expect(results.first()).toContainText(/from .*649.* per person/);

  await results.first().getByTestId('route-search-pick').click();
  await expect(dialog).toBeHidden();
  const form = page.getByRole('form', { name: 'Route form' });
  await expect(form.getByLabel('Name')).toHaveValue(/^Kanaren & Madeira ab Gran Canaria · AIDAcosma · Sat 13\/03\/2027$/);
  await expect(form.getByLabel('URL')).toHaveValue('https://aida.de/finden/CO07270313/CLASSIC?pax[adults]=2&pax[juveniles]=0&pax[children]=0&pax[babies]=0');
  await expect(form.getByLabel('Provider')).toHaveValue('aida');

  await form.getByRole('button', { name: 'Add route' }).click();
  const card = sidebar(page).getByRole('listitem').filter({ hasText: /Kanaren & Madeira ab Gran Canaria · AIDAcosma/ });
  await expect(card).toBeVisible();
  const created = (await (await request.get('/api/routes')).json()) as { id: string; name: string }[];
  for (const r of created.filter((x) => x.name.startsWith('Kanaren & Madeira ab Gran Canaria'))) await request.delete(`/api/routes/${r.id}`);
});

test('route search: another cruise line, departure dates, and nothing found', async ({ page }) => {
  const dialog = await openSearch(page);
  await dialog.getByLabel('Cruise line').selectOption('mein-schiff');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  const results = dialog.getByTestId('route-search-result');
  await expect(results.first()).toContainText('Mein Schiff');
  await expect(dialog.getByTestId('route-search-count')).toContainText('3 cruises found');

  await dialog.getByLabel('Departure from').fill('2027-06-01');
  await dialog.getByLabel('Departure until').fill('2027-06-30');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Norwegische Fjorde');
  await expect(results.first()).toContainText('Mein Schiff Relax');

  await dialog.getByLabel('Destination, port or ship').fill('karibik');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog.getByTestId('route-search-count')).toContainText('No cruise found');
  await expect(results).toHaveCount(0);

  // a date range the wrong way round is not sent, the browser stops it
  await expect(dialog.getByLabel('Departure from')).toHaveAttribute('max', '2027-06-30');
  await expect(dialog.getByLabel('Departure until')).toHaveAttribute('min', '2027-06-01');
});

test('route search: shows that it is searching, shows an error from the website, and Escape closes it without touching the form', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('form', { name: 'Route form' }).getByLabel('Name').fill('my own name');
  await page.getByTestId('open-route-search').click();
  const dialog = page.getByTestId('route-search');
  await expect(dialog).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/api/route-search*', async (route) => {
    await gate;
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: "The cruise line's website could not be searched: AIDA search answered 403" }) });
  });
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog.getByTestId('route-search-pending')).toContainText('Searching AIDA');
  await expect(dialog.getByRole('button', { name: 'Searching…' })).toBeDisabled();
  release();
  await expect(dialog.getByTestId('route-search-error')).toContainText('AIDA search answered 403');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('form', { name: 'Route form' }).getByLabel('Name')).toHaveValue('my own name');
});

test('route search is in German by default', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('region', { name: 'Routen' }).getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await page.getByTestId('open-route-search').click();
  const dialog = page.getByTestId('route-search');
  await expect(dialog.getByRole('heading', { name: 'Kreuzfahrten suchen' })).toBeVisible();
  await expect(dialog).toContainText('Reiseziel, Hafen oder Schiff');
  await expect(dialog).toContainText('AIDA wird in einem Browserfenster durchsucht');
  await dialog.getByLabel('Reiseziel, Hafen oder Schiff').fill('norwegische');
  await dialog.getByLabel('Reederei').selectOption('mein-schiff');
  await dialog.getByRole('button', { name: 'Suche', exact: true }).click();
  const hit = dialog.getByTestId('route-search-result').first();
  await expect(hit).toContainText('Mein Schiff Relax');
  await expect(hit).toContainText(/So 20\.06\.2027 – So 27\.06\.2027/);
  await expect(hit).toContainText('ab 1.199');
  await expect(dialog.getByTestId('route-search-count')).toContainText('1 Kreuzfahrten gefunden');
  await context.close();
});

test('route search: tells when the answer comes from the cache and can read the website again', async ({ page }) => {
  const dialog = await openSearch(page);
  const requests: string[] = [];
  const fakeResult = { provider: 'aida', url: 'https://aida.de/finden/CO07270313/CLASSIC?pax[adults]=2&pax[juveniles]=0&pax[children]=0&pax[babies]=0', title: 'Kanaren & Madeira ab Gran Canaria', ship: 'AIDAcosma', startDate: '2027-03-13', endDate: '2027-03-20', nights: 7, pricePerPerson: 649, flightIncluded: false, ports: [], imageUrl: null };
  await page.route('**/api/route-search*', async (route) => {
    requests.push(route.request().url());
    const refreshed = route.request().url().includes('refresh=1');
    const cachedAt = refreshed ? null : new Date(Date.now() - 3 * 3_600_000).toISOString();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'aida', results: [fakeResult], total: 1, capped: false, cachedAt }) });
  });
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  const note = dialog.getByTestId('route-search-cached');
  await expect(note).toContainText(/From the cache: the website was read 3 h ago/);
  expect(requests[0]).not.toContain('refresh');

  await dialog.getByTestId('route-search-refresh').click();
  await expect(note).toHaveCount(0); // a fresh answer has no cache note
  expect(requests[1]).toContain('refresh=1');
  await expect(dialog.getByTestId('route-search-result')).toHaveCount(1);
});

test('route search shows the cache note in German', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.route('**/api/route-search*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'aida', results: [], total: 0, capped: false, cachedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }) }));
  await page.goto('/');
  await page.getByRole('region', { name: 'Routen' }).getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await page.getByTestId('open-route-search').click();
  const dialog = page.getByTestId('route-search');
  await dialog.getByRole('button', { name: 'Suche', exact: true }).click();
  await expect(dialog.getByTestId('route-search-cached')).toContainText('Aus dem Zwischenspeicher: Die Website wurde vor 2 Std. gelesen.');
  await expect(dialog.getByRole('button', { name: 'Website neu lesen' })).toBeVisible();
  await context.close();
});

test('collect anyway: a refused weekly collection offers to collect once nevertheless', async ({ page }) => {
  await openDemo(page);
  const calls: string[] = [];
  await page.route('**/api/routes/*/collect*', async (route) => {
    calls.push(route.request().url());
    if (route.request().url().includes('force=1')) return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ run: {}, snapshot: null, diagnostics: {} }) });
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'This cruise leaves in more than 6 months, so it is collected at most once a week. Last collected 2026-11-17; next collection from 2026-11-24.', code: 'ALREADY_COLLECTED_THIS_WEEK', nextCollection: '2026-11-24' }) });
  });
  await page.getByRole('button', { name: 'Collect now' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'collected at most once a week' })).toContainText('next collection from 2026-11-24');
  const anyway = page.getByTestId('collect-anyway');
  await expect(anyway).toBeVisible();
  expect(calls[0]).not.toContain('force');
  await anyway.click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toContain('force=1');
  await expect(anyway).toHaveCount(0); // the error is gone, so is the button
});

test('the "collect anyway" button only appears for the weekly refusal, and reads in German', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('link', { name: /Demo: Mediterranean/ }).first().click();
  await expect(page.getByTestId('kpi-current')).toBeVisible();
  let code = 'ALREADY_COLLECTED_TODAY';
  await page.route('**/api/routes/*/collect*', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Heute bereits erfasst.', code }) }));
  await page.getByRole('button', { name: 'Jetzt erfassen' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Heute bereits erfasst' })).toBeVisible();
  await expect(page.getByTestId('collect-anyway')).toHaveCount(0);
  code = 'ALREADY_COLLECTED_THIS_WEEK';
  await page.getByRole('button', { name: 'Jetzt erfassen' }).click();
  await expect(page.getByTestId('collect-anyway')).toHaveText('Trotzdem jetzt erfassen');
  await context.close();
});

test('the route list marks the cruises that are only collected once a week', async ({ page }) => {
  const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  // The mock departures are fixed dates; the rule depends on today, so the analysis is given departures relative to today.
  await page.route('**/api/intelligence*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const r of body.routes) r.departure = /Mediterranean/.test(r.routeName) ? dayFromNow(60) : /Norwegian/.test(r.routeName) ? dayFromNow(400) : null;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  const card = (name: RegExp) => sidebar(page).getByRole('listitem').filter({ hasText: name });
  const weekly = card(/Demo: Norwegian/).getByTestId('route-weekly');
  await expect(weekly).toBeVisible();
  await expect(weekly).toHaveText(/collected weekly/);
  await expect(weekly).toHaveAttribute('title', /leaves in more than 6 months, so its price is collected once a week/);
  await expect(card(/Demo: Mediterranean/).getByTestId('route-weekly')).toHaveCount(0); // leaves in two months: daily
  await expect(sidebar(page).getByTestId('route-weekly')).toHaveCount(1);
});

test('the weekly mark reads "wöchentlich erfasst" in German, and a route without a departure date has none', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.route('**/api/intelligence*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const r of body.routes) r.departure = /Norwegian/.test(r.routeName) ? new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10) : null;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  const list = page.getByRole('region', { name: 'Routen' });
  await expect(list.getByTestId('route-weekly')).toHaveText(/wöchentlich erfasst/);
  await expect(list.getByTestId('route-weekly')).toHaveCount(1);
  await context.close();
});

test('legal pages are public and linked from the sign-in page', async ({ page }) => {
  await page.goto('/impressum');
  await expect(page.getByRole('heading', { name: 'Impressum', exact: true })).toBeVisible();
  await page.goto('/datenschutz');
  await expect(page.getByRole('heading', { name: 'Datenschutz', exact: true })).toBeVisible();
  await page.getByTestId('legal-back').click();
  await expect(page).toHaveURL('/');
});

test('itinerary: cabin groups on the route page and the route popup with a map and a sea day', async ({ page }) => {
  // The map must not depend on the internet: tiles are answered empty. The production site sends Referrer-Policy: no-referrer
  // (Caddyfile) and OpenStreetMap blocks tile requests without a Referer, so the page gets that policy here too.
  const tileReferers: (string | undefined)[] = [];
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const meta = document.createElement('meta');
      meta.name = 'referrer';
      meta.content = 'no-referrer';
      document.head.appendChild(meta);
    });
  });
  await page.route('https://tile.openstreetmap.org/**', (route) => {
    tileReferers.push(route.request().headers()['referer']);
    return route.fulfill({ status: 204, body: '' });
  });
  await openDemo(page);
  await page.getByRole('button', { name: 'Collect now' }).click();
  await expect(page.getByRole('button', { name: 'Collect now' })).toBeEnabled();
  await expect(page.getByTestId('cabin-group-table')).toBeVisible();

  await page.getByRole('button', { name: 'Route and times' }).click();
  const dialog = page.getByRole('dialog', { name: 'Route and times' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('route-stop')).toHaveCount(3);
  await expect(dialog.getByText('Sea day')).toBeVisible();
  await expect(dialog.locator('.leaflet-container')).toBeVisible();
  await expect(dialog.locator('.leaflet-interactive')).toHaveCount(3); // two markers and the line
  await expect.poll(() => tileReferers.length).toBeGreaterThan(0);
  expect(tileReferers.every((r) => r === 'http://localhost:5173/')).toBe(true); // the origin, never empty, no path
  await page.screenshot({ path: '.tmp/route-popup-desktop.png' });

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('cabin-group-table')).toBeVisible();

  // On a phone: stacked, no horizontal scroll, the map has a size.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Route and times' }).click();
  await expect(dialog.locator('.leaflet-container')).toBeVisible();
  const box = await dialog.locator('.leaflet-container').boundingBox();
  expect(box!.height).toBeGreaterThan(150);
  expect(box!.width).toBeGreaterThan(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/route-popup-375.png' });
  await page.keyboard.press('Escape');
});
