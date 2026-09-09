import { describe, it, expect } from 'vitest';
import { sampleGrid, blendWithStations } from './temperature-blend';
import type { TempGrid } from './temperature-grid';

// A flat 5x5 field at 20°C over a one-degree square.
const flat: TempGrid = { cols: 5, rows: 5, bbox: [-123, 45, -122, 46], time: 't', values: new Array(25).fill(20) };

describe('the combined model', () => {
  it('samples the field between its points', () => {
    const ramp: TempGrid = { ...flat, cols: 2, rows: 1, values: [10, 20] };
    expect(sampleGrid(ramp, 45, -122.5)).toBeCloseTo(15, 6);
    expect(sampleGrid(ramp, 44, -122.5)).toBeNull();
  });

  it('pulls the field toward a warm station nearby, and leaves it alone far away', () => {
    const out = blendWithStations(flat, [{ lat: 45.5, lng: -122.5, tempC: 24 }], 0.4, 1);
    const centre = out.values[2 * 5 + 2];      // the station's own cell
    const corner = out.values[0];              // the south-west corner, 0.7° away
    expect(centre).toBeGreaterThan(23);
    expect(corner).toBe(20);
  });

  it('trusts a thermometer at its own spot, and lets neighbours outvote it in between', () => {
    const readings = [
      { lat: 45.5, lng: -122.5, tempC: 30 },   // an outlier, on the centre cell
      { lat: 45.5, lng: -122.0, tempC: 20 },   // good neighbours either side
      { lat: 45.5, lng: -123.0, tempC: 20 },
    ];
    const out = blendWithStations(flat, readings, 0.5, 1);
    const atOutlier = out.values[2 * 5 + 2];
    const between = out.values[2 * 5 + 3];     // -122.25: equidistant from the outlier and a good station
    expect(atOutlier).toBeGreaterThan(28);     // at the thermometer, the thermometer
    expect(between).toBeGreaterThan(20);
    expect(between).toBeLessThan(26);          // half the outlier's pull, faded by distance
  });

  it('ignores stations outside the field and is a no-op with none', () => {
    expect(blendWithStations(flat, [{ lat: 50, lng: -100, tempC: 40 }]).values).toEqual(flat.values);
    expect(blendWithStations(flat, [])).toBe(flat);
  });
});
