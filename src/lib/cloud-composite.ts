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

export const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const CLOUD_LAYER = 'VIIRS_NOAA20_CorrectedReflectance_TrueColor';
export const CLOUD_PROTOCOL = 'osiris-clouds';
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
export function gibsTileTemplate(date: string): string {
  return `${GIBS}/${CLOUD_LAYER}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
}

export function gibsTileUrl(date: string, z: number, y: number, x: number): string {
  return gibsTileTemplate(date)
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
 * MapLibre's loader for `osiris-clouds://` tiles. Main thread only — it needs
 * fetch, createImageBitmap and OffscreenCanvas. Returns encoded image bytes,
 * which is the one form the library documents for a custom protocol.
 *
 * If only one day can be fetched, that day is returned alone; the layer is
 * then no worse than it was before this existed. Both failing is an error,
 * and MapLibre leaves the tile empty.
 */
export async function loadCompositeTile(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const req = parseCompositeUrl(url);
  if (!req) throw new Error(`Not a cloud composite URL: ${url}`);

  const fetchTile = async (date: string): Promise<Blob> => {
    const res = await fetch(gibsTileUrl(date, req.z, req.y, req.x), { signal });
    if (!res.ok) throw new Error(`GIBS ${res.status} for ${date}`);
    return res.blob();
  };

  const [top, under] = await Promise.allSettled([fetchTile(req.top), fetchTile(req.under)]);
  if (top.status === 'rejected' && under.status === 'rejected') throw top.reason;
  if (top.status === 'rejected') return (under as PromiseFulfilledResult<Blob>).value.arrayBuffer();
  if (under.status === 'rejected') return top.value.arrayBuffer();

  const size = CLOUD_TILE_SIZE;
  const paint = async (blob: Blob) => {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(size, size);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('No 2d context for cloud tile');
    g.drawImage(bitmap, 0, 0, size, size);
    bitmap.close();
    return { canvas, g, pixels: g.getImageData(0, 0, size, size) };
  };
  const [a, b] = await Promise.all([paint(top.value), paint(under.value)]);
  fillNoData(a.pixels.data, b.pixels.data);
  a.g.putImageData(a.pixels, 0, 0);
  const png = await a.canvas.convertToBlob({ type: 'image/png' });
  return png.arrayBuffer();
}
