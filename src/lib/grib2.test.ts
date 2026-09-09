import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { readGrib2 } from './grib2';

/**
 * A real NOMADS answer: GFS 2 m temperature at 1°, the 12Z run of
 * 2026-09-09, 48 KB. Template 5.3 — complex packing with second-order
 * spatial differencing — which is what every GFS surface field carries.
 * The expected values were produced by an independent decoder (grib2class)
 * on the same file; every one of its 65,160 values agreed to the bit.
 */
const fixture = () => new Uint8Array(readFileSync(fileURLToPath(new URL('./__fixtures__/gfs-tmp2m-1p00-2026-09-09-12z.grb2', import.meta.url))));

describe('the GRIB2 reader', () => {
  it('reads what the field is, and when', () => {
    const [f] = readGrib2(fixture());
    expect(f.discipline).toBe(0);
    expect(f.category).toBe(0);
    expect(f.parameter).toBe(0);
    expect(f.levelType).toBe(103);
    expect(f.levelValue).toBe(2);
    expect(f.referenceTime).toBe('2026-09-09T12:00:00Z');
    expect(f.forecastHours).toBe(0);
    expect(f.grid).toEqual({ ni: 360, nj: 181, lat1: 90, lon1: 0, dLon: 1, dLat: -1 });
  });

  it('unpacks complex packing with spatial differencing to the same values as an independent decoder', () => {
    const [f] = readGrib2(fixture());
    const v = f.values;
    expect(v.length).toBe(65160);
    // The pole row is one value all the way round.
    for (let c = 0; c < 10; c++) expect(v[c]).toBeCloseTo(261.57, 2);
    // Row 90 is the equator.
    expect(Array.from(v.subarray(90 * 360, 90 * 360 + 6)).map(x => Number(x.toFixed(2)))).toEqual([297.37, 297.37, 297.37, 297.57, 297.77, 297.97]);
    let min = Infinity, max = -Infinity;
    for (const x of v) { if (x < min) min = x; if (x > max) max = x; }
    expect(min).toBeCloseTo(202.47, 2);
    expect(max).toBeCloseTo(319.67, 2);
    // Portland, 05:00 local: 12.1 °C. London, 13:00: 18.0 °C.
    const at = (lat: number, lng: number) => v[(90 - lat) * 360 + ((lng + 360) % 360)];
    expect(at(45, -123) - 273.15).toBeCloseTo(12.1, 1);
    expect(at(51, 0) - 273.15).toBeCloseTo(18.0, 1);
  });

  it('refuses what it does not read, by name', () => {
    expect(() => readGrib2(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))).toThrow(/no GRIB marker/);
    const grib1 = fixture(); grib1[7] = 1;
    expect(() => readGrib2(grib1)).toThrow(/edition 1/);
  });
});
