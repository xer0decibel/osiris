/**
 * OSIRIS — the temperature ramp, shared by the picture, the legend and the
 * station dots.
 *
 * This file once held the contouring: d3-contour bands, each with the next
 * cut out of it so they did not overlap. On the globe that kept going wrong
 * in new ways, and the field is now painted instead — see
 * lib/temperature-raster. What remains here is the colour.
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

/** MapLibre's version of the same ramp, for a colour keyed on a feature's Celsius. */
export function tempColorExpression(property = 't'): unknown[] {
  return ['interpolate', ['linear'], ['get', property], ...TEMP_STOPS.flat()];
}
