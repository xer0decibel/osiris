import { describe, it, expect } from 'vitest';
import { gfsCycles, gfsFilterUrl, toGlobalField, sampleGlobal, cropField, seriesFrom, fieldAt, gfsRequestBbox, GLOBE_BBOX, GFS_MAX_COLS, GFS_MAX_ROWS, type GlobalField } from './gfs';
import type { Grib2Field } from './grib2';

/** A 1° globe whose value is latitude × 1000 + column, so any sample is checkable by eye and survives the crop's rounding. */
function latitudeGlobe(): GlobalField {
  const ni = 360, nj = 181;
  const values = new Float32Array(ni * nj);
  for (let r = 0; r < nj; r++) for (let c = 0; c < ni; c++) values[r * ni + c] = (90 - r) * 1000 + c;
  return { ni, nj, lat1: 90, lon1: 0, dLon: 1, dLat: -1, values, run: '2026-09-09T12:00:00Z', time: '2026-09-09T12:00:00Z', resolution: '1p00' };
}

describe('GFS cycles', () => {
  it('names the runs that should be on NOMADS, newest first', () => {
    // 17:57Z: the 12Z run landed at ~15:30Z; 18Z is hours away.
    const at = Date.UTC(2026, 8, 9, 17, 57);
    expect(gfsCycles(at).map(c => `${c.date}/${c.hour}`)).toEqual(['20260909/12', '20260909/06', '20260909/00', '20260908/18']);
    expect(gfsCycles(at)[0].iso).toBe('2026-09-09T12:00:00Z');
  });

  it('waits for the lag before trusting a new run', () => {
    // 15:00Z: the 12Z run is not up yet.
    expect(gfsCycles(Date.UTC(2026, 8, 9, 15, 0))[0].hour).toBe('06');
    expect(gfsCycles(Date.UTC(2026, 8, 9, 15, 31))[0].hour).toBe('12');
  });

  it('asks the filter for one variable at one level', () => {
    const u = gfsFilterUrl({ date: '20260909', hour: '12', iso: '2026-09-09T12:00:00Z' });
    expect(u).toContain('filter_gfs_0p50.pl');
    expect(u).toContain('dir=%2Fgfs.20260909%2F12%2Fatmos');
    expect(u).toContain('file=gfs.t12z.pgrb2full.0p50.f000');
    expect(u).toContain('var_TMP=on&lev_2_m_above_ground=on');
    expect(gfsFilterUrl({ date: '20260909', hour: '00', iso: '' }, '1p00')).toContain('file=gfs.t00z.pgrb2.1p00.f000');
    expect(gfsFilterUrl({ date: '20260909', hour: '12', iso: '' }, '0p50', 9)).toContain('file=gfs.t12z.pgrb2full.0p50.f009');
  });
});

