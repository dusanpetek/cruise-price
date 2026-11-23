# Selector maintenance

All knowledge about the provider sites lives in `collector/playwright/selectors/aida.json` and `mein-schiff.json` (validated by `src/selectors/schema.ts` when loaded). A site change should only need edits to these files. A broken pattern fails the schema check at startup.

## A locator spec

```json
{ "role": "option", "name": "^Frankfurt - AIDA - Frankfurt$" }   // accessible role + name regex (preferred)
{ "css": "li.cmp-cabin-category-overview__teaser-list-item" }       // CSS
{ "css": "h2", "text": "^Mein Schiff (?!®)\\S+" }                  // CSS narrowed by text
{ "text": "^Flug ab/bis$" }                                           // visible text
```

`name`, `text` and every `*Pattern` are case-insensitive regular expressions. Prefer roles and BEM-style class names over generated or utility classes.

## When a collection starts failing

1. Open the failure package of the failed run: `data/failures/screenshots/<id>.png`, `html/<id>.html`, `logs/<id>.json`, or use the links in the Collection dashboard ("Last failure"). The log lists every step and which one failed, and the PNG shows what the page looked like.
2. Reproduce on one URL without touching your data: `pnpm --filter @cruise/collector try-live '<route url>'` (prints the snapshot or the diagnostics; data goes to a temp dir).
3. Fix the matching entry in the selector file. Text patterns for Mein Schiff (`cabinPattern`, `totalPattern`, ...) are matched against the dialog's visible text with blank lines removed; `src/__fixtures__/meinSchiffDialog.txt` shows the shape.
4. Run `pnpm test` (parsers and registry), then `pnpm test:live` against the real sites.

## Known fragile points

- **AIDA** may start challenging automated visits (HTTP 403 / "Kurz vom Kurs abgekommen" page). That is reported as a normal failure with a screenshot. Nothing in this project tries to evade it.
- **Mein Schiff** `busyOverlay` is a utility-class selector for the dialog's loading overlay; it is the most likely thing to break.
