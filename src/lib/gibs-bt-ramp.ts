/**
 * NASA GIBS colour ramp for VIIRS Band I5 brightness temperature — the one
 * the VIIRS_NOAA20_Brightness_Temp_BandI5_Night tiles are painted with.
 *
 * Taken from https://gibs.earthdata.nasa.gov/colormaps/v1.3/VIIRS_Brightness_Temp_BandI5.xml
 * on 2026-09-11: 255 entries from 180 K to 340 K in steps of about
 * 0.63 K, dark navy for cold through purple and pink to white for
 * hot. Stored as 255 RGB triplets in base64 so the module is small and the
 * source is one file that can be regenerated from the URL above.
 *
 * The tiles are JPEG, so a pixel is never exactly a ramp colour. temperatureOf
 * finds the nearest ramp entry through a 32×32×32 lookup built once, and
 * returns the entry's temperature. Cloud tops are cold and dark on this ramp;
 * open ocean at night is around 275 K and above.
 */

export const BT_MIN_K = 180;
export const BT_MAX_K = 340;
export const BT_ENTRIES = 255;

const RAMP_B64 = 'AAAWAQIbAwQgBAcmBQkrBgswCA01CQ86ChJACxRFDRZKDhhPDxpUEBxZEh9fEyFkFCNpFSRqFyVrGCZsGSdtGyduHChvHSlwHypyICtzISx0Ii11JC52JS53Ji94KDB5KTF6KjJ7LDN8LTN9LjR+LzV/MTaAMjeBMziCNDiDNjmENzqFODuGOTyHOzyIPD2JPT6KPz+KQD+LQkCLREGMRUGMR0KMSUONS0SNTESNTkWOUEaOUUaPU0ePVUiPVkiQWEmQWkqQXEqRXUuRX0yRYUyRY02SZE6SZk+SaE+SalCTa1GTbVGTb1KTcVOUclOUdFSUdlWUeFaVeVaVe1eVfViVf1mWgVmWg1qWhFuWhlyXiFyXil2XjF6XjV+Yj1+YkWCYkmGYlGGYlWKXlmOXl2OXmWSXmmWWm2aWnGaWnmeWn2iVoGiVoWmVo2qVpGqUpWuUpmyUp2yTqG2TqW6Tqm6Sq2+SrHCRrXGRrnGRr3KQsHOQsXOQsnSPs3WPtHWOtXaOtneOt3eNuHiNuXmNunmMu3qMvHqLvXuLvnyLv3yKwH2KwX6Kwn6Jw3+JxH+IxYCIxoKJx4OJyIWKyYaLyoiLy4mMzIuMzo2Nz46O0JCO0ZGP0pOQ05SQ1JaR1ZeR1pmS15uT2J2V2aCW2qKY26SZ3Kab3aic3que362f4K+g4bGi4rOj47Wl5Lim5bqo5ryp576q6MCs6cKt6sWv68ew7Mmx7cuz7s207s+179G38NO48da68ti789q89Ny+9d6/9uHB+OPC+ebE+ujG++vH/e3J/vDK//LM//LN//PO//PP//TQ//TR//XS//XT//bU//bV//fW//fX//jZ//ja//jb//nc//nd//re//rf//vg//vh//vi//vj//vk//vl//vm//vn//vo//zo//zp//zq//zr//zs//zt//3t//3u//3v//3w//3x//3y//7y//7z//70//71//72//73///3///4///5///6///7///8///9///+////';

let ramp: Uint8Array | null = null;
let lut: Uint8Array | null = null;

function decodeRamp(): Uint8Array {
  if (ramp) return ramp;
  const bin = typeof atob === 'function' ? atob(RAMP_B64) : Buffer.from(RAMP_B64, 'base64').toString('binary');
  ramp = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) ramp[i] = bin.charCodeAt(i);
  return ramp;
}

/** The ramp colour for entry i (0-based), for tests and legends. */
export function rampColour(i: number): [number, number, number] {
  const r = decodeRamp();
  return [r[i * 3], r[i * 3 + 1], r[i * 3 + 2]];
}

/** Nearest ramp entry for a quantised colour, 5 bits per channel. Built on first use, ~8M comparisons once. */
function buildLut(): Uint8Array {
  if (lut) return lut;
  const r = decodeRamp();
  const n = r.length / 3;
  lut = new Uint8Array(32 * 32 * 32);
  for (let ri = 0; ri < 32; ri++) for (let gi = 0; gi < 32; gi++) for (let bi = 0; bi < 32; bi++) {
    const R = ri * 8 + 4, G = gi * 8 + 4, B = bi * 8 + 4;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dr = r[i * 3] - R, dg = r[i * 3 + 1] - G, db = r[i * 3 + 2] - B;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    lut[(ri << 10) | (gi << 5) | bi] = best;
  }
  return lut;
}

/** Brightness temperature in kelvin for a tile pixel, by nearest ramp colour. */
export function temperatureOf(r: number, g: number, b: number): number {
  const i = buildLut()[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
  return BT_MIN_K + (i + 0.5) * (BT_MAX_K - BT_MIN_K) / BT_ENTRIES;
}
