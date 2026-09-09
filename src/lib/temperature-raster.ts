/**
 * OSIRIS — the temperature field as a picture.
 *
 * The field was drawn as contour polygons: bands from d3-contour, each with
 * the next cut out of it so they did not overlap. On the globe that kept
 * going wrong in new ways — rings from adjacent thresholds share the field's
 * edge, the tessellator turned the shared edge into stray triangles, and a
 * five-megabyte GeoJSON took six hundred milliseconds to make. So the field
 * is painted instead: every pixel samples the grid bilinearly, is quantised
 * to its 2°C band, and takes the band's colour. No polygons, nothing to
 * tessellate, one raster opacity for the translucency, and about a tenth of
 * the time. The band edges come out where the contours were.
 *
 * Rows are spaced in Mercator, not latitude, because the map stretches the
 * picture over its corners in Mercator space; a picture with rows spaced by
 * latitude would be squeezed toward the poles.
 */
import { tempColor, TEMP_STOPS } from './isotherms';
import type { Bbox, TempGrid } from './temperature-grid';

export interface TempImage {
  width: number;
  height: number;
  /** RGBA, row-major from the top-left (north-west); the buffer ImageData wants. */
  data: Uint8ClampedArray<ArrayBuffer>;
  /** The picture's extent, the grid's own. */
  bbox: Bbox;
}

export const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
export const mercLat = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/** Enough pixels that the band edges are smooth on screen, few enough to paint in a blink. */
export function imageSize(grid: TempGrid, maxWidth = 2048): { width: number; height: number } {
  const [w, s, e, n] = grid.bbox;
  const width = Math.max(1024, Math.min(maxWidth, (grid.cols - 1) * 6));
  const ratio = (mercY(n) - mercY(s)) / (((e - w) * Math.PI) / 180);
  const height = Math.max(16, Math.min(maxWidth, Math.round(width * ratio)));
  return { width, height };
}

/** The ramp's colours as bytes for every band the world can have, one lookup per pixel. */
const LUT_LO = -90, LUT_HI = 70;
function palette(stepC: number): { r: Uint8Array; g: Uint8Array; b: Uint8Array; index: (t: number) => number } {
  const count = Math.ceil((LUT_HI - LUT_LO) / stepC) + 1;
  const r = new Uint8Array(count), g = new Uint8Array(count), b = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const c = tempColor(LUT_LO + i * stepC);
    const m = c.startsWith('#') ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] : c.match(/\d+/g)!.map(Number);
    r[i] = m[0]; g[i] = m[1]; b[i] = m[2];
  }
  const index = (t: number) => Math.min(count - 1, Math.max(0, Math.floor((t - LUT_LO) / stepC)));
  return { r, g, b, index };
}

/**
 * Paint the grid. Cells with no value are filled from the grid mean first, as
 * the contours were; a grid with no values at all paints nothing. The column
 * sampling is the same for every row, so it is worked out once.
 */
export function paintField(grid: TempGrid, stepC = 2, maxWidth = 2048): TempImage {
  const { width, height } = imageSize(grid, maxWidth);
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const [, s, , n] = grid.bbox;
  const { cols, rows } = grid;
  const finite = grid.values.filter((v): v is number => v !== null);
  if (!finite.length) return { width, height, data, bbox: grid.bbox };
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const v = new Float32Array(cols * rows);
  for (let i = 0; i < v.length; i++) v[i] = grid.values[i] ?? mean;
  const lut = palette(stepC);
  const c0s = new Int32Array(width), fxs = new Float32Array(width);
  for (let px = 0; px < width; px++) {
    const gx = ((px + 0.5) / width) * (cols - 1);
    c0s[px] = Math.min(cols - 2, Math.floor(gx));
    fxs[px] = gx - c0s[px];
  }
  const yN = mercY(n), yS = mercY(s);
  const px32 = new Uint32Array(data.buffer);
  const little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  for (let py = 0; py < height; py++) {
    const lat = mercLat(yN + ((yS - yN) * (py + 0.5)) / height);
    const gy = Math.min(rows - 1, Math.max(0, ((lat - s) / (n - s)) * (rows - 1)));
    const r0 = Math.min(rows - 2, Math.floor(gy)), fy = gy - r0;
    const rowTop = r0 * cols, rowBottom = rowTop + cols;
    const rowOut = py * width;
    for (let px = 0; px < width; px++) {
      const c0 = c0s[px], fx = fxs[px];
      const top = v[rowTop + c0] + (v[rowTop + c0 + 1] - v[rowTop + c0]) * fx;
      const bottom = v[rowBottom + c0] + (v[rowBottom + c0 + 1] - v[rowBottom + c0]) * fx;
      const i = lut.index(top + (bottom - top) * fy);
      px32[rowOut + px] = little
        ? (255 << 24 | lut.b[i] << 16 | lut.g[i] << 8 | lut.r[i]) >>> 0
        : (lut.r[i] << 24 | lut.g[i] << 16 | lut.b[i] << 8 | 255) >>> 0;
    }
  }
  return { width, height, data, bbox: grid.bbox };
}

/** The corners the map wants: top-left, top-right, bottom-right, bottom-left. */
export function imageCorners(bbox: Bbox): [[number, number], [number, number], [number, number], [number, number]] {
  const [w, s, e, n] = bbox;
  return [[w, n], [e, n], [e, s], [w, s]];
}

export { TEMP_STOPS };
