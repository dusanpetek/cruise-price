# Mobile-responsive app shell and pages

## Intent / why
The app is unusable on a phone: the header (logo, 6 nav links, language switch, theme toggle,
sign-out) is one unwrapped row and overflows; the route list sits above the page content, pushing
it below the fold. Make the whole app genuinely usable on a phone, not a visual redesign.

## Goals
- Header and navigation work on a phone screen (≥360px wide), no horizontal overflow.
- The route list is reachable without burying the page content.
- Dialogs/forms fit the viewport and have comfortably tappable controls.
- No regression on desktop/tablet (≥1024px, the existing `lg` breakpoint): current layout unchanged there.

## Non-goals / anti-goals
- Not a visual redesign (colors, typography, branding stay as they are).
- Not a native-app rebuild (no bottom tab bar, no gestures beyond what a drawer needs).
- Not restructuring page content (tables/widgets) beyond what's needed to fit and to be tappable;
  deep per-page work (e.g. turning tables into cards) is out of scope for this pass.

## Constraints
- No new runtime dependency. Reuse the existing native `<dialog>` pattern already used by
  `RouteSearchDialog` (`showModal()`/`close()`, `backdrop:bg-black/50`) for the mobile drawers —
  it gives focus handling and Escape-to-close for free.
- Keep the existing design tokens (`index.css` custom properties) and component primitives
  (`Button`, `Card`, `Input`), Tailwind v4 (no config file, default breakpoints).
- Keep bilingual texts (`t(...)`) and existing `data-testid`s on elements e2e/unit tests reference.

## Approach (decided)
Below `lg` (1024px, the breakpoint the layout already switches on):
- Header collapses to logo + a hamburger button. Tapping it opens a full-height `<dialog>` sliding
  in from the right with the nav links (stacked), language switch, theme toggle, sign-out.
- The route list moves out of the static layout into a "Routes" bar/button at the top of the content
  area; tapping it opens the list as a `<dialog>` drawer from the left. Picking/closing it returns
  focus to the content.
- At `lg` and above, both behave exactly as today (persistent header row + sidebar) — the drawers
  render but stay closed/irrelevant, shown only via the hamburger/"Routes" button that itself is
  hidden at `lg+`.

This was chosen over the lighter "wrap the nav, move the list below the content" alternative
because it keeps the content immediately visible and matches what a phone user expects; the user
picked this explicitly.

## What's left to the builder (my calls, stated for the record)
- Drawer slide direction: nav from the right, route list from the left (so they don't visually
  collide with the hamburger/"Routes" button's side).
- Icon buttons everywhere get a minimum 40×40px tap target on mobile (several are 32px now).
- Tables keep their current `overflow-x-auto` scroll; only the surrounding padding/font-size gets a
  small mobile adjustment if content is clipped, not a structural change.
- `RouteSearchDialog` and `RouteForm` get a pass for full-width-on-mobile padding/spacing; no
  behavioural change.
- Order of implementation: app shell (header + drawers) first since it unblocks everything else,
  then a pass over the remaining pages for overflow/tap-target issues found while testing at
  360–414px width.
