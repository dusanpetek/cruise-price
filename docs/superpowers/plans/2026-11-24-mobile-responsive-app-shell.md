# Mobile-responsive app shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app usable on a phone (header, navigation, route list) without changing desktop/tablet (≥1024px) behavior.

**Architecture:** A reusable `Drawer` component (native `<dialog>`, same pattern as `RouteSearchDialog`) houses two mobile-only panels in the app shell: a nav menu and the route list. A `useMediaQuery` hook decides, at runtime, whether the route list renders as the existing persistent sidebar or inside the drawer. No new dependency.

**Tech Stack:** React 19, Tailwind v4 (no config file, default breakpoints), native `<dialog>`, Vitest (`node` environment — no DOM renderer in this repo), Playwright for anything that needs a real browser/DOM.

**Spec:** `docs/superpowers/specs/2026-11-24-mobile-responsive-design.md`

## Global Constraints
- No new runtime dependency (spec, Constraints).
- Reuse the native `<dialog>` pattern (`showModal()`/`close()`, `backdrop:bg-black/50`) already used by `RouteSearchDialog` (spec, Constraints).
- Keep existing design tokens, `Button`/`Card`/`Input` primitives, Tailwind v4 defaults (spec, Constraints).
- All user-facing strings go through `t(...)`; German text added to `packages/i18n/src/de.ts` for every new English key (project convention, see `packages/i18n/src/i18n.test.ts`).
- Desktop/tablet (≥`lg`, 1024px) must look and behave exactly as before (spec, Goals).
- This repo has no DOM-rendering unit test setup (no jsdom/@testing-library/react; `vitest.config.ts` runs `environment: 'node'`). Do not add one — it's a new dev-tooling dependency outside this spec's scope. Anything that needs real rendering is a Playwright e2e test (`e2e/*.spec.ts`), matching the existing project pattern (`RouteSearchDialog`, `App.tsx` have no unit tests either).

