import type { Locator, Page } from 'playwright';
import { detectProviderId, PROVIDER_LABELS, type FareOption, type ItineraryStop } from '@cruise/domain';
import type { CollectedCruise, CollectedOption, CollectionContext, CruiseProviderCollector } from '../collection/types';
import { buildMeinSchiffFares, type TariffColumn } from '../parsers/fares';
import { parseCabins, parseGuests, parseMeinSchiffCruiseInfo, parseTotal, type ParsedCabin } from '../parsers/meinSchiff';
import { parseMeinSchiffItinerary } from '../parsers/meinSchiffItinerary';
import { normalizeText } from '../parsers/text';
import { locate } from '../selectors/locate';
import { loadMeinSchiffSelectors, type MeinSchiffSelectors } from '../selectors';
import { acceptCookies, waitUntilSettled } from './browserSteps';

/**
 * Prices come from the "Reise anpassen" dialog: cabin cards (per person, own travel), plus the dialog's
 * total for the party, which is read once with own travel and once with flights from the configured airport.
 * The flight cost does not depend on the cabin (checked live), so that one difference applies to every card.
 */
export class MeinSchiffCollector implements CruiseProviderCollector {
  readonly id = 'mein-schiff' as const;
  readonly label = PROVIDER_LABELS['mein-schiff'];
  readonly source = 'live' as const;
  readonly headless = true;

  constructor(private readonly selectors: MeinSchiffSelectors = loadMeinSchiffSelectors()) {}

  matches(url: string): boolean {
    return detectProviderId(url) === this.id;
  }

  async collect(ctx: CollectionContext): Promise<CollectedCruise> {
    const sel = this.selectors;
    const { diagnostics: d, config } = ctx;
    const page = await ctx.getPage();

    await d.step('open-page', async () => {
      const response = await page.goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (response && response.status() >= 400) throw new Error(`Mein Schiff answered HTTP ${response.status()}`);
    });
    await d.step('accept-cookies', () => acceptCookies(page, sel.cookieAccept));

    const cruise = await d.step('read-cruise-info', async () =>
      parseMeinSchiffCruiseInfo(
        {
          title: await locate(page, sel.title).first().innerText(),
          ship: await locate(page, sel.ship).first().innerText().catch(() => null),
          pageText: await page.locator('body').innerText(),
        },
        sel,
      ),
    );

    const dialog = await d.step('open-customize-dialog', async () => {
      await locate(page, sel.customizeOpen).first().click();
      const dlg = locate(page, sel.dialog).first();
      await dlg.waitFor({ state: 'visible' });
      await waitUntilSettled(dlg, sel.busyOverlay);
      return dlg;
    });

    const first = await d.step('read-cabins-and-own-travel-total', async () => {
      const text = await dialog.innerText();
      const guests = parseGuests(text, sel.guestsPattern);
      if (guests !== config.adults) throw new Error(`Expected ${config.adults} guests, page shows ${guests}`);
      const parsed = parseCabins(text, sel.cabinPattern);
      if (parsed.length === 0) throw new Error('No cabin cards found in the dialog');
      return { cabins: parsed, ownTravelTotal: parseTotal(text, sel.totalPattern) };
    });

    const tariffs = await d.step('read-tariffs', () => this.readTariffs(dialog, config.adults, first));
    const ownTravelTotal = tariffs.ownTravelTotal;

    const flightTotal = await d.step(`select-flight-${config.airport}`, async () => {
      await this.chooseOwnTravelTab(dialog);
      await locate(dialog, sel.flightRadio).first().click();
      await waitUntilSettled(dialog, sel.busyOverlay);
      const boxes = locate(dialog, sel.airportCombobox);
      const option = sel.airportOptions[config.airport];
      if (!option) throw new Error(`No airport option configured for ${config.airport}`);
      for (let i = 0; i < (await boxes.count()); i++) {
        await boxes.nth(i).click(); // outbound, then return
        await this.pickAirport(page, option, config.airport);
        await waitUntilSettled(dialog, sel.busyOverlay);
      }
      const total = parseTotal(await dialog.innerText(), sel.totalPattern);
      if (total <= ownTravelTotal) throw new Error(`Flight total ${total} is not above own-travel total ${ownTravelTotal}`);
      return total - ownTravelTotal;
    });

    const flightPerPerson = flightTotal / config.adults;
    return {
      currency: 'EUR',
      cruise,
      party: { adults: config.adults, departureAirport: config.airport },
      cabins: tariffs.cabins.map((c) => ({ category: c.category, packagePerPerson: c.pricePerPerson, flightPerPerson })),
      fares: tariffs.fares,
      options: tariffs.options,
      warnings: tariffs.warnings,
    };
  }

  /**
   * The "Reiseverlauf" button opens a dialog with one block per day (port, arrival, departure, or a sea day). The page of the
   * price run is reused; the dialog is closed again. Null when the button or the dialog is missing or lists no port.
   */
  async readItinerary(ctx: CollectionContext): Promise<ItineraryStop[] | null> {
    const page = await ctx.getPage();
    // The price run leaves the "Reise anpassen" dialog open, which hides the rest of the page; closing it discards nothing we need.
    const priceDialog = locate(page, this.selectors.dialog).first();
    if (await priceDialog.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await priceDialog.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    }
    const open = locate(page, this.selectors.itineraryOpen).first();
    if (!(await open.isVisible().catch(() => false))) return null;
    await open.click();
    const dialog = locate(page, this.selectors.itineraryDialog).first();
    try {
      await dialog.waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      return null;
    }
    const stops = parseMeinSchiffItinerary(normalizeText(await dialog.innerText()).split('\n'));
    await page.keyboard.press('Escape');
    return stops.some((s) => !s.seaDay) ? stops : null;
  }

