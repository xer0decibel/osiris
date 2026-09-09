/**
 * OSIRIS — the combined model: a modelled field nudged toward thermometers.
 *
 * Open-Meteo's number at each grid point is a model's estimate; a station's
 * number is measured air. Where the two disagree the field is pulled toward
 * the station, by the station's residual (measured minus modelled at its
 * spot) weighted by inverse-distance squared, fading to nothing at a radius.
 * Several stations combine by their weights, so one bad thermometer among
 * good neighbours is outvoted rather than obeyed. Far from any station the
 * field is the model alone, which is also the whole answer outside the US.
 */
import type { TempGrid } from './temperature-grid';

export interface Reading { lat: number; lng: number; tempC: number }

/** The grid's value at a point, bilinear between its four neighbours. Null cells fall back to the mean. */
export function sampleGrid(grid: TempGrid, lat: number, lng: number): number | null {
  const [w, s, e, n] = grid.bbox;
  if (lng < w || lng > e || lat < s || lat > n) return null;
  const finite = grid.values.filter((v): v is number => v !== null);
  if (!finite.length) return null;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const at = (c: number, r: number) => grid.values[Math.min(grid.rows - 1, r) * grid.cols + Math.min(grid.cols - 1, c)] ?? mean;
  const gx = (grid.cols - 1) * (lng - w) / (e - w), gy = (grid.rows - 1) * (lat - s) / (n - s);
  const c0 = Math.floor(gx), r0 = Math.floor(gy), fx = gx - c0, fy = gy - r0;
  const top = at(c0, r0) * (1 - fx) + at(c0 + 1, r0) * fx;
  const bottom = at(c0, r0 + 1) * (1 - fx) + at(c0 + 1, r0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Nudge the grid toward the readings. `radiusDeg` is how far a station's
 * influence reaches; `strength` is how much of the residual is applied right
 * at the station (1 would make the field pass through it exactly).
 */
export function blendWithStations(grid: TempGrid, readings: Reading[], radiusDeg = 0.8, strength = 0.85): TempGrid {
  const residuals = readings
    .map(r => ({ ...r, d: (() => { const m = sampleGrid(grid, r.lat, r.lng); return m === null ? null : r.tempC - m; })() }))
    .filter((r): r is Reading & { d: number } => r.d !== null && Number.isFinite(r.d));
  if (!residuals.length) return grid;
  const [w, s, e, n] = grid.bbox;
  const values = grid.values.map((v, i) => {
    if (v === null) return v;
    const c = i % grid.cols, r = Math.floor(i / grid.cols);
    const lng = w + (e - w) * (grid.cols === 1 ? 0 : c / (grid.cols - 1));
    const lat = s + (n - s) * (grid.rows === 1 ? 0 : r / (grid.rows - 1));
    let num = 0, den = 0;
    for (const st of residuals) {
      const dist = Math.hypot((st.lng - lng) * Math.cos((lat * Math.PI) / 180), st.lat - lat);
      if (dist >= radiusDeg) continue;
      const wgt = 1 / (dist * dist + 1e-4);
      num += wgt * st.d;
      den += wgt;
    }
    if (den === 0) return v;
    // Fade with distance to the nearest station so the nudge does not stop at a cliff.
    const nearest = Math.min(...residuals.map(st => Math.hypot((st.lng - lng) * Math.cos((lat * Math.PI) / 180), st.lat - lat)));
    const fade = 1 - nearest / radiusDeg;
    return v + strength * fade * (num / den);
  });
  return { ...grid, values };
}
