import type { ItineraryStop } from '@cruise/domain';

const MONTHS: Record<string, string> = {
  januar: '01', februar: '02', märz: '03', april: '04', mai: '05', juni: '06',
  juli: '07', august: '08', september: '09', oktober: '10', november: '11', dezember: '12',
};

const DAY_HEADING = /^(Anreise|Tag \d+)$/;
const DATE_LINE = /^[^,\d]+,\s*(\d{1,2})\.\s*(\p{L}+)\s+(\d{4})$/u;
const TIME = /^(\d{1,2}):(\d{2})$/;
const ANY_TIME = /\d{1,2}:\d{2}/;
const SEA_DAY = /^Seetag$/;
const ARRIVAL = /^Ankunft$/;
const DEPARTURE = /^Abfahrt$/;

/** "Mo., 15. März 2027" -> "2027-03-15"; null when the day or month is not recognised (a wrong date is worse than none). */
function parseDayDate(line: string): string | null {
  const m = DATE_LINE.exec(line);
  const month = m ? MONTHS[m[2]!.toLowerCase()] : undefined;
  if (!m || !month) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return `${m[3]}-${month}-${String(day).padStart(2, '0')}`;
}

/**
 * Stops from the visible lines of the "Reiseverlauf" dialog (blank lines removed). Per day the dialog prints a heading
 * ("Anreise" / "Tag N"), the date with the year ("So., 14. März 2027") and then either a port with its "Ankunft" / "Abfahrt"
 * times or "Seetag". Under a sea day the dialog also lists the ports before and after it; those are not stops and are skipped.
 * Times are local wall-clock strings built from the day's date and the printed time, never passed through Date. A time whose
 * day could not be dated stays null. Mein Schiff prints no port codes.
 */
export function parseMeinSchiffItinerary(lines: string[]): ItineraryStop[] {
  const stops: ItineraryStop[] = [];
  let date: string | null = null;
  let inDay = false;
  let skipping = false; // neighbouring ports under a sea day
  let current: ItineraryStop | null = null;
  let pending: 'arrival' | 'departure' | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (DAY_HEADING.test(line)) {
      inDay = true;
      skipping = false;
      date = null;
      current = null;
      pending = null;
      continue;
    }
    if (!inDay) continue;
    if (date === null && DATE_LINE.test(line)) {
      date = parseDayDate(line);
      continue;
    }
    if (SEA_DAY.test(line)) {
      stops.push({ code: null, name: null, seaDay: true, arrival: null, departure: null, lat: null, lng: null });
      skipping = true;
      current = null;
      continue;
    }
    if (skipping) continue;
    if (ARRIVAL.test(line)) pending = 'arrival';
    else if (DEPARTURE.test(line)) pending = 'departure';
    else if (pending && current && TIME.test(line)) {
      const [, h, min] = TIME.exec(line)!;
      if (date) current[pending] = `${date}T${h!.padStart(2, '0')}:${min}:00`;
      pending = null;
    } else if (ANY_TIME.test(line) || pending) {
      // a time in another format, or a note while Ankunft/Abfahrt still waits for its time: never a port
      continue;
    } else {
      current = { code: null, name: line, seaDay: false, arrival: null, departure: null, lat: null, lng: null };
      stops.push(current);
      pending = null;
    }
  }
  return stops;
}
