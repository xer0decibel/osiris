/**
 * OSIRIS — the global temperature field, from NOAA's GFS model.
 *
 * Zoomed in, the temperature layer asks Open-Meteo for a grid of points and
 * that budget is spent per point: a globe at any useful spacing would cost
 * more in an hour than the free tier allows in a day. NOAA publishes the GFS
 * analysis every six hours as a gridded GRIB2 file, public domain, keyless,
 * and its NOMADS filter hands back just the 2 m temperature for the whole
 * globe at half a degree in one 160 KB request. That is the globe's source:
 * one download per model run, decoded once, cropped for each view.
 *
 * What it is not: current. The analysis is the model's state at the run
 * hour, published about three and a half hours later, so the field is
 * typically four to nine hours old. The legend says which run.
 */
import type { Grib2Field } from './grib2';
import { GRID_MAX_POINTS, type Bbox, type TempGrid } from './temperature-grid';

export type GfsResolution = '1p00' | '0p50' | '0p25';
export const GFS_RESOLUTION: GfsResolution = '0p50';
/** A padded view wider than this, in degrees, takes the GFS field instead of Open-Meteo points. */
export const GFS_MIN_SPAN = 20;
/** The most cells a cropped field carries: 180×91 is the globe at 2°, and the client upsamples. */
export const GFS_MAX_COLS = 180;
export const GFS_MAX_ROWS = 91;
/** GFS runs at 00, 06, 12 and 18Z; the f000 file lands on NOMADS about this long after. */
export const GFS_LAG_MS = 3.5 * 3600_000;

export interface GfsCycle {
  /** YYYYMMDD, UTC. */
  date: string;
  /** '00' | '06' | '12' | '18'. */
  hour: string;
  /** The run's reference time, ISO. */
  iso: string;
}

/** The runs that should be published by `nowMs`, newest first. */
export function gfsCycles(nowMs: number, count = 4): GfsCycle[] {
  const out: GfsCycle[] = [];
  let t = Math.floor((nowMs - GFS_LAG_MS) / (6 * 3600_000)) * 6 * 3600_000;
  for (let i = 0; i < count; i++, t -= 6 * 3600_000) {
    const d = new Date(t);
    const date = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    out.push({ date, hour: String(d.getUTCHours()).padStart(2, '0'), iso: d.toISOString().replace('.000Z', 'Z') });
  }
  return out;
}

/** NOMADS' filter: one variable at one level from one file, as GRIB2. */
export function gfsFilterUrl(cycle: GfsCycle, resolution: GfsResolution = GFS_RESOLUTION): string {
  const file = resolution === '0p50' ? `gfs.t${cycle.hour}z.pgrb2full.0p50.f000` : `gfs.t${cycle.hour}z.pgrb2.${resolution}.f000`;
  return `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_${resolution}.pl`
    + `?dir=%2Fgfs.${cycle.date}%2F${cycle.hour}%2Fatmos&file=${file}&var_TMP=on&lev_2_m_above_ground=on`;
}

export interface GlobalField {
  ni: number;
  nj: number;
  lat1: number;
  lon1: number;
  dLon: number;
  dLat: number;
  /** Celsius, row-major from the first point. */
  values: Float32Array;
  /** The run, ISO. */
  run: string;
  /** The field's valid time, ISO — the run plus the forecast hour. */
  time: string;
  resolution: GfsResolution;
}

/** The decoded GRIB2 field as the globe, in Celsius, checked to be what was asked for. */
export function toGlobalField(field: Grib2Field, resolution: GfsResolution): GlobalField {
  if (field.discipline !== 0 || field.category !== 0 || field.parameter !== 0) throw new Error(`GFS: expected temperature, got ${field.discipline}/${field.category}/${field.parameter}`);
  if (field.levelType !== 103 || field.levelValue !== 2) throw new Error(`GFS: expected 2 m above ground, got level ${field.levelType}/${field.levelValue}`);
  const values = new Float32Array(field.values.length);
  for (let i = 0; i < values.length; i++) values[i] = field.values[i] - 273.15;
  const time = new Date(new Date(field.referenceTime).getTime() + field.forecastHours * 3600_000).toISOString().replace('.000Z', 'Z');
  return { ...field.grid, values, run: field.referenceTime, time, resolution };
}

/** The native cell nearest a point; longitudes wrap, latitudes clamp. */
export function sampleGlobal(f: GlobalField, lat: number, lng: number): number {
  const col = ((Math.round((((lng - f.lon1) % 360) + 360) % 360 / f.dLon) % f.ni) + f.ni) % f.ni;
  const row = Math.min(f.nj - 1, Math.max(0, Math.round((lat - f.lat1) / f.dLat)));
  return f.values[row * f.ni + col];
}

/**
 * The field cropped to a view, in the shape the isotherm code already reads.
 * At most `maxCols` × `maxRows` cells, and never finer than the model: a
 * view narrower than the lattice gets the cells it covers, not invented ones.
 */
export function cropField(f: GlobalField, bbox: Bbox, maxCols = GFS_MAX_COLS, maxRows = GFS_MAX_ROWS): TempGrid {
  const [w, s, e, n] = bbox;
  const cols = Math.max(2, Math.min(maxCols, Math.floor((e - w) / f.dLon) + 1));
  const rows = Math.max(2, Math.min(maxRows, Math.floor((n - s) / Math.abs(f.dLat)) + 1));
  if (cols * rows > Math.max(GRID_MAX_POINTS, maxCols * maxRows)) throw new Error('GFS: crop too large');
  const values = new Array<number | null>(cols * rows);
  for (let r = 0; r < rows; r++) {
    const lat = s + (n - s) * r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const lng = w + (e - w) * c / (cols - 1);
      const v = sampleGlobal(f, lat, lng);
      values[r * cols + c] = Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
    }
  }
  return { cols, rows, bbox, values, time: f.time };
}