describe('the global field', () => {
  it('converts Kelvin to Celsius and refuses the wrong variable', () => {
    const field: Grib2Field = {
      discipline: 0, category: 0, parameter: 0, levelType: 103, levelValue: 2,
      referenceTime: '2026-09-09T12:00:00Z', forecastHours: 3,
      grid: { ni: 2, nj: 2, lat1: 90, lon1: 0, dLon: 180, dLat: -180 },
      values: new Float32Array([273.15, 293.15, 253.15, 303.15]),
    };
    const g = toGlobalField(field, '1p00');
    [0, 20, -20, 30].forEach((c, i) => expect(g.values[i]).toBeCloseTo(c, 4)); // float32 gives -0 for 0
    expect(g.time).toBe('2026-09-09T15:00:00Z');
    expect(() => toGlobalField({ ...field, parameter: 1 }, '1p00')).toThrow(/expected temperature/);
    expect(() => toGlobalField({ ...field, levelValue: 10 }, '1p00')).toThrow(/2 m/);
  });

  it('interpolates between the forecast hours that bracket a moment', () => {
    const frame = (hours: number, v: number): GlobalField => ({
      ni: 2, nj: 1, lat1: 0, lon1: 0, dLon: 180, dLat: -1, values: new Float32Array([v, v * 2]),
      run: '2026-09-09T12:00:00Z', time: new Date(Date.UTC(2026, 8, 9, 12 + hours)).toISOString().replace('.000Z', 'Z'), resolution: '1p00',
    });
    const series = seriesFrom([frame(6, 30), frame(0, 10), frame(3, 20)]);
    expect(series.frames.map(f => f.time.slice(11, 13))).toEqual(['12', '15', '18']);
    const at = (h: number, m = 0) => fieldAt(series, Date.UTC(2026, 8, 9, 12 + h, m));
    expect(Array.from(at(0).values)).toEqual([10, 20]);
    expect(Array.from(at(1, 30).values)).toEqual([15, 30]);          // halfway from f000 to f003
    expect(Array.from(at(4).values).map(v => Math.round(v * 100) / 100)).toEqual([23.33, 46.67]);
    expect(Array.from(at(9).values)).toEqual([30, 60]);              // past the last frame: the last frame
    expect(at(1, 30).time).toBe('2026-09-09T13:30:00Z');
    expect(() => seriesFrom([frame(0, 1), { ...frame(3, 1), ni: 3 }])).toThrow(/different grids/);
  });

  it('samples the nearest cell, wrapping longitude and clamping latitude', () => {
    const g = latitudeGlobe();
    expect(sampleGlobal(g, 45, 10)).toBe(45010);
    expect(sampleGlobal(g, 45, -170)).toBe(45190);   // west of the antimeridian is column 190
    expect(sampleGlobal(g, 45, -180)).toBe(45180);   // the antimeridian is column 180
    expect(sampleGlobal(g, -90, 0)).toBe(-90000);
    expect(sampleGlobal(g, 95, 0)).toBe(90000);                // off the top clamps to the first row
  });

  it('crops a view at the model resolution, never finer', () => {
    const g = latitudeGlobe();
    const crop = cropField(g, [-125, 40, -115, 50]);
    expect(crop.cols).toBe(11);
    expect(crop.rows).toBe(11);
    expect(crop.bbox).toEqual([-125, 40, -115, 50]);
    expect(crop.values[0]).toBe(40235);                 // south-west: lat 40, lon 235
    expect(crop.values[crop.values.length - 1]).toBe(50245); // north-east
    expect(crop.time).toBe('2026-09-09T12:00:00Z');
  });

  it('caps the globe at the client budget, on a whole-cell stride', () => {
    const crop = cropField(latitudeGlobe(), [-180, -85, 180, 85]);
    expect(crop.cols).toBeLessThanOrEqual(GFS_MAX_COLS + 1);
    expect(crop.rows).toBeLessThanOrEqual(GFS_MAX_ROWS + 1);
    expect(crop.bbox).toEqual([-180, -86, 180, 86]); // every second cell of a 1° globe, edges on multiples of two
    expect(crop.cols).toBe(181);
    expect(crop.rows).toBe(87);
    expect(crop.values[0]).toBe(-85820); // lat -86, and -180 is column 180
    // The real model is 0.5°: the same budget makes the globe a three-cell stride, 1.5°.
    const half: GlobalField = { ...latitudeGlobe(), ni: 720, nj: 361, dLon: 0.5, dLat: -0.5, values: new Float32Array(720 * 361) };
    const fine = cropField(half, GLOBE_BBOX);
    expect((fine.bbox[2] - fine.bbox[0]) / (fine.cols - 1)).toBe(1.5);
  });

  it('asks for the whole globe once the view is wide, and twice the view before that', () => {
    expect(gfsRequestBbox([-100, 10, 20, 60])).toEqual(GLOBE_BBOX);
    expect(gfsRequestBbox([-130, 30, -90, 50])).toEqual([-150, 20, -70, 60]);
    expect(gfsRequestBbox([-170, 70, -100, 84])).toEqual([-180, 63, -65, 85]);
  });

  it('samples the same cells for two views that overlap, so a pan does not shift the bands', () => {
    const g = latitudeGlobe();
    const a = cropField(g, [-125, 40, -115, 50]);
    const b = cropField(g, [-124.3, 40.6, -114.2, 50.7]);
    expect(b.bbox).toEqual([-125, 40, -114, 51]);
    const at = (grid: ReturnType<typeof cropField>, lat: number, lng: number) => {
      const c = Math.round((lng - grid.bbox[0]) / ((grid.bbox[2] - grid.bbox[0]) / (grid.cols - 1)));
      const r = Math.round((lat - grid.bbox[1]) / ((grid.bbox[3] - grid.bbox[1]) / (grid.rows - 1)));
      return grid.values[r * grid.cols + c];
    };
    for (const [lat, lng] of [[45, -120], [41, -124], [50, -115]]) expect(at(b, lat, lng)).toBe(at(a, lat, lng));
    expect(at(a, 45, -120)).toBe(45240);
  });
});
