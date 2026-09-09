/**
 * OSIRIS — the temperature field's grid, and where it comes from.
 *
 * The map's own temperature layer was NASA's AIRS swath imagery, and it was
 * splotchy: raw satellite passes with gaps between them, at 45km. There is no
 * gridded daily air-temperature tile anywhere keyless that is not blocky or a
 * month old. So the field is built here instead: a grid of points across the
 * view, each asked of Open-Meteo for its current 2m air temperature — one
 * request, a few hundred points, about a second — and contoured on the client
 * into isotherm bands. Open-Meteo is keyless and free for non-commercial use
 * under CC BY 4.0, which the legend credits; a commercial build needs their
 * paid tier, and the feed audit should say so.
 */
export type Bbox = [west: number, south: number, east: number, north: number];

export interface TempGrid {
  cols: number;
  rows: number;
  bbox: Bbox;
  /** Row-major from the south-west corner: index r * cols + c. Celsius. */
  values: (number | null)[];
  /** ISO time of the observation, from the provider. */
  time: string;
}

/**
 * Default grid. Open-Meteo's free tier counts every location in a request as
 * a call, about 600 a minute: a 24×16 grid was 384 of them, and a few pans
 * earned an HTTP 429 that blanked the layer. 12×8 is 96, and after six-fold
 * bilinear upsampling the curves are as smooth as before.
 */
export const GRID_COLS = 12;
export const GRID_ROWS = 8;
/** Keeps a client from asking for thousands. */
export const GRID_MAX_POINTS = 200;

/**
 * Snap a view outward to a lattice, so nearby views ask for the same field
 * and the route's cache answers a pan instead of the provider. A quarter of a
 * degree at neighbourhood zooms; wider views snap to a degree.
 */
export function snapBbox(b: Bbox): Bbox {
  const span = Math.max(b[2] - b[0], b[3] - b[1]);
  const step = span > 4 ? 1 : span > 1 ? 0.5 : 0.25;
  const down = (n: number) => Math.floor(n / step) * step;
  const up = (n: number) => Math.ceil(n / step) * step;
  return [Math.max(-180, down(b[0])), Math.max(-85, down(b[1])), Math.min(180, up(b[2])), Math.min(85, up(b[3]))];
}

/** True when `outer` contains `inner`. */
export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

export function parseBbox(s: string | null | undefined): Bbox | null {
  if (!s) return null;
  const n = s.split(',').map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return null;
  const [w, so, e, no] = n;
  if (e <= w || no <= so || w < -180 || e > 180 || so < -90 || no > 90) return null;
  return [w, so, e, no];
}

/** Grow a view by a fraction each side, so contours run off the edges rather than stopping at them. */
export function padBbox(b: Bbox, fraction = 0.2): Bbox {
  const dw = (b[2] - b[0]) * fraction, dh = (b[3] - b[1]) * fraction;
  return [Math.max(-180, b[0] - dw), Math.max(-85, b[1] - dh), Math.min(180, b[2] + dw), Math.min(85, b[3] + dh)];
}

/** The sample points, row-major from the south-west corner, matching TempGrid.values. */
export function gridPoints(b: Bbox, cols: number, rows: number): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const lat = b[1] + (b[3] - b[1]) * (rows === 1 ? 0 : r / (rows - 1));
    for (let c = 0; c < cols; c++) {
      const lng = b[0] + (b[2] - b[0]) * (cols === 1 ? 0 : c / (cols - 1));
      out.push({ lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) });
    }
  }
  return out;
}

/** The provider's request for those points. */
export function openMeteoUrl(points: { lat: number; lng: number }[]): string {
  return 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${points.map(p => p.lat).join(',')}`
    + `&longitude=${points.map(p => p.lng).join(',')}`
    + '&current=temperature_2m&temperature_unit=celsius';
}

/** Open-Meteo answers one object per point, or a bare object for a single point. */
export function readOpenMeteo(body: unknown, expected: number): { values: (number | null)[]; time: string } | null {
  const list = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
  if (list.length !== expected) return null;
  const values = list.map(item => {
    const v = (item as { current?: { temperature_2m?: unknown } }).current?.temperature_2m;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
  const time = String((list[0] as { current?: { time?: unknown } }).current?.time ?? '');
  return { values, time };
}
