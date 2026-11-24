import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 } });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('cruise-ui')) localStorage.setItem('cruise-ui', JSON.stringify({ state: { language: 'en' }, version: 0 }));
  });
});

test('hamburger opens the nav menu; picking a page navigates and closes it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Main' });
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: 'Deals' }).click();
  await expect(page.getByRole('heading', { name: 'Deal finder', exact: true })).toBeVisible();
  await expect(menu).toBeHidden();
});

test('Routes button opens the route list; picking a route navigates and closes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Routes' });
  await drawer.getByRole('link', { name: /^Demo: Mediterranean/ }).click();
  await expect(page.getByRole('heading', { name: /^Demo: Mediterranean/ })).toBeVisible();
  await expect(drawer).toBeHidden();
});

test('adding a route from the mobile drawer navigates to it and closes the drawer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Routes' });
  await drawer.getByRole('button', { name: 'Add', exact: true }).click();
  await drawer.getByLabel('Name').fill('Mobile E2E Route');
  await drawer.getByLabel('URL').fill('https://aida.de/mobile-e2e');
  await drawer.getByRole('button', { name: 'Add route' }).click();
  await expect(page.getByRole('heading', { name: 'Mobile E2E Route' })).toBeVisible();
  await expect(drawer).toBeHidden();
});

test('Escape closes an open drawer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Main' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Main' })).toBeHidden();
});

test('the overview page has no horizontal overflow at 360px wide', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.getByTestId('widget-fares').waitFor(); // wait for the real content (tables etc.), not the "Analysing…" placeholder
  const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflowing).toBe(false);
});

test('the theme toggle cycles to dark from inside the mobile menu', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' }); // known starting point: "system" renders without the dark class
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Main' });
  await menu.getByRole('button', { name: /^Theme:/ }).click(); // system -> light (still no dark class)
  await menu.getByRole('button', { name: /^Theme:/ }).click(); // light -> dark
  await expect(page.locator('html')).toHaveClass(/dark/);
});
