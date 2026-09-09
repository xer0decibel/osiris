import { describe, it, expect } from 'vitest';
import { cToF, formatTemp, tempColor, tempColorExpression, TEMP_STOPS } from './isotherms';

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
