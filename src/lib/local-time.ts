import tzlookup from 'tz-lookup';

/**
 * OSIRIS — the local time under the cursor.
 *
 * The header clock is UTC, which is the right reference for a map of the
 * world and the wrong answer to "what time is it there". This turns a point on
 * the map into the wall-clock time at that point, with no network: tz-lookup
 * carries a compressed map of every time zone boundary (about 150KB, CC0),
 * and the browser's own Intl tables do the offset and daylight-saving
 * arithmetic for the zone it names. Over the sea it answers with the nautical
 * zone, Etc/GMT±n, which Intl labels plainly as GMT-2 and so on.
 */
export interface LocalTime {
  /** IANA zone, e.g. America/Los_Angeles or Etc/GMT+2. */
  zone: string;
  /** HH:MM on a 24-hour clock. */
  time: string;
  /** Short zone name as the browser knows it: PDT, BST, JST, GMT-2. */
  abbr: string;
  /** `time` and `abbr` joined, for display. */
  label: string;
}

/** The IANA zone at a point, or null off the edge of the world. */
export function zoneAt(lat: number, lng: number): string | null {
  try {
    return tzlookup(lat, lng);
  } catch {
    return null;
  }
}

export function localTimeAt(lat: number, lng: number, now: Date = new Date()): LocalTime | null {
  const zone = zoneAt(lat, lng);
  if (!zone) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    // en-US knows the American abbreviations — PDT, EST — and falls back to
    // GMT±n elsewhere; en-GB would do the reverse. This screen sits in Seattle.
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
    }).formatToParts(now);
  } catch {
    // A zone tz-lookup knows and this Intl build does not. Rare; say nothing
    // rather than something wrong.
    return null;
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  const time = `${get('hour')}:${get('minute')}`;
  const abbr = get('timeZoneName');
  return { zone, time, abbr, label: abbr ? `${time} ${abbr}` : time };
}
