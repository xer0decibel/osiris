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
 * A run's analysis is the model's state at the run hour, published about
 * three and a half hours later, so on its own it is four to nine hours
 * old — and six hours from the Open-Meteo field the map switches to when
 * zoomed in, which made the switch a jump. So the run's forecast hours are
 * fetched too (every three hours out to twelve, five small files) and the
 * field is interpolated between the two that bracket the present. The
 * globe is then "now" as well, and the two sources agree to a degree or so.
 */
import type { Grib2Field } from './grib2';
import { GRID_MAX_POINTS, type Bbox, type TempGrid } from './temperature-grid';

export type GfsResolution = '1p00' | '0p50' | '0p25';
export const GFS_RESOLUTION: GfsResolution = '0p50';
/** A padded view wider than this, in degrees, takes the GFS field instead of Open-Meteo points. */
export const GFS_MIN_SPAN = 20;
/** The most cells a cropped field carries: 242×123 lets the whole globe come at 1.5° (a three-cell stride); the client upsamples. */
export const GFS_MAX_COLS = 242;
export const GFS_MAX_ROWS = 123;
/** A padded view wider than this asks for the whole globe, so no edge of the field can ever be turned into view. */
export const GFS_GLOBE_SPAN = 90;
export const GLOBE_BBOX: Bbox = [-180, -85, 180, 85];

/**
 * What to ask the GFS route for, given the padded view. Wide views get the
 * whole globe: on the globe projection the view's box is only the half in
 * front, and a field cut to it shows its corner as soon as the globe turns.
 * Narrower views get twice their width and height, so a pan has room
 * before the field must be asked for again.
 */
export function gfsRequestBbox(padded: Bbox): Bbox {
  const w = padded[2] - padded[0], h = padded[3] - padded[1];
  if (Math.max(w, h) > GFS_GLOBE_SPAN) return GLOBE_BBOX;
  return [Math.max(-180, padded[0] - w / 2), Math.max(-85, padded[1] - h / 2), Math.min(180, padded[2] + w / 2), Math.min(85, padded[3] + h / 2)];
}
/** GFS runs at 00, 06, 12 and 18Z; the f000 file lands on NOMADS about this long after. */
export const GFS_LAG_MS = 3.5 * 3600_000;
/** The forecast hours fetched per run: enough to bracket any moment until the next run is up, and a little past. */
export const GFS_HOURS = [0, 3, 6, 9, 12];

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

/** NOMADS' filter: one variable at one level from one forecast-hour file, as GRIB2. */
export function gfsFilterUrl(cycle: GfsCycle, resolution: GfsResolution = GFS_RESOLUTION, hour = 0): string {
  const f = `f${String(hour).padStart(3, '0')}`;
  const file = resolution === '0p50' ? `gfs.t${cycle.hour}z.pgrb2full.0p50.${f}` : `gfs.t${cycle.hour}z.pgrb2.${resolution}.${f}`;
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

/** One run's forecast hours, on one grid. */
export interface GlobalSeries {
  run: string;
  resolution: GfsResolution;
  frames: GlobalField[];
}

/** The frames as a series, in hour order, refusing a frame on a different grid. */
export function seriesFrom(frames: GlobalField[]): GlobalSeries {
  if (!frames.length) throw new Error('GFS: no frames');
  const [first] = frames;
  for (const f of frames) {
    if (f.run !== first.run) throw new Error('GFS: frames from different runs');
    if (f.ni !== first.ni || f.nj !== first.nj || f.dLon !== first.dLon || f.dLat !== first.dLat) throw new Error('GFS: frames on different grids');
  }
  return { run: first.run, resolution: first.resolution, frames: [...frames].sort((a, b) => a.time.localeCompare(b.time)) };
}

/**
 * The field at a moment: linear between the two frames that bracket it,
 * the nearest frame beyond the ends. `time` is the moment, to the minute.
 */
export function fieldAt(series: GlobalSeries, atMs: number): GlobalField {
  const { frames } = series;
  const times = frames.map(f => new Date(f.time).getTime());
  const time = new Date(Math.floor(atMs / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  if (atMs <= times[0]) return { ...frames[0], time };
  if (atMs >= times[times.length - 1]) return { ...frames[frames.length - 1], time };
  let i = 0;
  while (times[i + 1] < atMs) i++;
  const a = frames[i], b = frames[i + 1];
  const w = (atMs - times[i]) / (times[i + 1] - times[i]);
  const values = new Float32Array(a.values.length);
  for (let k = 0; k < values.length; k++) values[k] = a.values[k] + (b.values[k] - a.values[k]) * w;
  return { ...a, values, time };
}

/** The native cell nearest a point; longitudes wrap, latitudes clamp. */
export function sampleGlobal(f: GlobalField, lat: number, lng: number): number {
  const col = ((Math.round((((lng - f.lon1) % 360) + 360) % 360 / f.dLon) % f.ni) + f.ni) % f.ni;
  const row = Math.min(f.nj - 1, Math.max(0, Math.round((lat - f.lat1) / f.dLat)));
  return f.values[row * f.ni + col];
}

/**
 * The field cropped to a view, in the shape the isotherm code already reads.
 *
 * The crop sits on the model's own lattice: a stride of a whole number of
 * cells, the smallest that fits the budget, and edges on multiples of it. So
 * two views that overlap sample exactly the same cells where they overlap,
 * and a pan does not make the bands wobble. The first version spread the
 * samples evenly across whatever box was asked for; every settle then fell
 * on slightly different cells, and the colours drifted with each move.
 * The bbox returned is the aligned one, a little larger than asked.
 */
export function cropField(f: GlobalField, bbox: Bbox, maxCols = GFS_MAX_COLS, maxRows = GFS_MAX_ROWS): TempGrid {
  const [w, s, e, n] = bbox;
  const dx = f.dLon, dy = Math.abs(f.dLat);
  const k = Math.max(1, Math.ceil((e - w) / dx / (maxCols - 2)), Math.ceil((n - s) / dy / (maxRows - 2)));
  const sx = k * dx, sy = k * dy;
  const w2 = Math.max(-180, Math.floor(w / sx) * sx), e2 = Math.min(180, Math.ceil(e / sx) * sx);
  const s2 = Math.max(-90, Math.floor(s / sy) * sy), n2 = Math.min(90, Math.ceil(n / sy) * sy);
  const cols = Math.max(2, Math.round((e2 - w2) / sx) + 1);
  const rows = Math.max(2, Math.round((n2 - s2) / sy) + 1);
  if (cols * rows > Math.max(GRID_MAX_POINTS, (maxCols + 1) * (maxRows + 1))) throw new Error('GFS: crop too large');
  const values = new Array<number | null>(cols * rows);
  for (let r = 0; r < rows; r++) {
    const lat = s2 + r * sy;
    for (let c = 0; c < cols; c++) {
      const v = sampleGlobal(f, lat, w2 + c * sx);
      values[r * cols + c] = Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
    }
  }
  return { cols, rows, bbox: [w2, s2, e2, n2], values, time: f.time };
}
