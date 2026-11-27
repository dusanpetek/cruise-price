import type { Page } from 'playwright';
import { detectProviderId, PROVIDER_LABELS, type FareOption, type ItineraryStop } from '@cruise/domain';
import type { CollectedCabin, CollectedCruise, CollectedOption, CollectionContext, CruiseProviderCollector } from '../collection/types';
import { aidaJourneyId, fillPattern, fillUrl, parseAidaAllInStep, parseAidaCabinCodes, parseAidaFareStep, toFareOption, type ServiceLine } from '../parsers/fares';
import { parseAidaCruiseDetail } from '../parsers/aida';
import { normalizeText, re } from '../parsers/text';
import { locate } from '../selectors/locate';
import { findAidaItinerary } from '../search/aida';
import { loadAidaSelectors, type AidaSelectors } from '../selectors';
import { readCabinCards } from './aidaCards';
import { acceptCookies, waitForText } from './browserSteps';

/** AIDA shows per-person prices; picking a flight reprices every card, so the difference is the flight. */
export class AidaCollector implements CruiseProviderCollector {
  readonly id = 'aida' as const;
  readonly label = PROVIDER_LABELS.aida;
  readonly source = 'live' as const;
  /** aida.de answers headless Chromium with HTTP 403, so this runs in a visible window. */
  readonly headless = false;

  constructor(private readonly selectors: AidaSelectors = loadAidaSelectors()) {}

  matches(url: string): boolean {
    return detectProviderId(url) === this.id;
  }

