/**
 * OSIRIS — cloud imagery that is never half dark.
 *
 * NASA GIBS publishes VIIRS true colour as one composite per UTC day and
 * builds it as the satellite goes: the day starts at the date line, sweeps
 * west across Asia, Europe and the Atlantic, and reaches the Americas last,
 * around 21:00 to 02:00 UTC. Until a region's pass is in, its tiles are solid
 * black — a JPEG has no transparency with which to say "nothing here yet" — so
 * drawing today's date alone paints half the globe black for most of the day.
 * Measured 2026-09-11 18:45Z: the Americas quarter-globe tile 100% black,
 * Asia's 0%, and yesterday's Americas 0%.
 *
 * The fix is yesterday's composite underneath. Two raster sources cannot do
 * it — the black would cover the older image — so the two tiles are combined
 * per pixel in the browser through a MapLibre custom protocol: today's pixel
 * where today has data, yesterday's where it is black. The swath edge then
 * runs through a tile rather than around it, and there is no server hop and
 * no new dependency. GIBS answers a request for `.png` with the same JPEG, so
 * asking for transparency is not an option either.
 *
 * Remaining gap: yesterday's own Americas pass finishes around 02:00 UTC, so
 * for the first two hours of a UTC day the far east Pacific can still be
 * black in both days. A third day underneath would close it at the cost of a
 * third fetch per tile; not worth it for two hours.
 */

import { temperatureOf } from './gibs-bt-ramp';

export const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const CLOUD_LAYER = 'VIIRS_NOAA20_CorrectedReflectance_TrueColor';
/**
 * The same instrument's thermal channel, night passes. It needs no sun, so it
 * has the poles in their winter and it is the third fill under the two true
 * colour days — used only where both of those have nothing, which in
 * September is everything south of 70°S. Measured 2026-09-11: the true colour
 * row from 79°S to the pole is a 404 on every column while this layer's is a
 * full 29 KB tile.
 */
export const INFRARED_LAYER = 'VIIRS_NOAA20_Brightness_Temp_BandI5_Night';
export const CLOUD_PROTOCOL = 'osiris-clouds';

/**
 * How the infrared is recoloured to sit beside the true colour. NASA paints
 * brightness temperature on a navy-to-white ramp that reads as a purple wash
 * next to a photograph, so each pixel is taken back to kelvin through the
 * published ramp and repainted between the two colours the true colour tiles
 * actually have — measured as the median of their ocean and cloud pixels —
 * with the layer's own opacity doing the rest. 274 K is water just above
 * freezing, which is the open Southern Ocean; 252 K and colder is white.
 * That white point was measured, not chosen: just north of the 70°S seam the
 * photograph is almost all sea ice and cloud (median brightness 244/255),
 * and just south of it the infrared reads 228–251 K, so anything colder than
 * 252 K has to come out as white or the seam shows as a step. A first cut
 * with white at 236 K painted 245 K as mid grey and the step was plain.
 */
export const CLOUD_WHITE: [number, number, number] = [230, 230, 234];
export const OCEAN_NAVY: [number, number, number] = [24, 28, 40];
export const IR_WARM_K = 274;
export const IR_COLD_K = 252;
/** GIBS Level9 tiles are 256px; the source in OsirisMap declares the size and the z9 ceiling. */
export const CLOUD_TILE_SIZE = 256;

/**
 * A pixel whose brightest channel is at or below this is no-data. Real imagery
 * never gets this dark — deep ocean measured about 1% of pixels under 16 and
 * none under 2 — while JPEG ringing along the swath edge can lift no-data a
 * few steps above zero.
 */
export const NO_DATA_MAX = 8;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's composite on top, yesterday's underneath. */
export function cloudDates(nowMs: number): { top: string; under: string } {
  return { top: utcDate(nowMs), under: utcDate(nowMs - DAY_MS) };
}

/** GIBS orders the path row-before-column, so this is {z}/{y}/{x}. */
export function gibsTileTemplate(date: string, layer = CLOUD_LAYER): string {
  return `${GIBS}/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
}

export function gibsTileUrl(date: string, z: number, y: number, x: number, layer = CLOUD_LAYER): string {
  return gibsTileTemplate(date, layer)
    .replace('{z}', String(z))
    .replace('{y}', String(y))
    .replace('{x}', String(x));
}

/**
 * The template handed to MapLibre. The placeholders stay bare so the map's own
 * substitution reaches them; the dates ride in the query string.
 */
export function compositeTemplate(top: string, under: string): string {
  return `${CLOUD_PROTOCOL}://{z}/{y}/{x}?top=${top}&under=${under}`;
}

export interface CompositeRequest {
  z: number;
  y: number;
  x: number;
  top: string;
  under: string;
}

