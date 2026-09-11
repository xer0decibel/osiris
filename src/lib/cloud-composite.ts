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
 * Fills the no-data pixels of `top` from `under`, in place. Both are RGBA of
 * the same length. Returns how many pixels were filled, so a caller — or a
 * test — can tell "nothing needed filling" from "everything did".
 */
export function fillNoData(top: Uint8ClampedArray, under: Uint8ClampedArray, max = NO_DATA_MAX): number {
  if (top.length !== under.length) throw new Error(`fillNoData: ${top.length} vs ${under.length} bytes`);
  let filled = 0;
  for (let i = 0; i < top.length; i += 4) {
    if (top[i] <= max && top[i + 1] <= max && top[i + 2] <= max) {
      top[i] = under[i];
      top[i + 1] = under[i + 1];
      top[i + 2] = under[i + 2];
      top[i + 3] = under[i + 3];
      filled++;
    }
  }
  return filled;
}

/**
 * How far the fill reaches past the no-data mask, in pixels. Measured on real
 * tiles: the edge of a swath is not a line but a band about eight rows deep
 * where the no-data fraction climbs from 0 to 1, and the pixels in between are
 * JPEG ringing — 9 to 40 on the brightest channel, too bright for the mask and
 * too dark to be cloud. Copied through as they were, they drew as a ring of
 * dark dashes along 70°S. Six pixels covers the band and keeps the blend
 * inside a JPEG block's worth of real imagery.
 */
export const FEATHER_PX = 6;

/**
 * fillNoData with a soft edge. The mask is the no-data pixels of `top`; a
 * pixel d steps from the mask (Chebyshev, d ≤ radius) takes 1 − d/(radius+1)
 * of `under`, so the seam is a gradient rather than a step and the ringing
 * beside it is mostly `under`. Radius 0 is fillNoData. Returns the mask count.
 */
export function fillAndFeather(
  top: Uint8ClampedArray, under: Uint8ClampedArray, width: number, height: number, radius = FEATHER_PX, max = NO_DATA_MAX,
): number {
  if (top.length !== under.length) throw new Error(`fillAndFeather: ${top.length} vs ${under.length} bytes`);
  if (top.length !== width * height * 4) throw new Error(`fillAndFeather: ${width}×${height} is not ${top.length / 4} pixels`);
  const dist = new Uint8Array(width * height).fill(255);
  let frontier: number[] = [];
  let masked = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (top[i] <= max && top[i + 1] <= max && top[i + 2] <= max) { dist[p] = 0; frontier.push(p); masked++; }
  }
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
  for (let p = 0; p < width * height; p++) {
    const d = dist[p];
    if (d === 255) continue;
    const i = p * 4;
    if (d === 0) { top[i] = under[i]; top[i + 1] = under[i + 1]; top[i + 2] = under[i + 2]; top[i + 3] = under[i + 3]; continue; }
    const t = 1 - d / (radius + 1);
    for (let c = 0; c < 4; c++) top[i + c] = Math.round(top[i + c] + t * (under[i + c] - top[i + c]));
  }
  return masked;
}

/** How many pixels are still no-data — what decides whether the infrared is fetched at all. */
export function countNoData(px: Uint8ClampedArray, max = NO_DATA_MAX): number {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] <= max && px[i + 1] <= max && px[i + 2] <= max) n++;
  }
  return n;
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

  /* A transparent tile when neither day has it; the fills below treat
     transparent black as no-data like any other. */
  let out = g.createImageData(size, size);
  if (choice.mode === 'composite') {
    out = await pixelsOf(choice.top);
    fillAndFeather(out.data, (await pixelsOf(choice.under)).data, size, size);
  } else if (choice.mode === 'single') {
    out = await pixelsOf(choice.tile);
  }

  /* Third fill: the night infrared, fetched only for a tile that still has
     holes — most of the world never gets here. Its failure is not reported:
     it is a fallback for a fallback, and the tile is no worse without it. */
  if (countNoData(out.data) > 0) {
    const ir = await fetchDay(req.under, INFRARED_LAYER);
    if ('tile' in ir && ir.tile) {
      const irPixels = await pixelsOf(ir.tile);
      paintInfrared(irPixels.data);
      fillAndFeather(out.data, irPixels.data, size, size);
    }
  }

  g.putImageData(out, 0, 0);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return png.arrayBuffer();
}
