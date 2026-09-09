import { describe, it, expect } from 'vitest';
import { cToF, formatTemp, tempColor, tempColorExpression, upsample, bandThresholds, isothermBands, bandPolygons, ringArea, pointInRing, TEMP_STOPS, type Ring } from './isotherms';
import type { TempGrid } from './temperature-grid';

// A 4x3 field warming from west to east: 10..16 across, flat north-south.
const grid: TempGrid = {
  cols: 4, rows: 3, bbox: [-125, 42, -116, 49], time: '2026-09-09T16:45',
  values: [10, 12, 14, 16, 10, 12, 14, 16, 10, 12, 14, 16],
};

describe('units and colours', () => {
  it('converts and formats in either unit', () => {
    expect(cToF(0)).toBe(32);
    expect(cToF(100)).toBe(212);
    expect(formatTemp(20, 'C')).toBe('20°C');
    expect(formatTemp(20, 'F')).toBe('68°F');
  });

  it('colours warmer as redder, and clamps at the ends', () => {
    expect(tempColor(-50)).toBe(TEMP_STOPS[0][1]);
    expect(tempColor(60)).toBe(TEMP_STOPS[TEMP_STOPS.length - 1][1]);
    const cool = tempColor(5), warm = tempColor(35);
    const red = (s: string) => Number(s.match(/rgb\((\d+)/)?.[1]);
    expect(red(warm)).toBeGreaterThan(red(cool));
  });

  it('hands the map the same ramp', () => {
    const e = tempColorExpression();
    expect(e[0]).toBe('interpolate');
    expect(e).toContain('#e3d534');
  });
});

describe('field to bands', () => {
  it('upsamples bilinearly, keeping the corners and filling between', () => {
    const up = upsample([0, 10, 0, 10], 2, 2, 2);
    expect(up.cols).toBe(3);
    expect(up.rows).toBe(3);
    expect(up.values[0]).toBe(0);
    expect(up.values[1]).toBe(5);
    expect(up.values[2]).toBe(10);
  });

  it('fills a missing value from the mean rather than dropping it', () => {
    const up = upsample([10, null, 10, 10], 2, 2, 1);
    expect(up.values[1]).toBe(10);
  });

  it('spans the field at a fixed step', () => {
    expect(bandThresholds([10.4, 15.9], 2)).toEqual([10, 12, 14, 16]);
    expect(bandThresholds([], 2)).toEqual([]);
  });

  it('makes bands and isolines in lng/lat, hotter ones toward the warmer east', () => {
    const all = isothermBands(grid, 'F', 2, 2);
    const fc = { ...all, features: all.features.filter(f => f.properties.kind === 'line') };
    expect(fc.features.length).toBeGreaterThan(2);
    expect(all.features.filter(f => f.properties.kind === 'band').length).toBeGreaterThan(2);
    const ts = fc.features.map(f => f.properties.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    for (const f of fc.features) {
      expect(f.properties.label.endsWith('°F')).toBe(true);
      for (const poly of f.geometry.coordinates) for (const ring of poly) for (const [lng, lat] of ring) {
        expect(lng).toBeGreaterThanOrEqual(-125); expect(lng).toBeLessThanOrEqual(-116);
        expect(lat).toBeGreaterThanOrEqual(42); expect(lat).toBeLessThanOrEqual(49);
      }
    }
    // The 16°C band, the hottest, must sit further east than the 12°C band.
    const west = (t: number) => Math.min(...fc.features.find(f => f.properties.t === t)!.geometry.coordinates.flat(2).map(p => p[0]));
    expect(west(16)).toBeGreaterThan(west(12));
  });

  it('cuts the next region out of each, so the bands tile the extent without overlap', () => {
    // A hot spot in the middle of a cool plain: nested regions, a ring band with a hole.
    const bump: TempGrid = {
      cols: 5, rows: 5, bbox: [0, 0, 10, 10], time: 't',
      values: [
        5, 5, 5, 5, 5,
        5, 15, 15, 15, 5,
        5, 15, 25, 15, 5,
        5, 15, 15, 15, 5,
        5, 5, 5, 5, 5,
      ],
    };
    const bands = isothermBands(bump, 'C', 10, 4).features.filter(f => f.properties.kind === 'band');
    const area = (poly: Ring[]) => poly.reduce((a, ring, i) => a + (i === 0 ? Math.abs(ringArea(ring)) : -Math.abs(ringArea(ring))), 0);
    const total = bands.reduce((a, f) => a + (f.geometry.coordinates as Ring[][]).reduce((b, poly) => b + area(poly), 0), 0);
    expect(total).toBeCloseTo(100, 0); // the whole 10×10 extent, once
    // The coolest band is the plain with the warm middle cut out of it.
    const coolest = bands[0].geometry.coordinates as Ring[][];
    expect(coolest[0].length).toBe(2);
    expect(ringArea(coolest[0][0])).toBeGreaterThan(0); // outer counter-clockwise
    expect(ringArea(coolest[0][1])).toBeLessThan(0);    // hole clockwise
    // The centre lies in exactly one band, and so does a corner.
    const within = (pt: [number, number]) => bands.filter(f => (f.geometry.coordinates as Ring[][]).some(poly => pointInRing(pt, poly[0]) && !poly.slice(1).some(h => pointInRing(pt, h))));
    expect(within([5, 5]).map(f => f.properties.t)).toEqual([20]);
    expect(within([0.5, 0.5]).map(f => f.properties.t)).toEqual([0]);
  });

  it('keeps a cool island inside a hot region in the cool band', () => {
    const square = (x0: number, y0: number, x1: number, y1: number): Ring => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    // Lower region: the whole extent. Upper region: a hot block with a cool pocket in it.
    const lower: Ring[][] = [[square(0, 0, 10, 10)]];
    const upper: Ring[][] = [[square(2, 2, 8, 8), [...square(4, 4, 6, 6)].reverse()]];
    const band = bandPolygons(lower, upper);
    expect(band).toHaveLength(2);
    expect(band[0][0].length).toBe(5); expect(band[0]).toHaveLength(2); // the plain, with the block cut out
    expect(Math.abs(ringArea(band[1][0]))).toBeCloseTo(4, 5);            // and the pocket, on its own
  });
});