  async collect(ctx: CollectionContext): Promise<CollectedCruise> {
    const sel = this.selectors;
    const { diagnostics: d, config } = ctx;
    const page = await ctx.getPage();
    const detail = this.captureCruiseDetail(page);

    await d.step('open-page', async () => {
      const response = await page.goto(this.withPassengers(ctx.url, config.adults), { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (response && response.status() >= 400) throw new Error(`AIDA answered HTTP ${response.status()}`);
    });
    await d.step('accept-cookies', () => acceptCookies(page, sel.cookieAccept));
    await d.step('verify-passengers', () => this.verifyPassengers(page, config.adults));

    const rawDetail = await detail.catch(() => null);
    const cruise = await d.step('read-cruise-info', async () => parseAidaCruiseDetail(rawDetail));
    const without = await d.step('read-prices-without-flight', async () => {
      const read = await readCabinCards(page, this.selectors);
      if (read.priced.some((c) => c.flightIncluded)) throw new Error('Prices already include a flight; expected the no-flight view');
      return read;
    });
    await d.step(`select-flight-${config.airport}`, () => this.selectFlight(page, config.airport));
    const withFlight = await d.step('read-prices-with-flight', () => readCabinCards(page, this.selectors));

    // A cabin without a price (sold out, on request) is left out and noted; it must not stall or fail the collection.
    const warnings = without.unpriced.map((title) => `Cabin ${title} has no price (probably sold out)`);
    const cabins: CollectedCabin[] = [];
    for (const base of without.priced) {
      const flighted = withFlight.priced.find((c) => c.title === base.title);
      if (!flighted) {
        warnings.push(`Cabin ${base.title} has no price with the flight (probably sold out)`);
        continue;
      }
      const flightPerPerson = flighted.price - base.price;
      if (!flighted.flightIncluded || flightPerPerson < 0) throw new Error(`Flight did not reprice "${base.title}"`);
      cabins.push({ category: base.title, packagePerPerson: base.price, flightPerPerson });
    }
    if (cabins.length === 0) throw new Error(`No cabin has a price. ${warnings.join(' | ')}`);

    const fares = await this.collectFares(ctx, page, rawDetail, cabins);
    return { currency: 'EUR', cruise, party: { adults: config.adults, departureAirport: config.airport }, cabins, ...fares, warnings: [...warnings, ...fares.warnings] };
  }

  /** AIDA's own search lists the stops of every sailing; the window of the price run is reused for it. */
  async readItinerary(ctx: CollectionContext): Promise<ItineraryStop[] | null> {
    const journey = aidaJourneyId(ctx.url, this.selectors.journeyPattern);
    return journey ? findAidaItinerary(await ctx.getPage(), journey) : null;
  }

  /**
   * Every fare of every cabin, from the booking flow's fare step (one deep link per cabin). ALL IN variants are priced in
   * the step after choosing a fare. A cabin that fails is recorded as a warning; no fares at all fails the collection.
   */
  private async collectFares(
    ctx: CollectionContext,
    page: Page,
    rawDetail: unknown,
    cabins: CollectedCabin[],
  ): Promise<{ fares: FareOption[]; options: CollectedOption[]; warnings: string[] }> {
    const sel = this.selectors;
    const { diagnostics: d, config } = ctx;
    const journey = aidaJourneyId(ctx.url, sel.journeyPattern);
    const codes = parseAidaCabinCodes(rawDetail);
    const fares = new Map<string, FareOption>();
    const options: CollectedOption[] = [];
    const warnings: string[] = [];
    if (!journey) throw new Error('Could not find the journey id in the route URL');

    const open = async (code: string) => {
      const url = fillUrl(sel.bookingUrl, { journey, adults: String(config.adults), cabin: code, airport: config.airport });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await locate(page, sel.fareStep.ready).first().waitFor({ timeout: 20_000 });
      await waitForText(page, `(${sel.fareStep.pricePattern.replace(/^\^|\$$/g, '')})|(${sel.fareStep.unavailablePattern})`);
    };
    const pageText = () => page.locator('body').innerText();

    for (const cabin of cabins) {
      const code = codes.find((c) => c.name === cabin.category)?.code;
      if (!code) {
        warnings.push(`No booking code for ${cabin.category}`);
        continue;
      }
      try {
        await d.step(`fares-${code}`, async () => {
          await open(code);
          const blocks = parseAidaFareStep(await pageText(), sel.fareStep);
          const toLines = (xs: string[]): ServiceLine[] => xs.map((text) => ({ text, included: true }));

          for (const block of blocks.filter((b) => b.available)) {
            const base = toFareOption('aida', block.name, toLines(block.services), block.description, sel.serviceFlags);
            fares.set(base.fareCode, fares.get(base.fareCode) ?? base);
            options.push({ cabinCategory: cabin.category, fareCode: base.fareCode, cruisePrice: block.cruisePrice! });
          }
          for (const block of blocks.filter((b) => b.available && b.allInName)) {
            try {
              await open(code);
              await locate(page, { text: fillPattern(sel.selectFare.text!, { fare: block.name }) }).first().click();
              await locate(page, sel.allInStep.ready).first().waitFor({ timeout: 10_000 });
              const upgrade = parseAidaAllInStep(await pageText(), sel.allInStep);
              if (upgrade.cruisePrice === null) throw new Error('no price shown');
              const allIn = toFareOption('aida', block.allInName!, toLines([...block.services, ...upgrade.services]), block.description, sel.serviceFlags);
              fares.set(allIn.fareCode, fares.get(allIn.fareCode) ?? allIn);
              options.push({ cabinCategory: cabin.category, fareCode: allIn.fareCode, cruisePrice: upgrade.cruisePrice });
            } catch (e) {
              // The upgrade may simply not be offered for this cabin right now: note it and keep the other fares.
              warnings.push(`${block.allInName} for ${cabin.category} not offered or not readable (${(e as Error).message.split('\n')[0]})`);
            }
          }
        });
      } catch (e) {
        warnings.push(`Fares for ${cabin.category} could not be read: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    if (options.length === 0) throw new Error(`No fares could be read. ${warnings.join(' | ')}`);
    return { fares: [...fares.values()], options, warnings };
  }

  /** The party is set through the URL (the site's own query parameters), then verified on the page. */
  private withPassengers(url: string, adults: number): string {
    const u = new URL(url);
    const p = this.selectors.urlParams;
    u.searchParams.set(p.adults, String(adults));
    for (const key of [p.juveniles, p.children, p.babies]) u.searchParams.set(key, '0');
    return u.toString();
  }

  private captureCruiseDetail(page: Page): Promise<unknown> {
    const pattern = re(this.selectors.api.cruiseDetail);
    const detail = page.waitForResponse((r) => pattern.test(r.url()) && r.ok(), { timeout: 45_000 }).then((r) => r.json());
    // If navigation fails first, nothing awaits this and it rejects later when the page closes; that must not crash
    // the process. A later `await detail` still sees the error.
    detail.catch(() => undefined);
    return detail;
  }

  private async verifyPassengers(page: Page, adults: number): Promise<void> {
    const summary = normalizeText(await locate(page, this.selectors.passengerSummary).first().innerText());
    const found = summary.match(re(this.selectors.passengerPattern))?.[1];
    if (Number(found) !== adults || re(this.selectors.otherPassengersPattern).test(summary)) {
      throw new Error(`Expected ${adults} adults only, page shows "${summary.replace(/\n/g, ' ')}"`);
    }
  }

  private async selectFlight(page: Page, airport: string): Promise<void> {
    const option = this.selectors.flightOptions[airport];
    if (!option) throw new Error(`No flight option configured for airport ${airport}`);
    await locate(page, this.selectors.flightTeaser).first().click();
    const target = locate(page, option).first();
    try {
      await target.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      const offered = await locate(page, this.selectors.flightOptionAny).allInnerTexts();
      throw new Error(`Flight option for ${airport} not found; page offers: ${offered.slice(0, 12).join(' / ') || 'nothing'}`);
    }
    await target.click();
    await locate(locate(page, this.selectors.cabinCard).first(), this.selectors.flightIncluded).first().waitFor({ timeout: 15_000 });
  }
}