export function parseCompositeUrl(url: string): CompositeRequest | null {
  if (!url.startsWith(`${CLOUD_PROTOCOL}://`)) return null;
  const m = /^[a-z-]+:\/\/(\d+)\/(\d+)\/(\d+)\?(.*)$/.exec(url);
  if (!m) return null;
  const q = new URLSearchParams(m[4]);
  const top = q.get('top') ?? '';
  const under = q.get('under') ?? '';
  if (!DATE_RE.test(top) || !DATE_RE.test(under)) return null;
  return { z: Number(m[1]), y: Number(m[2]), x: Number(m[3]), top, under };
}

/**
 * How far a tile's confidence fades around its no-data, in pixels. Measured
 * on real tiles: a swath edge is not a line but a band about eight rows deep
 * where the no-data fraction climbs from 0 to 1, and the pixels in between are
 * JPEG ringing — 9 to 40 on the brightest channel, too bright for the mask and
 * too dark to be cloud.
 */
export const FEATHER_PX = 6;
/** A pixel this dark within FEATHER_PX of no-data is ringing, and joins the mask. Real night ocean is 40. */
export const RINGING_MAX = 48;

/** Chebyshev distance from the set pixels of `mask`, up to `radius`; 255 beyond. */
function distanceFrom(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const dist = new Uint8Array(width * height).fill(255);
  let frontier: number[] = [];
  for (let p = 0; p < mask.length; p++) if (mask[p]) { dist[p] = 0; frontier.push(p); }
  for (let d = 1; d <= radius && frontier.length; d++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % width, y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (dist[q] === 255) { dist[q] = d; next.push(q); }
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * How much to believe each pixel of a tile: 0 on its no-data, rising to 1
 * FEATHER_PX away, 1 everywhere else. The no-data mask is the black pixels
 * plus any ringing-dark pixel within FEATHER_PX of one, so the band along a
 * swath edge counts as missing rather than as very dark cloud. This is what
 * the composite blends by — a tile is never blended *toward* another tile's
 * hole, which is what an earlier fill-then-feather did: it pulled the bright
 * pixels beside the 70°S seam toward yesterday's black there, and the
 * infrared fill afterwards only half recovered them, leaving a dark ring.
 */
export function dataWeights(
  px: Uint8ClampedArray, width: number, height: number, radius = FEATHER_PX, max = NO_DATA_MAX, ringing = RINGING_MAX,
): Float32Array {
  if (px.length !== width * height * 4) throw new Error(`dataWeights: ${width}×${height} is not ${px.length / 4} pixels`);
  const n = width * height;
  const hard = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (px[i] <= max && px[i + 1] <= max && px[i + 2] <= max) hard[p] = 1;
  }
  const near = distanceFrom(hard, width, height, radius);
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (hard[p] || (near[p] !== 255 && px[i] <= ringing && px[i + 1] <= ringing && px[i + 2] <= ringing)) mask[p] = 1;
  }
  const dist = distanceFrom(mask, width, height, radius);
  const w = new Float32Array(n);
  for (let p = 0; p < n; p++) w[p] = dist[p] === 255 ? 1 : dist[p] / (radius + 1);
  return w;
}

/** Pixels no layer fully covers — what decides whether the infrared is fetched at all. */
export function uncovered(weights: Float32Array[], pixels: number): number {
  let n = 0;
  for (let p = 0; p < pixels; p++) {
    let rem = 1;
    for (const w of weights) rem *= 1 - w[p];
    if (rem > 1e-3) n++;
  }
  return n;
}

/**
 * Front-to-back composite: each layer contributes its weight of whatever the
 * layers above left, colours normalised so a half-covered pixel is the right
 * colour at half alpha rather than half black. Alpha is the coverage, so a
 * pixel no layer has is transparent.
 */
export function compositeWeighted(layers: Uint8ClampedArray[], weights: Float32Array[], width: number, height: number): Uint8ClampedArray {
  const n = width * height;
  if (layers.length !== weights.length) throw new Error(`compositeWeighted: ${layers.length} layers, ${weights.length} weights`);
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    let r = 0, g = 0, b = 0, a = 0, total = 0, rem = 1;
    for (let k = 0; k < layers.length && rem > 0; k++) {
      const share = weights[k][p] * rem;
      if (share > 0) {
        const i = p * 4, L = layers[k];
        r += L[i] * share; g += L[i + 1] * share; b += L[i + 2] * share; a += L[i + 3] * share;
        total += share;
      }
      rem *= 1 - weights[k][p];
    }
    const o = p * 4;
    if (total > 0) { out[o] = r / total; out[o + 1] = g / total; out[o + 2] = b / total; out[o + 3] = a; }
  }
  return out;
}

/**
 * Repaints a NASA brightness-temperature tile, in place, as cloud: each pixel
 * back to kelvin through the ramp, then between OCEAN_NAVY at IR_WARM_K and
 * CLOUD_WHITE at IR_COLD_K, opaque. Nothing it produces is ever no-data, so a
 * later fill leaves it alone.
 */
