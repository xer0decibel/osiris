import { describe, it, expect } from 'vitest';
import { sunPosition, sunElevation, nightShade, paintNight, SHADE_DAY_EL, SHADE_NIGHT_EL } from './day-night';

describe('the sun', () => {
  it('stands over the tropics at the solstices and the equator at the equinoxes', () => {
    expect(sunPosition(new Date('2026-06-21T08:24:00Z')).declination).toBeCloseTo(23.44, 1);
    expect(sunPosition(new Date('2026-12-21T20:50:00Z')).declination).toBeCloseTo(-23.44, 1);
    expect(Math.abs(sunPosition(new Date('2026-09-22T22:05:00Z')).declination)).toBeLessThan(0.1);
  });

  it('knows the equation of time, which the old terminator ignored', () => {
    // Early November the sundial runs about sixteen minutes fast; mid-February fourteen slow.
    expect(sunPosition(new Date('2026-11-03T12:00:00Z')).equationOfTime).toBeCloseTo(16.4, 0);
    expect(sunPosition(new Date('2026-02-11T12:00:00Z')).equationOfTime).toBeCloseTo(-14.2, 0);
  });

  it('is overhead at the subsolar point and below the horizon at its antipode', () => {
    const sun = sunPosition(new Date('2026-09-09T19:00:00Z'));
    expect(sun.subsolarLng).toBeCloseTo(-105.6, 0); // 19:00Z: 7 hours past Greenwich noon, west by 105°, plus the equation of time
    expect(sunElevation(sun.declination, sun.subsolarLng, sun)).toBeCloseTo(90, 5);
    expect(sunElevation(-sun.declination, sun.subsolarLng + 180, sun)).toBeCloseTo(-90, 5);
    expect(sunElevation(0, sun.subsolarLng + 90, sun)).toBeCloseTo(0, 0);
  });
});

describe('the shade', () => {
  it('is clear by day, full by night, and smooth across twilight', () => {
    expect(nightShade(SHADE_DAY_EL + 10)).toBe(0);
    expect(nightShade(SHADE_NIGHT_EL - 10)).toBe(1);
    const mid = nightShade((SHADE_DAY_EL + SHADE_NIGHT_EL) / 2);
    expect(mid).toBeCloseTo(0.5, 5);
    expect(nightShade(-3)).toBeGreaterThan(nightShade(0));
    expect(nightShade(0)).toBeGreaterThan(nightShade(2));
  });

  it('paints darkness in the alpha, none under the sun and most opposite it', () => {
    const date = new Date('2026-09-09T19:00:00Z');
    const img = paintNight(date, 360, 180, 0.5);
    const sun = sunPosition(date);
    const alphaAt = (lat: number, lng: number) => {
      const px = Math.floor(((lng + 180) / 360) * img.width);
      const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      const yN = Math.log(Math.tan(Math.PI / 4 + (85 * Math.PI) / 360));
      const py = Math.floor(((yN - y) / (2 * yN)) * img.height);
      return img.data[(py * img.width + px) * 4 + 3];
    };
    expect(alphaAt(sun.declination, sun.subsolarLng)).toBe(0);
    expect(alphaAt(-sun.declination, sun.subsolarLng + 180 - 360)).toBe(128);
    expect(img.data[2]).toBe(34); // the shade's blue, wherever the alpha is
    // Mid-afternoon in Texas is daylight; Europe at 19Z is dusk to night.
    expect(alphaAt(32, -97)).toBe(0);
    expect(alphaAt(52, 13)).toBeGreaterThan(60);
  });
});
