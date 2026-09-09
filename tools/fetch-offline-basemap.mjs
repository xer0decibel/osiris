#!/usr/bin/env node
/**
 * OSIRIS — fetch the offline basemap assets.
 *
 * The shipped basemap is CARTO's: the style file is local but its only vector
 * source, its glyphs and its sprite are all remote, so with no network the map
 * renders nothing at all — not a degraded map, a black rectangle. This pulls
 * down enough to draw a world without a connection.
 *
 * Deliberately Natural Earth rather than an OpenStreetMap extract. Street-level
 * offline coverage means a multi-gigabyte vector tile archive; the whole world's
 * coastlines, borders, lakes and major cities is about four megabytes and is
 * exactly the altitude this dashboard is used at. See docs/OFFLINE.md for the
 * upgrade path to full-detail tiles.
 *
 * The output is gitignored. Run it once per checkout:
 *     node tools/fetch-offline-basemap.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const OUT = path.join(process.cwd(), 'public', 'offline');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

/** Natural Earth is public domain. 110m is the whole-world tier; 50m gives
 *  borders that still read when zoomed into a continent. */
const LAYERS = [
  { file: 'ne_110m_land', as: 'land' },
  { file: 'ne_50m_admin_0_countries', as: 'countries' },
  { file: 'ne_110m_admin_1_states_provinces_lines', as: 'states' },
  { file: 'ne_110m_lakes', as: 'lakes' },
  { file: 'ne_110m_populated_places_simple', as: 'places' },
];

/* Only the stacks the offline style itself asks for. The CARTO style wants ten,
   including CJK, but this style is ours and uses two. */
const FONTSTACKS = ['Open Sans Regular', 'Open Sans Bold'];
/* 0-255 is ASCII and Latin-1; 256-511 covers Latin Extended-A, which is what
   place names in Central and Eastern Europe need. */
const RANGES = ['0-255', '256-511'];

/** Glyph PBFs. The font is Apache-2.0; these are just prebuilt SDF atlases. */
const GLYPH_SOURCES = [
  s => `https://fonts.openmaptiles.org/${encodeURIComponent(s)}/{range}.pbf`,
  s => `https://tiles.basemaps.cartocdn.com/fonts/${encodeURIComponent(s)}/{range}.pbf`,
];

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'OSIRIS-offline-basemap/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects > 4) return reject(new Error('too many redirects'));
        return resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Natural Earth ships coordinates at absurd precision — often twelve decimals,
 * which is sub-millimetre on a map whose smallest feature is a country. Four
 * decimals is ~11m and roughly halves the file.
 */
function trimPrecision(geojson) {
  const round = v => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
  const walk = c => (Array.isArray(c) ? (typeof c[0] === 'number' ? c.map(round) : c.map(walk)) : c);
  for (const f of geojson.features ?? []) {
    if (f.geometry?.coordinates) f.geometry.coordinates = walk(f.geometry.coordinates);
  }
  return geojson;
}

/** Only the handful of properties the style labels or filters on. */
function keepProps(feature, keys) {
  const p = feature.properties ?? {};
  const out = {};
  for (const k of keys) if (p[k] !== undefined && p[k] !== null) out[k] = p[k];
  feature.properties = out;
  return feature;
}

const PROPS = {
  countries: ['NAME', 'ISO_A2', 'CONTINENT'],
  places: ['NAME', 'POP_MAX', 'ADM0NAME'],
  land: [],
  lakes: ['name'],
  states: [],
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'glyphs'), { recursive: true });

  let total = 0;

  for (const { file, as } of LAYERS) {
    process.stdout.write(`  ${as.padEnd(10)} `);
    const buf = await get(`${NE}/${file}.geojson`);
    const json = trimPrecision(JSON.parse(buf.toString('utf8')));
    for (const f of json.features ?? []) keepProps(f, PROPS[as] ?? []);
    const out = JSON.stringify(json);
    fs.writeFileSync(path.join(OUT, `${as}.geojson`), out);
    total += out.length;
    console.log(`${(buf.length / 1024).toFixed(0)}KB -> ${(out.length / 1024).toFixed(0)}KB`);
  }

  for (const stack of FONTSTACKS) {
    const dir = path.join(OUT, 'glyphs', stack);
    fs.mkdirSync(dir, { recursive: true });
    for (const range of RANGES) {
      let saved = false;
      for (const build of GLYPH_SOURCES) {
        try {
          const buf = await get(build(stack).replace('{range}', range));
          fs.writeFileSync(path.join(dir, `${range}.pbf`), buf);
          total += buf.length;
          console.log(`  glyph      ${stack} ${range} — ${(buf.length / 1024).toFixed(0)}KB`);
          saved = true;
          break;
        } catch { /* try the next mirror */ }
      }
      if (!saved) console.warn(`  glyph      ${stack} ${range} — FAILED (labels will not render offline)`);
    }
  }

  console.log(`\n  offline basemap ready: ${(total / 1048576).toFixed(2)}MB in public/offline`);
}

main().catch(e => { console.error('offline basemap fetch failed:', e.message); process.exit(1); });