export function paintInfrared(px: Uint8ClampedArray): void {
  const span = IR_WARM_K - IR_COLD_K;
  for (let i = 0; i < px.length; i += 4) {
    const k = temperatureOf(px[i], px[i + 1], px[i + 2]);
    const t = Math.min(1, Math.max(0, (IR_WARM_K - k) / span));
    px[i] = Math.round(OCEAN_NAVY[0] + t * (CLOUD_WHITE[0] - OCEAN_NAVY[0]));
    px[i + 1] = Math.round(OCEAN_NAVY[1] + t * (CLOUD_WHITE[1] - OCEAN_NAVY[1]));
    px[i + 2] = Math.round(OCEAN_NAVY[2] + t * (CLOUD_WHITE[2] - OCEAN_NAVY[2]));
    px[i + 3] = 255;
  }
}

/** What a day's fetch came back as: a tile, no tile (GIBS answers 404 past the swath at high zoom), or a failure. */
export type DayTile = { tile: Blob } | { tile: null } | { error: unknown };

/**
 * Decides what to draw from the two days. Pure, so the branches are testable
 * without a canvas. Both present: composite. One: that one alone, and the
 * layer is no worse than before this existed. Neither, and neither failed:
 * an empty tile — no data is not an error, and reporting it as one is what
 * put a console error on every high-zoom tile before a pass arrives. A
 * failure with nothing to fall back on is rethrown, so MapLibre leaves the
 * tile empty and says so.
 */
export function chooseTiles(top: DayTile, under: DayTile):
  | { mode: 'composite'; top: Blob; under: Blob }
  | { mode: 'single'; tile: Blob }
  | { mode: 'empty' } {
  const t = 'tile' in top ? top.tile : null;
  const u = 'tile' in under ? under.tile : null;
  if (t && u) return { mode: 'composite', top: t, under: u };
  if (t) return { mode: 'single', tile: t };
  if (u) return { mode: 'single', tile: u };
  if ('error' in top) throw top.error;
  if ('error' in under) throw under.error;
  return { mode: 'empty' };
}

/**
 * MapLibre's loader for `osiris-clouds://` tiles. Main thread only — it needs
 * fetch, createImageBitmap and OffscreenCanvas. Returns encoded image bytes,
 * which is the one form the library documents for a custom protocol.
 */
export async function loadCompositeTile(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const req = parseCompositeUrl(url);
  if (!req) throw new Error(`Not a cloud composite URL: ${url}`);

  const fetchDay = async (date: string, layer: string): Promise<DayTile> => {
    try {
      const res = await fetch(gibsTileUrl(date, req.z, req.y, req.x, layer), { signal });
      if (res.status === 404) return { tile: null };
      if (!res.ok) throw new Error(`GIBS ${res.status} for ${layer} ${date}`);
      return { tile: await res.blob() };
    } catch (error) {
      return { error };
    }
  };

  const choice = chooseTiles(...(await Promise.all([fetchDay(req.top, CLOUD_LAYER), fetchDay(req.under, CLOUD_LAYER)])));

  const size = CLOUD_TILE_SIZE;
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('No 2d context for cloud tile');
  const pixelsOf = async (blob: Blob) => {
    const bitmap = await createImageBitmap(blob);
    g.clearRect(0, 0, size, size);
    g.drawImage(bitmap, 0, 0, size, size);
    bitmap.close();
    return g.getImageData(0, 0, size, size);
  };

  /* Front to back: today, yesterday, then the night infrared — each weighted
     by its own confidence, so no layer is ever blended toward another's hole.
     With neither day present the list starts empty and the tile is whatever
     the infrared has, or transparent. */
  const layers: Uint8ClampedArray[] = [];
  if (choice.mode === 'composite') layers.push((await pixelsOf(choice.top)).data, (await pixelsOf(choice.under)).data);
  else if (choice.mode === 'single') layers.push((await pixelsOf(choice.tile)).data);
  const weights = layers.map(l => dataWeights(l, size, size));

  /* The infrared is fetched only for a tile the days leave holes in — most of
     the world never gets here. Its failure is not reported: it is a fallback
     for a fallback, and the tile is no worse without it. */
  if (uncovered(weights, size * size) > 0) {
    const ir = await fetchDay(req.under, INFRARED_LAYER);
    if ('tile' in ir && ir.tile) {
      const irPixels = (await pixelsOf(ir.tile)).data;
      paintInfrared(irPixels);
      layers.push(irPixels);
      weights.push(dataWeights(irPixels, size, size));
    }
  }

  const out = g.createImageData(size, size);
  out.data.set(compositeWeighted(layers, weights, size, size));
  g.putImageData(out, 0, 0);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return png.arrayBuffer();
}
