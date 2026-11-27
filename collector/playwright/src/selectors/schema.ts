import { z } from 'zod';

/** One way of finding an element. Strings under `name` / `text` / `*Pattern` are case-insensitive regex sources. */
export const LocatorSpecSchema = z
  .object({
    css: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
  })
  .refine((l) => l.css || l.role || l.text, 'A locator needs css, role or text');
export type LocatorSpec = z.infer<typeof LocatorSpecSchema>;

const pattern = z.string().refine((s) => {
  try {
    new RegExp(s, 'im');
    return true;
  } catch {
    return false;
  }
}, 'Invalid regular expression');

const serviceFlags = z.object({
  selectableCabin: z.object({ yes: pattern, no: pattern }),
  refundable: pattern,
});

export const AidaSelectorsSchema = z.object({
  provider: z.literal('aida'),
  urlParams: z.object({ adults: z.string(), juveniles: z.string(), children: z.string(), babies: z.string() }),
  api: z.object({ cruiseDetail: pattern }),
  cookieAccept: LocatorSpecSchema,
  title: LocatorSpecSchema,
  passengerSummary: LocatorSpecSchema,
  passengerPattern: pattern,
  otherPassengersPattern: pattern,
  flightTeaser: LocatorSpecSchema,
  flightOptionAny: LocatorSpecSchema,
  flightOptions: z.record(z.string(), LocatorSpecSchema),
  cabinCard: LocatorSpecSchema,
  cabinTitle: LocatorSpecSchema,
  cabinPrice: LocatorSpecSchema,
  flightIncluded: LocatorSpecSchema,
  journeyPattern: pattern,
  /** Deep link to the fare step of one cabin. Placeholders: {journey} {adults} {cabin} {airport}. */
  bookingUrl: z.string(),
  fareStep: z.object({
    ready: LocatorSpecSchema,
    startPattern: pattern,
    endPattern: pattern,
    headingPattern: pattern,
    pricePattern: pattern,
    unavailablePattern: pattern,
    allInPattern: pattern,
    servicesIntroPattern: pattern,
  }),
  /** Placeholder {fare} is replaced with the escaped fare heading. */
  selectFare: LocatorSpecSchema,
  allInStep: z.object({ ready: LocatorSpecSchema, introPattern: pattern, endPattern: pattern, pricePattern: pattern }),
  serviceFlags,
});
export type ServiceFlagPatterns = z.infer<typeof serviceFlags>;
export type AidaSelectors = z.infer<typeof AidaSelectorsSchema>;

export const MeinSchiffSelectorsSchema = z.object({
  provider: z.literal('mein-schiff'),
  cookieAccept: LocatorSpecSchema,
  title: LocatorSpecSchema,
  ship: LocatorSpecSchema,
  /** The "Reiseverlauf" button under the title; it opens a dialog listing ports and times. */
  itineraryOpen: LocatorSpecSchema,
  itineraryDialog: LocatorSpecSchema,
  customizeOpen: LocatorSpecSchema,
  dialog: LocatorSpecSchema,
  /** CSS of the dialog\'s loading overlay; the page is busy while it still captures pointer events. */
  busyOverlay: z.string(),
  guestsPattern: pattern,
  dateRangePattern: pattern,
  nightsPattern: pattern,
  cabinPattern: pattern,
  totalPattern: pattern,
  flightTab: LocatorSpecSchema,
  ownTravelRadio: LocatorSpecSchema,
  flightRadio: LocatorSpecSchema,
  airportCombobox: LocatorSpecSchema,
  airportOptions: z.record(z.string(), LocatorSpecSchema),
  cabinTab: LocatorSpecSchema,
  tariffTab: LocatorSpecSchema,
  tariffSelectButton: LocatorSpecSchema,
  /** CSS of the service lists inside the tariff columns. */
  tariffList: z.string(),
  /** Start of the SVG path that draws the tick / the cross in front of a service. */
  iconCheckPath: z.string(),
  iconCrossPath: z.string(),
  tariffPricePattern: pattern,
  tariffUnavailablePattern: pattern,
  serviceFlags,
});
export type MeinSchiffSelectors = z.infer<typeof MeinSchiffSelectorsSchema>;
