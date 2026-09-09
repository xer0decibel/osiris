import { NextResponse } from 'next/server';
import { cachedSource } from '@/lib/sourceCache';
import { httpJson } from '@/lib/httpJson';
import { isRelayHost, relayEnabled, relayUrl } from '@/lib/tv-relay';
import { centroidFor } from '@/lib/countryCentroids';

/**
 * OSIRIS — Live TV.
 *
 * Channels come from the iptv-org community index, which is keyless like the
 * radio feed. The important difference is geography: a radio station carries a
 * transmitter fix, a TV channel carries nothing but an ISO country code. So
 * this layer is deliberately country-resolution — one marker per country, not
 * one per channel. Dropping 2,570 US channels onto a single eyeballed centroid
 * would invent a precision the source does not have, on a map where position is
 * supposed to mean something.
 *
 * Two shapes are served from one cached index:
 *   GET /api/tv              → one row per country, for the map layer
 *   GET /api/tv?country=US   → that country's channels, for the picker
 */

export const dynamic = 'force-dynamic';

const CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';

/** Country names without another network round trip or a bundled table. */
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

interface RawChannel {
  id?: string;
  name?: string;
  network?: string;
  country?: string;
  categories?: string[];
  is_nsfw?: boolean;
  closed?: string | null;
  website?: string;
}

interface RawStream {
  channel?: string | null;
  title?: string;
  url?: string;
  quality?: string | null;
  user_agent?: string | null;
  referrer?: string | null;
}

export interface TvChannel {
  id: string;
  name: string;
  network: string;
  country: string;
  categories: string[];
  url: string;
  quality: string;
  website: string;
}

export interface TvCountry {
  code: string;
  name: string;
  lat: number;
  lng: number;
  count: number;
}

/* Deliberately lib/httpJson rather than fetch. Under the load of the
   dashboard's other feeds, undici's connect timeout fires at 10s against these
   hosts and the route returns an empty index — which cachedSource then stores,
   so the layer comes up blank rather than erroring. httpJson goes through
   Node's https agent instead, carries the identifying UA these community
   indexes ask callers for, and decodes the gzip they serve. */
async function getJson<T>(url: string, attempt = 0): Promise<T[]> {
  try {
    // Accept-Encoding matters here: channels.json is 7.5MB raw and about 1MB
    // gzipped. httpJson decodes by the response header but never asks, so
    // without this the route pulls 11MB of uncompressed JSON per cold start.
    const body = await httpJson<T[]>(url, {
      timeoutMs: 45000,
      headers: { 'Accept-Encoding': 'gzip' },
    });
    if (!Array.isArray(body)) throw new Error(`${url} returned a non-array body`);
    return body;
  } catch (e) {
    /* The dashboard keeps a lot of outbound requests in flight — the CCTV
       regions and the multi-megabyte satellite and flight feeds all refresh on
       their own timers — and a cold TV fetch landing in the middle of that can
       sit long enough to trip the idle timeout. It is transient, so back off
       and try again rather than caching an empty index for six hours. */
    if (attempt >= 2) throw e;
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    return getJson<T>(url, attempt + 1);
  }
}

/**
 * Joins streams onto channels and drops everything that cannot actually play
 * here. Each exclusion is a thing that would otherwise render as a marker the
 * operator clicks and gets nothing from:
 *
 *   http-only     the app's own CSP is `default-src ... https:` — blocked outright
 *   orphan        a stream with no channel record has no name or country
 *   closed        the channel is off air for good
 *   NSFW          flagged upstream; off by default here
 *   no centroid   the country is outside the centroid table, so it cannot be placed
 *   custom headers  the stream demands a User-Agent or Referer that a <video>
 *                   element cannot set, so it will 403 in any browser
 *   CORS-locked   Pluto and its redirector answer no origin but pluto.tv, so
 *                 hls.js cannot fetch them; offered only through the relay,
 *                 and only when a deployment has switched that on
 */
async function buildIndex(): Promise<TvChannel[]> {
  /* Sequential on purpose. Run in parallel these are two large transfers
     competing with everything else the server already has open, which is what
     tipped them into timing out; one after the other is slower on paper and far
     more likely to actually finish. */
  const channels = await getJson<RawChannel>(CHANNELS_URL);
  const streams = await getJson<RawStream>(STREAMS_URL);

  const byId = new Map<string, RawChannel>();
  for (const c of channels) if (c.id) byId.set(c.id, c);

  const out: TvChannel[] = [];
  const seen = new Set<string>();

  for (const s of streams) {
    if (!s.url || !s.url.startsWith('https://')) continue;
    if (s.user_agent || s.referrer) continue;
    if (!s.channel) continue;
    /* See lib/tv-relay. Off, these are not offered at all rather than offered
       dead; on, the browser fetches them from this origin. */
    let url = s.url;
    if (isRelayHost(url)) {
      if (!relayEnabled()) continue;
      url = relayUrl(url);
    }

    const c = byId.get(s.channel);
    if (!c || !c.id || c.closed || c.is_nsfw) continue;
    if (!c.country || !centroidFor(c.country)) continue;

    // One stream per channel: the index lists several mirrors for popular
    // channels and the picker only needs one working entry each.
    if (seen.has(c.id)) continue;
    seen.add(c.id);

    out.push({
      id: c.id,
      name: (c.name || s.title || c.id).trim(),
      network: (c.network || '').trim(),
      country: c.country,
      categories: Array.isArray(c.categories) ? c.categories.slice(0, 4) : [],
      url,
      quality: (s.quality || '').trim(),
      website: (c.website || '').trim(),
    });
  }

  return out;
}

const loadIndex = cachedSource<TvChannel>('tv:index', buildIndex, 6 * 60 * 60 * 1000);

function countryName(code: string): string {
  try {
    return REGION_NAMES.of(code) || code;
  } catch {
    return code;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const country = searchParams.get('country')?.trim().toUpperCase();

  try {
    const index = await loadIndex();

    if (country) {
      const channels = index
        .filter(c => c.country === country)
        .sort((a, b) => a.name.localeCompare(b.name));
      return NextResponse.json({
        country,
        name: countryName(country),
        channels,
        count: channels.length,
      });
    }

    const counts = new Map<string, number>();
    for (const c of index) counts.set(c.country, (counts.get(c.country) ?? 0) + 1);

    const tv_countries: TvCountry[] = [];
    for (const [code, count] of counts) {
      const centroid = centroidFor(code);
      if (!centroid) continue;
      const [lng, lat] = centroid;
      tv_countries.push({ code, name: countryName(code), lat, lng, count });
    }
    tv_countries.sort((a, b) => b.count - a.count);

    return NextResponse.json({
      tv_countries,
      countries: tv_countries.length,
      channels: index.length,
      source: 'iptv-org',
    });
  } catch (e) {
    return NextResponse.json(
      {
        tv_countries: [],
        countries: 0,
        channels: 0,
        error: 'TV index unreachable',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
