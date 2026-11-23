import type { Locator, Page } from 'playwright';
import { locate } from '../selectors/locate';
import type { LocatorSpec } from '../selectors/schema';

/** Clicks the cookie consent button if a banner shows up; a missing banner is fine. */
export async function acceptCookies(page: Page, spec: LocatorSpec, timeoutMs = 8000): Promise<boolean> {
  const button = locate(page, spec).first();
  try {
    await button.waitFor({ state: 'visible', timeout: timeoutMs });
    await button.click();
    await button.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Waits until every loading overlay matching `overlayCss` has stopped capturing pointer events. */
export async function waitUntilSettled(scope: Page | Locator, overlayCss: string, timeoutMs = 15_000): Promise<void> {
  const page = typeof (scope as Locator).page === 'function' ? (scope as Locator).page() : (scope as Page);
  await page.waitForFunction(
    (css) => [...document.querySelectorAll(css)].every((el) => getComputedStyle(el).pointerEvents === 'none'),
    overlayCss,
    { timeout: timeoutMs },
  );
}

/** Waits until the visible page text matches the pattern (multi-line, case-insensitive). */
export async function waitForText(page: Page, pattern: string, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction((src) => new RegExp(src, 'im').test(document.body.innerText), pattern, { timeout: timeoutMs });
}
