import { contours } from 'd3-contour';
import type { TempGrid } from './temperature-grid';

/**
 * OSIRIS — a temperature field as isotherm bands.
 *
 * The grid is coarse — a few hundred points across the view — so it is first
 * upsampled by bilinear interpolation, then contoured with marching squares
 * at a fixed step. That is what gives the curves: the interpolation makes the
 * surface continuous, the contouring follows it. d3 gives nested regions —
 * everything at or above each threshold — and painting those on top of one
 * another at any opacity hides the map under the hot spots twenty times
 * over. So each region has the next one cut out of it, leaving bands that
 * tile the extent without overlap; one fill opacity is then the whole
 * translucency. There are no outlines: the colour is the whole picture,
 * and the map's borders are drawn over it instead.
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
  /** The band from `t` up to the next threshold; `label` is `t` in the chosen unit. */
  properties: { t: number; label: string };
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export type Ring = [number, number][];

/** Shoelace, signed: positive is counter-clockwise in an x-right, y-up frame such as lng/lat. */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

/** Ray casting. */
export function pointInRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function oriented(ring: Ring, outer: boolean): Ring {
  return (ringArea(ring) > 0) === outer ? ring : [...ring].reverse();
}

/**
 * A point just inside a ring: the midpoint of its first real edge, nudged
 * inward by the ring's orientation. A vertex will not do — contour rings
 * touch at saddle points and run together along the extent's edge, and a
 * vertex lying on another ring's boundary answers either way. One such
 * answer put a hole outside its outer ring, and the tessellator drew the
 * mistake as a dark wedge across a continent.
 */
export function interiorPoint(ring: Ring): [number, number] {
  const ccw = ringArea(ring) > 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = (ccw ? -dy : dy) / len, ny = (ccw ? dx : -dx) / len;
    return [(x0 + x1) / 2 + nx * 1e-5, (y0 + y1) / 2 + ny * 1e-5];
  }
  return ring[0];
}

/**
 * The region at or above one threshold minus the region at or above the
 * next: polygons with holes that cover exactly the band between them.
 *
 * Every ring of both regions is placed in one containment tree (a ring's
 * parent is the smallest ring around it). Walking down the tree, a lower
 * ring toggles being inside the lower region and an upper ring toggles the
 * upper; a node whose interior is inside the lower and outside the upper is
 * in the band, and its polygon is its ring with its children as holes.
 * Outer rings come out counter-clockwise and holes clockwise.
 */
export function bandPolygons(lower: Ring[][], upper: Ring[][]): Ring[][] {
  interface Node { ring: Ring; size: number; lower: boolean; box: [number, number, number, number]; inside: [number, number] }
  const node = (ring: Ring, isLower: boolean): Node => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { ring, size: Math.abs(ringArea(ring)), lower: isLower, box: [x0, y0, x1, y1], inside: interiorPoint(ring) };
  };
  const rings: Node[] = [];
  // Rings that rounding collapsed to nothing are dropped: invisible, and a trap for the tessellator.
  for (const poly of lower) for (const ring of poly) { const n = node(ring, true); if (n.size > 1e-10) rings.push(n); }
  for (const poly of upper) for (const ring of poly) { const n = node(ring, false); if (n.size > 1e-10) rings.push(n); }
  // Most rings are small and far apart, so the box test settles nearly every pair.
  const parent = rings.map((r, i) => {
    const [px, py] = r.inside;
    let best = -1;
    for (let j = 0; j < rings.length; j++) {
      const c = rings[j];
      if (j === i || c.size <= r.size || (best >= 0 && c.size >= rings[best].size)) continue;
      if (px < c.box[0] || px > c.box[2] || py < c.box[1] || py > c.box[3]) continue;
      if (pointInRing(r.inside, c.ring)) best = j;
    }
    return best;
  });
  const inBand = new Array<boolean>(rings.length);
  const states = new Map<number, [number, number]>();
  const state = (i: number): [number, number] => {
    const known = states.get(i);
    if (known) return known;
    const up: [number, number] = parent[i] < 0 ? [0, 0] : state(parent[i]);
    const s: [number, number] = rings[i].lower ? [up[0] + 1, up[1]] : [up[0], up[1] + 1];
    states.set(i, s);
    return s;
  };
  for (let i = 0; i < rings.length; i++) { const [lo, hi] = state(i); inBand[i] = lo % 2 === 1 && hi % 2 === 0; }
  const out: Ring[][] = [];
  for (let i = 0; i < rings.length; i++) {
    if (!inBand[i]) continue;
    const poly: Ring[] = [oriented(rings[i].ring, true)];
    for (let c = 0; c < rings.length; c++) if (parent[c] === i) poly.push(oriented(rings[c].ring, false));
    out.push(poly);
  }
  return out;
}

/**
 * The bands as GeoJSON in lng/lat. d3-contour works in cell
 * units, one per grid value with the value at the cell's centre; the
 * geographic mapping undoes that, and the padded view the grid was sampled
 * over becomes the extent of the field. Coordinates are kept to four
 * decimals (eleven metres), which halves what the map has to swallow.
 */
export function isothermBands(grid: TempGrid, unit: TempUnit, stepC = 2, factor = 6): { type: 'FeatureCollection'; features: IsothermFeature[] } {
  const up = upsample(grid.values, grid.cols, grid.rows, factor);
  const thresholds = bandThresholds(up.values, stepC);
  const [w, s, e, n] = grid.bbox;
  const toLng = (x: number) => Math.min(e, Math.max(w, w + (e - w) * (x - 0.5) / (up.cols - 1)));
  const toLat = (y: number) => Math.min(n, Math.max(s, s + (n - s) * (y - 0.5) / (up.rows - 1)));
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  const generator = contours().size([up.cols, up.rows]).thresholds(thresholds);
  const regions = generator(up.values).map(region => ({
    t: region.value,
    polygons: region.coordinates.map(poly => poly.map(ring => ring.map(([x, y]) => [round(toLng(x)), round(toLat(y))] as [number, number]))) as Ring[][],
  }));
  const features: IsothermFeature[] = [];
  regions.forEach((region, i) => {
    const props = { t: region.t, label: formatTemp(region.t, unit) };
    const band = bandPolygons(region.polygons, regions[i + 1]?.polygons ?? []);
    if (band.length) features.push({ type: 'Feature', properties: props, geometry: { type: 'MultiPolygon', coordinates: band } });
  });
  return { type: 'FeatureCollection', features };
}
