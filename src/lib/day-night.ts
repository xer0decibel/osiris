/**
 * OSIRIS — the night side of the Earth, as a picture that fades.
 *
 * The shading was one polygon of the night hemisphere: a hard line at the
 * terminator, and a terminator that ignored the equation of time, so it was
 * up to four degrees of longitude from where the sun actually set. Now the
 * sun's position is computed properly (NOAA's low-precision algorithm, good
 * to a small fraction of a degree) and the shade is painted per pixel from
 * the sun's elevation: nothing above civil twilight, full night below
 * nautical twilight, a smooth ramp between. Painted the same way as the
 * temperature field, rows in Mercator, and shown as an image source.
 */
import { mercLat } from './temperature-raster';
import type { Bbox } from './temperature-grid';

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Degrees, positive north. */
  declination: number;
  /** The longitude where the sun is overhead, degrees, positive east. */
  subsolarLng: number;
  /** Minutes, apparent minus mean solar time. */
  equationOfTime: number;
}

/** Where the sun is, from the NOAA solar calculator's low-precision algorithm. */
export function sunPosition(date: Date): SunPosition {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525; // Julian centuries since J2000
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * RAD) * 0.000289;
  const trueLng = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const apparentLng = trueLng - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const obliquity0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = obliquity0 + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLng * RAD)) / RAD;
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const eot = 4 / RAD * (
    y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD)
  );
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  // Solar noon is at 720 minutes of true solar time; each minute is a quarter degree.
  let subsolarLng = -((utcMinutes + eot - 720) / 4);
  subsolarLng = ((subsolarLng + 540) % 360) - 180;
  return { declination, subsolarLng, equationOfTime: eot };
}

/** The sun's elevation above the horizon at a place, degrees. */
export function sunElevation(lat: number, lng: number, sun: SunPosition): number {
  const ha = (lng - sun.subsolarLng) * RAD;
  const s = Math.sin(lat * RAD) * Math.sin(sun.declination * RAD) + Math.cos(lat * RAD) * Math.cos(sun.declination * RAD) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

/** Civil twilight begins at -6°, nautical at -12°: the shade ramps across the two, and a little before. */
export const SHADE_DAY_EL = 3;
export const SHADE_NIGHT_EL = -12;

/** 0 in daylight, 1 in full night, smooth between. */
export function nightShade(elevation: number): number {
  const x = Math.max(0, Math.min(1, (SHADE_DAY_EL - elevation) / (SHADE_DAY_EL - SHADE_NIGHT_EL)));
  return x * x * (3 - 2 * x);
}

export interface NightImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  bbox: Bbox;
}

export const NIGHT_BBOX: Bbox = [-180, -85, 180, 85];

/** The shade over the whole world at a moment, as RGBA with the darkness in the alpha. */
export function paintNight(date: Date, width = 1024, height = 1024, maxAlpha = 0.5, colour: [number, number, number] = [0, 0, 34]): NightImage {
  const sun = sunPosition(date);
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const px32 = new Uint32Array(data.buffer);
  const little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const [, s, , n] = NIGHT_BBOX;
  const yN = Math.log(Math.tan(Math.PI / 4 + (n * RAD) / 2)), yS = Math.log(Math.tan(Math.PI / 4 + (s * RAD) / 2));
  const sinDec = Math.sin(sun.declination * RAD), cosDec = Math.cos(sun.declination * RAD);
  const cosHa = new Float64Array(width);
  for (let px = 0; px < width; px++) cosHa[px] = Math.cos((-180 + (360 * (px + 0.5)) / width - sun.subsolarLng) * RAD);
  const [r, g, b] = colour;
  for (let py = 0; py < height; py++) {
    const lat = mercLat(yN + ((yS - yN) * (py + 0.5)) / height) * RAD;
    const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
    const row = py * width;
    for (let px = 0; px < width; px++) {
      const el = Math.asin(Math.max(-1, Math.min(1, sinLat * sinDec + cosLat * cosDec * cosHa[px]))) / RAD;
      const a = Math.round(nightShade(el) * maxAlpha * 255);
      px32[row + px] = little ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
    }
  }
  return { width, height, data, bbox: NIGHT_BBOX };
}
