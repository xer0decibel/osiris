import { describe, it, expect } from 'vitest';
import { cToF, formatTemp, tempColor, tempColorExpression, upsample, bandThresholds, isothermBands, TEMP_STOPS } from './isotherms';
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

  it('makes nested bands in lng/lat, hotter ones inside the warmer east', () => {
    const fc = isothermBands(grid, 'F', 2, 2);
    expect(fc.features.length).toBeGreaterThan(2);
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
});
