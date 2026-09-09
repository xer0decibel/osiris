import { NextResponse } from 'next/server';
import { cachedSource } from '@/lib/sourceCache';
import { httpJson } from '@/lib/httpJson';

/**
 * OSIRIS — Broadcast Radio
 *
 * Geo-tagged internet radio stations from the Radio Browser community index.
 * Keyless and unauthenticated, so this layer needs no configuration at all —
 * it is on the same footing as the seismic and ADS-B feeds.
 *
 * Radio Browser asks callers to identify themselves and to avoid hammering the
 * mirrors, which is why the whole index is pulled once and cached for six
 * hours rather than queried per viewport. Station metadata changes on the order
 * of days; nothing here is real-time.
 */

export const dynamic = 'force-dynamic';

/** Published mirrors. `all.api` round-robins via DNS but resolves badly on
 *  some networks, so the named hosts are tried in order instead. */
const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];

/** The index is ~58k stations. Plotting all of them buries the map and most of
 *  the tail is dead air anyway, so this takes the most-listened slice. */
const DEFAULT_LIMIT = 2500;
const MAX_LIMIT = 10000;

/** One wide slice is fetched and cached; every request filters and trims out of
 *  it. Keeping a single entry means the secure and unfiltered views share a
 *  cache rather than each paying their own six-hour miss. */
const UPSTREAM_SLICE = 4000;

export interface RadioStation {
  id: string;
  name: string;
  url: string;
  homepage: string;
  favicon: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  tags: string[];
  codec: string;
  bitrate: number;
  lat: number;
  lng: number;
  votes: number;
  clicks: number;
  /** False for http-only streams. Served over https the browser blocks these
   *  as mixed content, so the player warns instead of failing silently. */
  secure: boolean;
}

/**
 * Stations are tagged with a city centroid far more often than with their
 * actual transmitter, so a city collapses into one unclickable pile of dots.
 * Coincident points are fanned out along a golden-angle spiral — deterministic,
 * so a station keeps its position between refreshes, and small enough (~1km at
 * the widest) that nothing lands in the wrong place.
 */
function spreadCoincident(stations: RadioStation[]): RadioStation[] {
  const seen = new Map<string, number>();
  const GOLDEN = 2.399963229728653; // radians
  for (const s of stations) {
    const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) continue;
    const radius = 0.0018 * Math.sqrt(n);
    const angle = n * GOLDEN;
    s.lat += radius * Math.sin(angle);
    // Longitude degrees shrink toward the poles; without this the fan is an
    // ellipse that gets more distorted the further north the city is.
    s.lng += (radius * Math.cos(angle)) / Math.max(0.2, Math.cos((s.lat * Math.PI) / 180));
  }
  return stations;
}

/** The upstream record, as far as this route relies on it. Everything is
 *  optional: the index is community-maintained and fields go missing. */
interface RawStation {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  language?: string;
  tags?: string;
  codec?: string;
  bitrate?: number | string;
  geo_lat?: number | string;
  geo_long?: number | string;
  votes?: number | string;
  clickcount?: number | string;
}

function normalise(raw: RawStation): RadioStation | null {
  const lat = Number(raw.geo_lat);
  const lng = Number(raw.geo_long);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // 0,0 is the Null Island default a lot of records carry instead of a real fix.
  if (lat === 0 && lng === 0) return null;

  const url: string = raw.url_resolved || raw.url || '';
  if (!url) return null;

  const name = String(raw.name || '').trim();
  if (!name) return null;

  return {
    id: String(raw.stationuuid || ''),
    name,
    url,
    homepage: String(raw.homepage || ''),
    favicon: String(raw.favicon || ''),
    country: String(raw.country || '').trim(),
    countrycode: String(raw.countrycode || '').trim(),
    state: String(raw.state || '').trim(),
    language: String(raw.language || '').trim(),
    tags: String(raw.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean).slice(0, 6),
    codec: String(raw.codec || '').trim(),
    bitrate: Number(raw.bitrate) || 0,
    lat,
    lng,
    votes: Number(raw.votes) || 0,
    clicks: Number(raw.clickcount) || 0,
    secure: url.startsWith('https://'),
  };
}

async function fetchFromMirror(base: string, limit: number): Promise<RadioStation[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    has_geo_info: 'true',
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
  });
  // See the note in /api/tv: fetch's connect timeout makes this fail cold and
  // cache the empty result. httpJson also supplies the identifying UA that
  // Radio Browser asks callers for.
  const raw = await httpJson<RawStation[]>(`${base}/json/stations/search?${params}`, { timeoutMs: 20000 });
  if (!Array.isArray(raw)) throw new Error(`${base} returned a non-array body`);

  const seenIds = new Set<string>();
  const out: RadioStation[] = [];
  for (const r of raw) {
    const s = normalise(r);
    if (!s || !s.id || seenIds.has(s.id)) continue;
    seenIds.add(s.id);
    out.push(s);
  }
  return spreadCoincident(out);
}

/** Walks the mirror list so one host being down does not take the layer with it. */
async function fetchStations(limit: number): Promise<RadioStation[]> {
  let lastErr: unknown;
  for (const base of MIRRORS) {
    try {
      const stations = await fetchFromMirror(base, limit);
      if (stations.length) return stations;
    } catch (e) {
      lastErr = e;
      console.warn(`[OSIRIS] radio mirror ${base} failed:`, e instanceof Error ? e.message : e);
    }
  }
  throw lastErr ?? new Error('all radio mirrors failed');
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requested = parseInt(searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  /* The app serves itself under a "default-src ... https:" CSP, so an http-only
     stream is not merely mixed content — the browser refuses it outright and the
     dot is dead on arrival. Roughly a fifth of the index is http-only, so those
     are dropped by default and every plotted station is one that can actually
     play. "?secure=0" returns the unfiltered set for callers that can use it. */
  const secureOnly = searchParams.get('secure') !== '0';

  const load = cachedSource<RadioStation>(
    'radio:index',
    () => fetchStations(UPSTREAM_SLICE),
    6 * 60 * 60 * 1000,
  );

  try {
    const all = await load();
    const usable = secureOnly ? all.filter(s => s.secure) : all;
    const radio_stations = usable.slice(0, limit);
    return NextResponse.json({
      radio_stations,
      count: radio_stations.length,
      available: usable.length,
      indexed: all.length,
      secure_only: secureOnly,
      source: 'radio-browser.info',
    });
  } catch (e) {
    return NextResponse.json(
      {
        radio_stations: [],
        count: 0,
        error: 'Radio index unreachable',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