  /**
   * Walks through every available tariff of the dialog (PRO, PLUS, PUR, ...): selects it and reads all cabin prices.
   * The own-travel total of the last tariff is returned because the flight is measured under that same tariff.
   * Nothing is applied: closing the dialog discards the selection.
   */
  private async readTariffs(
    dialog: Locator,
    adults: number,
    initial: { cabins: ParsedCabin[]; ownTravelTotal: number },
  ): Promise<{ fares: FareOption[]; options: CollectedOption[]; cabins: ParsedCabin[]; ownTravelTotal: number; warnings: string[] }> {
    const sel = this.selectors;
    await locate(dialog, sel.tariffTab).first().click();
    await waitUntilSettled(dialog, sel.busyOverlay);
    const drafts = buildMeinSchiffFares(await this.readTariffColumns(dialog), sel);
    const buttons = locate(dialog, sel.tariffSelectButton);
    if (drafts.length === 0 || (await buttons.count()) !== drafts.length) {
      throw new Error(`Found ${drafts.length} tariffs but ${await buttons.count()} select buttons`);
    }

    const fares: FareOption[] = [];
    const options: CollectedOption[] = [];
    const warnings: string[] = [];
    const cabins = new Map(initial.cabins.map((c) => [c.category, c]));
    let ownTravelTotal = initial.ownTravelTotal;

    for (const [i, draft] of drafts.entries()) {
      if (!draft.available) {
        warnings.push(`Tariff ${draft.fare.fareName} is currently not available`);
        continue;
      }
      await buttons.nth(i).click();
      await waitUntilSettled(dialog, sel.busyOverlay);
      await locate(dialog, sel.cabinTab).first().click();
      await waitUntilSettled(dialog, sel.busyOverlay);
      const text = await dialog.innerText();
      const parsed = parseCabins(text, sel.cabinPattern);
      if (parsed.length === 0) {
        warnings.push(`Tariff ${draft.fare.fareName}: no cabin prices found`);
      } else {
        fares.push(draft.fare);
        for (const c of parsed) {
          cabins.set(c.category, cabins.get(c.category) ?? c);
          options.push({ cabinCategory: c.category, fareCode: draft.fare.fareCode, cruisePrice: c.pricePerPerson * adults });
        }
        ownTravelTotal = parseTotal(text, sel.totalPattern);
      }
      await locate(dialog, sel.tariffTab).first().click();
      await waitUntilSettled(dialog, sel.busyOverlay);
    }
    if (options.length === 0) throw new Error(`No tariff prices could be read. ${warnings.join(' | ')}`);
    return { fares, options, cabins: [...cabins.values()], ownTravelTotal, warnings };
  }

  /** The tariff tab's columns: heading, text, and each service with its tick / cross (read from the icon). */
  private readTariffColumns(dialog: Locator): Promise<TariffColumn[]> {
    const { tariffList, iconCheckPath, iconCrossPath } = this.selectors;
    return dialog.evaluate(
      (root, cfg) => {
        const columns = new Map<Element, TariffColumn>();
        for (const ul of root.querySelectorAll(cfg.list)) {
          let col: Element | null = ul.parentElement;
          while (col && col !== root && !/^[A-ZÄÖÜ]{2,}\s*\n/.test((col as HTMLElement).innerText ?? '')) col = col.parentElement;
          if (!col || col === root) continue;
          const text = (col as HTMLElement).innerText;
          const entry = columns.get(col) ?? { name: text.split('\n')[0]!.trim(), text, items: [] };
          const heading = ul.previousElementSibling?.textContent?.trim();
          const prefix = heading?.endsWith(':') ? `${heading} ` : '';
          for (const li of ul.querySelectorAll('li')) {
            const d = li.querySelector('svg path')?.getAttribute('d') ?? '';
            entry.items.push({ text: `${prefix}${(li as HTMLElement).innerText.trim()}`, mark: d.startsWith(cfg.check) ? 'check' : d.startsWith(cfg.cross) ? 'cross' : 'unknown' });
          }
          columns.set(col, entry);
        }
        return [...columns.values()];
      },
      { list: tariffList, check: iconCheckPath, cross: iconCrossPath },
    );
  }

  private async chooseOwnTravelTab(dialog: Locator): Promise<void> {
    await locate(dialog, this.selectors.flightTab).first().click();
    await waitUntilSettled(dialog, this.selectors.busyOverlay);
  }

  private async pickAirport(page: Page, option: MeinSchiffSelectors['airportOptions'][string], airport: string): Promise<void> {
    const target = locate(page, option).first();
    try {
      await target.waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      const offered = await locate(page, { css: option.css ?? '[role="option"]' }).allInnerTexts();
      throw new Error(`Airport ${airport} not offered; options: ${offered.map(normalizeText).join(' / ') || 'none'}`);
    }
    await target.click();
  }
}