## Review Focus
- The full existing desktop e2e suite (`e2e/app.spec.ts`) must keep passing unmodified — it's the regression gate for "no change ≥1024px". → verified in Task 5, Step 7.
- Escape must close an open drawer (native `<dialog>` gives this for free, but it's the kind of thing a refactor can accidentally break). → verified in Task 5, Step 4.
- At the narrowest supported width (360px, spec Goals), no page may cause horizontal overflow. → verified in Task 5, Step 5, against the Overview page (the most widget/table-dense page).
- Creating a route from inside the mobile route drawer must navigate to it and close the drawer, not leave the drawer open over the new page. → verified in Task 5, Step 3.
- Theme and language controls move into the mobile nav drawer; they must still work from there, not just be visible. → verified in Task 5, Step 6. (Sign-out moves there too but can't be exercised: the e2e dev server runs without `AUTH_PASSWORD_HASH`, so sign-in is off and the button never renders. It reuses the exact same `onClick={() => logout.mutate()}` as the desktop header, so the risk is low; noted here rather than silently skipped.)

---

## File Structure

- `apps/frontend/src/hooks/useMediaQuery.ts` (new) — a pure, testable "does this query match" helper plus a React hook wrapping it.
- `apps/frontend/src/components/ui/button.tsx` (modify) — icon buttons get a 40×40px minimum tap target below `sm`, 32×32px (current) at `sm` and above; `buttonVariants` becomes exported so the size map is unit-testable.
- `apps/frontend/src/components/ui/drawer.tsx` (new) — the reusable slide-in `<dialog>` panel, used for both the nav menu and the route list on mobile.
- `apps/frontend/src/app/App.tsx` (modify) — header collapses to a hamburger trigger below `lg`; the route list renders either as the persistent `<aside>` (≥`lg`) or behind a "Routes" button + drawer (<`lg`), decided by `useMediaQuery`.
- `apps/frontend/src/pages/Routes/RouteList.tsx` (modify) — accepts an optional `onNavigate` callback, called when the visible route actually changes (picking a route, or successfully creating one), so the mobile drawer above can close itself.
- `e2e/mobile.spec.ts` (new) — Playwright tests at a 375×667 viewport for the new mobile behavior.

---

### Task 1: `useMediaQuery` hook

**Files:**
- Create: `apps/frontend/src/hooks/useMediaQuery.ts`
- Test: `apps/frontend/src/hooks/useMediaQuery.test.ts`

**Interfaces:**
- Produces: `mediaQueryMatches(query: string, matchMediaImpl: (query: string) => { matches: boolean }): boolean` — pure, no `window` access unless `matchMediaImpl` is omitted (defaults to `window.matchMedia`).
- Produces: `useMediaQuery(query: string): boolean` — React hook; `false` during SSR/no-`window` (there is none in this app, but mirrors the `typeof window !== 'undefined'` guard already used in `apps/frontend/src/lib/i18n.ts`'s `syncLanguage`). Re-renders when the query's match state changes (subscribe via `MediaQueryList.addEventListener('change', ...)`, clean up on unmount). Task 4 consumes this as `useMediaQuery('(min-width: 1024px)')`.

- [ ] **Step 1: Write the failing test**

```ts
// useMediaQuery.test.ts
import { describe, expect, it, vi } from 'vitest';
import { mediaQueryMatches } from './useMediaQuery';

describe('mediaQueryMatches', () => {
  it('returns the matches value from the given matchMedia implementation', () => {
    const matches = vi.fn().mockReturnValue({ matches: true });
    expect(mediaQueryMatches('(min-width: 1024px)', matches)).toBe(true);
    expect(matches).toHaveBeenCalledWith('(min-width: 1024px)');
  });
  it('returns false when the query does not match', () => {
    expect(mediaQueryMatches('(min-width: 1024px)', () => ({ matches: false }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/frontend/src/hooks/useMediaQuery.test.ts`
Expected: FAIL — `useMediaQuery.ts` does not exist / `mediaQueryMatches` is not exported.

- [ ] **Step 3: Implement `mediaQueryMatches` and `useMediaQuery` in `apps/frontend/src/hooks/useMediaQuery.ts`**

`useMediaQuery` is a thin `useState`/`useEffect` wrapper: initialize state from `mediaQueryMatches(query)`, subscribe to the real `window.matchMedia(query)`'s `change` event to update it, re-subscribe when `query` changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/frontend/src/hooks/useMediaQuery.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/useMediaQuery.ts apps/frontend/src/hooks/useMediaQuery.test.ts
git commit -m "feat(frontend): add useMediaQuery hook"
```

---

### Task 2: Bigger tap targets on icon buttons

**Files:**
- Modify: `apps/frontend/src/components/ui/button.tsx`
- Test: `apps/frontend/src/components/ui/button.test.ts` (new)

**Interfaces:**
- Produces: `buttonVariants` becomes an exported `cva(...)` function (currently local, unexported, per the file as it stands). Signature unchanged: `buttonVariants({ variant?, size? }): string`.
- The `size.icon` variant class changes from `'h-8 w-8'` to `'h-10 w-10 sm:h-8 sm:w-8'` (40px below `sm` [640px], the current 32px at `sm` and above). `default` and `sm` sizes are unchanged (spec only calls out icon buttons as undersized).

- [ ] **Step 1: Write the failing test**

```ts
// button.test.ts
import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button';

describe('buttonVariants', () => {
  it('gives icon buttons a 40px minimum tap target on narrow screens, 32px from sm up', () => {
    const cls = buttonVariants({ size: 'icon' });
    expect(cls).toContain('h-10');
    expect(cls).toContain('w-10');
    expect(cls).toContain('sm:h-8');
    expect(cls).toContain('sm:w-8');
  });
  it('leaves the default size unchanged', () => {
    expect(buttonVariants({ size: 'default' })).toContain('h-9');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/frontend/src/components/ui/button.test.ts`
Expected: FAIL — `buttonVariants` is not exported from `./button`.

- [ ] **Step 3: Export `buttonVariants` and widen the `icon` size in `apps/frontend/src/components/ui/button.tsx`**

Add `export` to the existing `const buttonVariants = cva(...)` declaration; change only the `icon` entry in the `size` variants map to `'h-10 w-10 sm:h-8 sm:w-8'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/frontend/src/components/ui/button.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full unit suite and typecheck to confirm nothing else broke**

Run: `pnpm typecheck && pnpm vitest run`
Expected: all pass (icon buttons are used all over the app; this only touches their generated class string, not markup or behavior).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/ui/button.tsx apps/frontend/src/components/ui/button.test.ts
git commit -m "feat(frontend): bigger tap target for icon buttons on mobile"
```

---

### Task 3: `Drawer` component

**Files:**
- Create: `apps/frontend/src/components/ui/drawer.tsx`

**Interfaces:**
- Consumes: nothing project-specific beyond `@/lib/utils`'s `cn` (as `card.tsx`/`button.tsx` already do).
- Produces: `Drawer({ open, onClose, side, 'aria-label': ariaLabel, children }: { open: boolean; onClose: () => void; side: 'left' | 'right'; 'aria-label': string; children: React.ReactNode }): JSX.Element`. Task 4 renders two of these (nav menu, route list).

No test for this task (see Global Constraints: rendering needs a real DOM, which this repo only gets via Playwright; `RouteSearchDialog`, the component this one is modeled on, has none either). Verified by Task 5's e2e tests.

- [ ] **Step 1: Implement `Drawer` in `apps/frontend/src/components/ui/drawer.tsx`**

Model it on `RouteSearchDialog`'s `<dialog>` handling: a `ref` to the `<dialog>`, a `useEffect` that calls `showModal()` when `open` becomes true and `close()` when it becomes false, and the dialog's own `onClose` (native, fires on Escape and on `close()`) calling the `onClose` prop so parent state stays in sync however the dialog closes. Full height (`h-dvh max-h-dvh m-0`), pinned to the given `side` (`side === 'left' ? 'mr-auto' : 'ml-auto'`), width `w-[min(20rem,85vw)]`, `backdrop:bg-black/50` like `RouteSearchDialog`. No open/close transition (not in scope — see spec, "What's left to the builder"). Render `children` inside, plus a close button (`X` icon, `aria-label={t('Close')}`) calling `onClose`.

Add the `Close` key to `packages/i18n/src/de.ts` ("Close": "Schließen") if `t('Close')` isn't already a known key — check first with `grep -n "'Close'" packages/i18n/src/de.ts`.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (an unused component still typechecks; Task 4 wires it in)

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/ui/drawer.tsx packages/i18n/src/de.ts
git commit -m "feat(frontend): add reusable Drawer component"
```

---

### Task 4: App shell — mobile nav drawer and routes drawer

**Files:**
- Modify: `apps/frontend/src/app/App.tsx`
- Modify: `apps/frontend/src/pages/Routes/RouteList.tsx`

**Interfaces:**
- Consumes: `useMediaQuery` (Task 1), `buttonVariants`-backed `Button` (Task 2, no interface change), `Drawer` (Task 3).
- Modifies `RouteList`'s props: adds optional `onNavigate?: () => void`, called (a) from the route `NavLink`'s `onClick` (in addition to its existing navigation — don't `preventDefault`), and (b) from the existing `create.mutate(...)`'s `onSuccess`, alongside the existing `navigate(...)` call. Not called on edit or delete (spec: only when "the visible route actually changes" via a navigation).

**Behavior:**
- Header: below `lg`, the existing `<nav>` and the right-side controls (`LanguageSwitch`, theme `Button`, sign-out `Button`) are hidden (`hidden lg:flex`); a hamburger `Button` (`variant="ghost" size="icon" className="lg:hidden"`, `Menu` icon from `lucide-react`, `aria-label={t('Open menu')}`) appears instead, toggling a `navOpen` state.
- A `Drawer side="right" aria-label={t('Main')} open={navOpen} onClose={() => setNavOpen(false)}` renders the nav links vertically, plus `LanguageSwitch`, the theme button and sign-out button; each `NavLink`'s `onClick` also calls `setNavOpen(false)` (so navigating closes the menu). Implementer's call whether to factor the six `NavLink` entries into a small shared sub-component used by both the header `<nav>` and the drawer (DRY) or to keep them separate — either is fine as long as both stay in sync; a shared component is preferred if it isn't awkward given the two call sites' slightly different layout (horizontal vs. stacked).
- Route list: `const isDesktop = useMediaQuery('(min-width: 1024px)')`. When `isDesktop`, render `<aside><RouteList /></aside>` exactly as today. Otherwise, render a full-width `Button variant="outline"` reading `t('Routes')` (with a `ChevronDown`/`ChevronRight` icon from `lucide-react`) that opens a `routesOpen` state, plus a `Drawer side="left" aria-label={t('Routes')} open={routesOpen} onClose={() => setRoutesOpen(false)}` containing `<RouteList onNavigate={() => setRoutesOpen(false)} />`. Only one `RouteList` is ever mounted at a time.
- Add `Open menu` to `packages/i18n/src/de.ts` ("Open menu": "Menü öffnen") if not already present.

- [ ] **Step 1: Wire the hamburger + nav `Drawer` into the header in `apps/frontend/src/app/App.tsx`**

Add `navOpen`/`setNavOpen` state; wrap the existing `<nav>` + right-side `<div>` in `hidden lg:flex` (adjust the parent flex container accordingly so the hamburger button takes their place below `lg`); add the hamburger `Button`; add the nav `Drawer` with the duplicated controls as described above.

- [ ] **Step 2: Wire the routes `Drawer` and `useMediaQuery` switch into `apps/frontend/src/app/App.tsx`**

Replace the unconditional `<aside><RouteList /></aside>` with the `isDesktop` branch described above.

- [ ] **Step 3: Add `onNavigate` to `apps/frontend/src/pages/Routes/RouteList.tsx`**

Add the prop to `RouteList`'s destructured params (default to a no-op so the desktop call site, which won't pass it, needs no change); call it from the route `NavLink`'s `onClick` and from `create.mutate`'s `onSuccess`.

- [ ] **Step 4: Typecheck and run the unit suite**

Run: `pnpm typecheck && pnpm vitest run`
Expected: all pass (no unit test exercises this file; this confirms no type/regression elsewhere — see Task 5 for behavioral verification)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/App.tsx apps/frontend/src/pages/Routes/RouteList.tsx packages/i18n/src/de.ts
git commit -m "feat(frontend): mobile nav and routes drawers in the app shell"
```

---

### Task 5: Mobile e2e coverage and desktop regression check

**Files:**
- Create: `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: the running app as built by Tasks 1–4; no new selectors beyond `aria-label`s and `data-testid`s already specified there (`t('Open menu')`, `t('Routes')`, `t('Close')`) and existing ones (`sidebar` role/name pattern from `e2e/app.spec.ts`, `demo` route name regex — reuse by copying the two small helpers rather than importing across spec files, matching how `app.spec.ts` is self-contained).

- [ ] **Step 1: Write `e2e/mobile.spec.ts`'s setup and the nav-drawer test**

```ts
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
  await expect(page.getByRole('heading', { name: 'Deals', exact: true })).toBeVisible();
  await expect(menu).toBeHidden();
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `pnpm test:e2e e2e/mobile.spec.ts -g "hamburger opens"`
Expected: PASS. (Playwright starts its own `pnpm dev` per `playwright.config.ts`; no manual server start needed.)

- [ ] **Step 3: Add the routes-drawer tests (pick a route; create one from inside the drawer)**

```ts
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
```

- [ ] **Step 4: Add the Escape-closes-a-drawer test**

```ts
test('Escape closes an open drawer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Main' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Main' })).toBeHidden();
});
```

- [ ] **Step 5: Add the no-horizontal-overflow test**

```ts
test('the overview page has no horizontal overflow at 360px wide', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflowing).toBe(false);
});
```

- [ ] **Step 6: Add the theme-toggle-from-the-drawer test**

```ts
test('the theme toggle works from inside the mobile menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Main' });
  await menu.getByRole('button', { name: /^Theme:/ }).click();
  await expect(page.locator('html')).toHaveClass(/dark|light/);
});
```

- [ ] **Step 7: Run the whole e2e suite (new file + existing `app.spec.ts`) to confirm no desktop regression**

Run: `pnpm test:e2e`
Expected: every test passes, including all of `e2e/app.spec.ts` unmodified — this is the desktop-regression gate from Review Focus.

- [ ] **Step 8: Commit**

```bash
git add e2e/mobile.spec.ts
git commit -m "test(e2e): cover the mobile nav and routes drawers"
```

---

### Task 6: Mobile visual sweep of the remaining pages

**Files:**
- Modify: whichever of `apps/frontend/src/pages/**`, `apps/frontend/src/components/RouteSearchDialog.tsx`, `apps/frontend/src/pages/Routes/RouteForm.tsx` turn out to need a small padding/width fix (found in Step 1, fixed in Step 2 — exact files aren't known until the sweep runs).

**Interfaces:** none (CSS-only touch-ups within pages already laid out; no prop or component signature changes expected).

- [ ] **Step 1: Screenshot every page at 375px wide and note overflow/clipping**

With `pnpm dev` running (mock collectors, seeded data), use a short throwaway script (Playwright, 375×812 viewport) to visit `/`, `/deals`, `/heatmap`, `/copilot`, `/collection`, `/alerts`, a route's detail/forecast/fares/snapshots pages, and `RouteSearchDialog` (open via "Add" → the search button) and `RouteForm` (open via "Add"), saving a screenshot per page to `.tmp/mobile-sweep/`. This script is throwaway (not committed); read the screenshots and list concretely what's clipped or too cramped to tap.

- [ ] **Step 2: Fix what Step 1 found**

Budget: small, targeted Tailwind class changes only (padding, `flex-wrap`, truncation, a `w-full` on something fixed-width) — per spec, not a structural redesign. If something needs more than that, stop and flag it rather than expanding scope.

- [ ] **Step 3: Re-run the Step 1 screenshot script to confirm the fixes land, then run the full test suite**

Run: `pnpm typecheck && pnpm vitest run && pnpm test:e2e`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src
git commit -m "fix(frontend): mobile padding/overflow touch-ups"
```
