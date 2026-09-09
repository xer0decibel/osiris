import { contours } from 'd3-contour';
import type { TempGrid } from './temperature-grid';

/**
 * OSIRIS — a temperature field as isotherm bands.
 *
 * The grid is coarse — a few hundred points across the view — so it is first
 * upsampled by bilinear interpolation, then contoured with marching squares
 * at a fixed step. That is what gives the curves: the interpolation makes the
 * surface continuous, the contouring follows it. Each band is a polygon of
 * everything at or above its threshold, and the map paints them in threshold
 * order so the hotter bands sit on top.
 */

export type TempUnit = 'C' | 'F';

export const cToF = (c: number) => c * 9 / 5 + 32;
export const formatTemp = (c: number, unit: TempUnit) => `${Math.round(unit === 'F' ? cToF(c) : c)}°${unit}`;

/** The colour ramp, Celsius to hex. The legend and the map share it. */
export const TEMP_STOPS: [number, string][] = [
  [-30, '#2c0a5c'], [-20, '#3d1a9b'], [-10, '#2456c9'], [0, '#1fa3d8'],
  [10, '#2fbf71'], [20, '#e3d534'], [30, '#f28c1c'], [40, '#d92b2b'], [50, '#7a0f0f'],
];

function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** The ramp colour for a Celsius value, linear between stops, clamped at the ends. */
export function tempColor(c: number): string {
  if (c <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, h1] = TEMP_STOPS[i];
    if (c <= t1) {
      const [t0, h0] = TEMP_STOPS[i - 1];
      const f = (c - t0) / (t1 - t0);
      const a = hexToRgb(h0), b = hexToRgb(h1);
      const mix = a.map((v, k) => Math.round(v + (b[k] - v) * f));
      return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1];
}

/** MapLibre's version of the same ramp, for a fill keyed on the band's Celsius. */
export function tempColorExpression(property = 't'): unknown[] {
  return ['interpolate', ['linear'], ['get', property], ...TEMP_STOPS.flat()];
}

/** Bilinear upsampling by an integer factor; nulls are filled from the grid mean first. */
export function upsample(values: (number | null)[], cols: number, rows: number, factor: number): { values: number[]; cols: number; rows: number } {
  const finite = values.filter((v): v is number => v !== null);
  const mean = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0;
  const v = values.map(x => (x === null ? mean : x));
  const at = (c: number, r: number) => v[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  const C = (cols - 1) * factor + 1, R = (rows - 1) * factor + 1;
  const out = new Array<number>(C * R);
  for (let y = 0; y < R; y++) {
    const gy = y / factor, r0 = Math.floor(gy), fy = gy - r0;
    for (let x = 0; x < C; x++) {
      const gx = x / factor, c0 = Math.floor(gx), fx = gx - c0;
      const top = at(c0, r0) * (1 - fx) + at(c0 + 1, r0) * fx;
      const bottom = at(c0, r0 + 1) * (1 - fx) + at(c0 + 1, r0 + 1) * fx;
      out[y * C + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return { values: out, cols: C, rows: R };
}

/** Thresholds at a fixed Celsius step spanning the field. */
export function bandThresholds(values: number[], stepC = 2): number[] {
  let min = Infinity, max = -Infinity;
  for (const x of values) { if (x < min) min = x; if (x > max) max = x; }
  if (!Number.isFinite(min)) return [];
  const lo = Math.floor(min / stepC) * stepC, hi = Math.ceil(max / stepC) * stepC;
  const out: number[] = [];
  for (let t = lo; t <= hi; t += stepC) out.push(t);
  return out;
}

export interface IsothermFeature {
  type: 'Feature';
  properties: { t: number; label: string };
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
}

/**
 * The bands as GeoJSON in lng/lat. d3-contour works in cell units, one per
 * grid value with the value at the cell's centre; the geographic mapping
 * undoes that, and the padded view the grid was sampled over becomes the
 * extent of the field.
 */
export function isothermBands(grid: TempGrid, unit: TempUnit, stepC = 2, factor = 6): { type: 'FeatureCollection'; features: IsothermFeature[] } {
  const up = upsample(grid.values, grid.cols, grid.rows, factor);
  const thresholds = bandThresholds(up.values, stepC);
  const [w, s, e, n] = grid.bbox;
  const toLng = (x: number) => Math.min(e, Math.max(w, w + (e - w) * (x - 0.5) / (up.cols - 1)));
  const toLat = (y: number) => Math.min(n, Math.max(s, s + (n - s) * (y - 0.5) / (up.rows - 1)));
  const generator = contours().size([up.cols, up.rows]).thresholds(thresholds);
  const features: IsothermFeature[] = generator(up.values).map(band => ({
    type: 'Feature',
    properties: { t: band.value, label: formatTemp(band.value, unit) },
    geometry: {
      type: 'MultiPolygon',
      coordinates: band.coordinates.map(poly => poly.map(ring => ring.map(([x, y]) => [toLng(x), toLat(y)]))),
    },
  }));
  return { type: 'FeatureCollection', features };
}
