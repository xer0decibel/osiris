/**
 * OSIRIS — turning a typed line into map actions.
 *
 * The search bar geocodes: you type a place and the camera moves. That leaves
 * every other thing the map can do behind a panel of toggles, and it stops
 * working entirely without a network, because the geocoder is a remote service.
 *
 * This parses the same box into intent instead. "fires in oregon" turns the fire
 * layer on and flies to Oregon. "radar" toggles precipitation. A bare place name
 * still just moves the camera, so nothing that worked before stops working.
 *
 * No model involved, and none needed: the vocabulary is thirty-odd layers and a
 * gazetteer, which is a matching problem, not a language one. It therefore costs
 * nothing, adds no download, and runs with the network unplugged.
 */

/** A layer the parser can turn on, and the words a person might use for it. */
interface LayerTerm {
  key: string;
  /** The panel's own wording, so the search bar and the panel agree on a name.
   *  Asserted against LayerPanel in the tests, like the keys. */
  label: string;
  /** Lowercase. Longest match wins, so put specific phrases before loose words. */
  words: string[];
}

/**
 * Synonyms, not labels. The panel says "Active Fires" but people type "fire",
 * "wildfire", "burning". Keys here are asserted against the real layer registry
 * in the tests, so a renamed or deleted layer fails the suite rather than
 * silently becoming a command that does nothing.
 */
const LAYER_TERMS: LayerTerm[] = [
  { key: 'fire_perimeters', label: 'Fire Perimeters', words: ['fire perimeters', 'perimeters', 'burn scar', 'fire outline'] },
  { key: 'fire_incidents', label: 'Named Incidents', words: ['fire incidents', 'named fires', 'wildfires', 'incidents'] },
  { key: 'fires', label: 'Active Fires', words: ['fires', 'fire', 'wildfire', 'hotspots', 'burning', 'firms'] },
  { key: 'wx_radar', label: 'Precipitation Radar', words: ['radar', 'precipitation', 'rain', 'storms', 'weather radar'] },
  { key: 'wx_clouds', label: 'Cloud Imagery', words: ['clouds', 'cloud', 'satellite imagery', 'cloud cover'] },
  { key: 'wx_temp', label: 'Surface Temperature', words: ['temperature', 'heat map', 'heatmap', 'surface temperature', 'temperatures'] },
  { key: 'weather', label: 'Severe Weather', words: ['severe weather', 'cyclone', 'hurricane', 'typhoon'] },
  { key: 'earthquakes', label: 'Earthquakes', words: ['earthquakes', 'earthquake', 'quakes', 'quake', 'seismic'] },
  { key: 'radio', label: 'Radio Stations', words: ['radio stations', 'radio', 'stations', 'broadcast radio'] },
  { key: 'tv', label: 'TV Channels', words: ['tv channels', 'tv', 'television', 'channels'] },
  { key: 'cctv', label: 'CCTV Cameras', words: ['cctv', 'cameras', 'camera', 'webcams', 'surveillance'] },
  { key: 'live_news', label: 'Live News Feeds', words: ['live news', 'news feeds', 'news'] },
  { key: 'flights', label: 'Commercial', words: ['commercial flights', 'flights', 'aircraft', 'planes', 'aviation'] },
  { key: 'military', label: 'Military', words: ['military flights', 'military aircraft', 'military'] },
  { key: 'jets', label: 'Private Jets', words: ['private jets', 'jets'] },
  { key: 'maritime', label: 'Maritime / Naval', words: ['maritime', 'ships', 'shipping', 'vessels', 'naval'] },
  { key: 'satellites', label: 'All Satellites', words: ['satellites', 'satellite', 'orbits'] },
  { key: 'sat_comms', label: 'Starlink / Comms', words: ['starlink', 'comms satellites'] },
  { key: 'infrastructure', label: 'Nuclear Facilities', words: ['nuclear', 'reactors', 'nuclear facilities'] },
  { key: 'malware', label: 'Live Malware', words: ['malware'] },
  { key: 'cyber_attacks', label: 'Live Attacks', words: ['cyber attacks', 'cyber', 'attacks'] },
  { key: 'cf_outages', label: 'Internet Outages', words: ['outages', 'internet outages'] },
  { key: 'global_incidents', label: 'Global Incidents', words: ['global incidents', 'conflicts', 'conflict'] },
  { key: 'day_night', label: 'Day / Night Cycle', words: ['day night', 'terminator', 'daylight'] },
  { key: 'traffic', label: 'Traffic Flow', words: ['traffic', 'congestion', 'traffic flow'] },
  { key: 'terrain_elevation', label: '3D Terrain', words: ['3d terrain', 'terrain', 'elevation', 'mountains'] },
  { key: 'terrain_3d', label: '3D Buildings', words: ['3d buildings', 'buildings'] },
];

