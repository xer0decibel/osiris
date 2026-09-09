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
  { key: 'fire_perimeters', words: ['fire perimeters', 'perimeters', 'burn scar', 'fire outline'] },
  { key: 'fire_incidents', words: ['fire incidents', 'named fires', 'wildfires', 'incidents'] },
  { key: 'fires', words: ['fires', 'fire', 'wildfire', 'hotspots', 'burning', 'firms'] },
  { key: 'wx_radar', words: ['radar', 'precipitation', 'rain', 'storms', 'weather radar'] },
  { key: 'wx_clouds', words: ['clouds', 'cloud', 'satellite imagery', 'cloud cover'] },
  { key: 'weather', words: ['severe weather', 'cyclone', 'hurricane', 'typhoon'] },
  { key: 'earthquakes', words: ['earthquakes', 'earthquake', 'quakes', 'quake', 'seismic'] },
  { key: 'radio', words: ['radio stations', 'radio', 'stations', 'broadcast radio'] },
  { key: 'tv', words: ['tv channels', 'tv', 'television', 'channels'] },
  { key: 'cctv', words: ['cctv', 'cameras', 'camera', 'webcams', 'surveillance'] },
  { key: 'live_news', words: ['live news', 'news feeds', 'news'] },
  { key: 'flights', words: ['commercial flights', 'flights', 'aircraft', 'planes', 'aviation'] },
  { key: 'military', words: ['military flights', 'military aircraft', 'military'] },
  { key: 'jets', words: ['private jets', 'jets'] },
  { key: 'maritime', words: ['maritime', 'ships', 'shipping', 'vessels', 'naval'] },
  { key: 'satellites', words: ['satellites', 'satellite', 'orbits'] },
  { key: 'sat_comms', words: ['starlink', 'comms satellites'] },
  { key: 'infrastructure', words: ['nuclear', 'reactors', 'nuclear facilities'] },
  { key: 'malware', words: ['malware'] },
  { key: 'cyber_attacks', words: ['cyber attacks', 'cyber', 'attacks'] },
  { key: 'cf_outages', words: ['outages', 'internet outages'] },
  { key: 'global_incidents', words: ['global incidents', 'conflicts', 'conflict'] },
  { key: 'day_night', words: ['day night', 'terminator', 'daylight'] },
  { key: 'terrain_elevation', words: ['3d terrain', 'terrain', 'elevation', 'mountains'] },
  { key: 'terrain_3d', words: ['3d buildings', 'buildings'] },
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

/** Centroid of the first ring, which is close enough to place a camera. */
function roughCentre(geometry: FeatureLike['geometry']): [number, number] | null {
  const co = geometry?.coordinates as unknown;
  if (!Array.isArray(co)) return null;
  if (geometry?.type === 'Point') {
    const [lng, lat] = co as number[];
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  let ring: unknown = co;
  while (Array.isArray(ring) && Array.isArray(ring[0]) && !Number.isFinite((ring[0] as number[])[0])) {
    ring = ring[0];
  }
  if (!Array.isArray(ring)) return null;
  let pts = ring as number[][];
  /* A GeoJSON ring is closed: the last vertex repeats the first. Averaging it
     twice drags the centre toward that corner — enough to put a country's label
     visibly off-centre. */
  const first = pts[0], last = pts[pts.length - 1];
  if (
    pts.length > 2 && Array.isArray(first) && Array.isArray(last) &&
    first[0] === last[0] && first[1] === last[1]
  ) {
    pts = pts.slice(0, -1);
  }
  let x = 0, y = 0, n = 0;
  for (const p of pts) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) { x += p[0]; y += p[1]; n++; }
  }
  return n ? [x / n, y / n] : null;
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

/** Exported for the tests, which assert every key against the layer registry. */
export const COMMAND_LAYER_KEYS = [...new Set(LAYER_TERMS.map(t => t.key))];