/** Words that only ever join a layer to a place, and are never a place. */
const JOINERS = new Set(['in', 'at', 'near', 'over', 'around', 'for', 'on', 'across']);
/** Leading verbs people type without meaning anything by them. */
const LEAD_VERBS = new Set(['show', 'display', 'find', 'get', 'give', 'me', 'the', 'a', 'turn', 'my']);

export interface ParsedCommand {
  /** Layer keys to switch on. Empty when the line named no layer. */
  layers: string[];
  /** Whatever text was left over, to be geocoded. Null when nothing remained. */
  place: string | null;
  /** True when the line asked to turn something off rather than on. */
  off: boolean;
}

function normalise(q: string): string {
  return q.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Matches longest-first so "fire perimeters" is not eaten by "fire", and
 * removes each hit from the string so what remains can be treated as a place.
 */
export function parseCommand(query: string): ParsedCommand {
  let text = normalise(query);
  if (!text) return { layers: [], place: null, off: false };

  const off = /\b(off|hide|remove|clear|disable)\b/.test(text);
  if (off) text = text.replace(/\b(off|hide|remove|clear|disable)\b/g, ' ');

  const terms = LAYER_TERMS
    .flatMap(t => t.words.map(w => ({ key: t.key, w })))
    .sort((a, b) => b.w.length - a.w.length);

  const layers: string[] = [];
  for (const { key, w } of terms) {
    if (layers.includes(key)) continue;
    // Word-boundary match, so "rain" does not fire on "Ukraine".
    const re = new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    if (re.test(text)) {
      layers.push(key);
      text = text.replace(re, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  const rest = text
    .split(' ')
    .filter(w => w && !JOINERS.has(w) && !LEAD_VERBS.has(w))
    .join(' ')
    .trim();

  return { layers, place: rest || null, off };
}

/** The panel's name for a layer the parser emitted, for showing the command back. */
export function layerLabel(key: string): string {
  return LAYER_TERMS.find(t => t.key === key)?.label ?? key;
}

/* ── Offline gazetteer ──────────────────────────────────────────────────────
   The bundled basemap already ships Natural Earth populated places and country
   polygons, so the drive can resolve a place name with no network. It is coarse
   — countries, capitals and major cities, not street addresses — but it is the
   difference between a search box that works unplugged and one that does not. */

export interface GazetteerEntry {
  name: string;
  lat: number;
  lng: number;
  /** Suggested camera zoom: a country wants a wider view than a city. */
  zoom: number;
}

interface FeatureLike {
  properties?: Record<string, unknown> | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

type Bbox = [minX: number, minY: number, maxX: number, maxY: number];

function ringBbox(ring: unknown): Bbox | null {
  if (!Array.isArray(ring)) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  for (const p of ring as unknown[]) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
    n++;
  }
  return n ? [minX, minY, maxX, maxY] : null;
}

/**
 * Somewhere to point a camera, which is a looser question than "the centroid".
 *
 * Two things went wrong with averaging vertices, and both were found by looking
 * up real countries rather than the square test fixture. A MultiPolygon's first
 * ring is whichever piece Natural Earth listed first — Easter Island for Chile,
 * Corsica for France, a Kuril island for Russia — so the largest outer ring is
 * used instead. And a vertex average is pulled toward whichever edge has the
 * most vertices, which is always the coastline, so Kenya landed on its beach.
 * The centre of the ring's bounding box has neither problem.
 */
function roughCentre(geometry: FeatureLike['geometry']): [number, number] | null {
  const co = geometry?.coordinates as unknown;
  if (!Array.isArray(co)) return null;
  if (geometry?.type === 'Point') {
    const [lng, lat] = co as number[];
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  const outerRings: unknown[] =
    geometry?.type === 'MultiPolygon' ? (co as unknown[]).map(poly => (Array.isArray(poly) ? poly[0] : null)) :
    geometry?.type === 'Polygon' ? [co[0]] :
    [co];
  let best: Bbox | null = null;
  let bestArea = -1;
  for (const ring of outerRings) {
    const b = ringBbox(ring);
    if (!b) continue;
    const area = (b[2] - b[0]) * (b[3] - b[1]);
    if (area > bestArea) { bestArea = area; best = b; }
  }
  if (!best) return null;
  return [(best[0] + best[2]) / 2, (best[1] + best[3]) / 2];
}

/** Natural Earth is inconsistent about case — NAME on countries, name on the
 *  simple layers — so both are accepted rather than assumed. */
function nameOf(f: FeatureLike): string | null {
  const p = f.properties ?? {};
  for (const k of ['NAME', 'name', 'admin', 'ADMIN']) {
    const v = p[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export function buildGazetteer(
  countries: { features?: FeatureLike[] } | null,
  places: { features?: FeatureLike[] } | null,
  regions: { features?: FeatureLike[] } | null = null,
): GazetteerEntry[] {
  const out: GazetteerEntry[] = [];
  const add = (src: { features?: FeatureLike[] } | null, zoom: number) => {
    for (const f of src?.features ?? []) {
      const name = nameOf(f);
      const c = roughCentre(f.geometry);
      if (name && c) out.push({ name, lat: c[1], lng: c[0], zoom });
    }
  };
  add(countries, 4);
  // States and provinces sit between a country and a city, and are what someone
  // actually types when they ask about fires.
  add(regions, 5);
  add(places, 8);
  return out;
}

/**
 * Exact match, then prefix, then substring. No fuzzy matching on purpose: a
 * wrong place silently is worse than no place, and this is a fallback for when
 * the real geocoder is unreachable, not a replacement for it.
 */
export function lookupPlace(gazetteer: GazetteerEntry[], query: string): GazetteerEntry | null {
  const q = normalise(query);
  if (!q) return null;
  const lower = gazetteer.map(g => ({ g, n: g.name.toLowerCase() }));
  return (
    lower.find(x => x.n === q)?.g ??
    lower.find(x => x.n.startsWith(q))?.g ??
    lower.find(x => x.n.includes(q))?.g ??
    null
  );
}

/* ── Loading it in the browser ──────────────────────────────────────────────
   The same three files the offline basemap style draws from, so on the drive
   they are already on disk and, when that basemap is up, already in the HTTP
   cache. Countries is the big one at 1.9MB — fine from a local disk, which is
   the only place this is meant to run — so it is fetched once, lazily, and the
   result kept for the life of the page. */

export const OFFLINE_GAZETTEER_FILES = {
  countries: '/offline/countries.geojson',
  places: '/offline/places.geojson',
  regions: '/offline/states.geojson',
} as const;

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * A loader with its own cache. Never rejects: a file that is missing — a fresh
 * checkout before tools/fetch-offline-basemap.mjs has been run — simply
 * contributes nothing, and an empty result is not cached so a later call can
 * try again.
 */
export function createGazetteerLoader(fetchImpl: FetchLike): () => Promise<GazetteerEntry[]> {
  let pending: Promise<GazetteerEntry[]> | null = null;
  const get = async (url: string) => {
    try {
      const res = await fetchImpl(url);
      return res.ok ? ((await res.json()) as { features?: FeatureLike[] }) : null;
    } catch {
      return null;
    }
  };
  return () => {
    if (pending) return pending;
    pending = (async () => {
      const [countries, places, regions] = await Promise.all([
        get(OFFLINE_GAZETTEER_FILES.countries),
        get(OFFLINE_GAZETTEER_FILES.places),
        get(OFFLINE_GAZETTEER_FILES.regions),
      ]);
      const g = buildGazetteer(countries, places, regions);
      if (g.length === 0) pending = null;
      return g;
    })();
    return pending;
  };
}

/** The page-wide instance. Resolves `fetch` at call time, not import time, so
 *  importing this module in a test or on the server costs nothing. */
export const loadOfflineGazetteer = createGazetteerLoader(url => fetch(url));

/** Exported for the tests, which assert every key against the layer registry. */
export const COMMAND_LAYER_KEYS = [...new Set(LAYER_TERMS.map(t => t.key))];
/** Likewise for the labels. */
export const COMMAND_LAYER_LABELS: Record<string, string> = Object.fromEntries(LAYER_TERMS.map(t => [t.key, t.label]));
