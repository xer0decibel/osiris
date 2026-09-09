import { describe, it, expect } from 'vitest';
import { parseTile, trafficTileUrl } from './traffic-tiles';

describe('traffic tile coordinates', () => {
  it('accepts a tile that fits its zoom', () => {
    expect(parseTile('12', '655', '1425')).toEqual({ z: 12, x: 655, y: 1425 });
    expect(parseTile('0', '0', '0')).toEqual({ z: 0, x: 0, y: 0 });
  });

  it('refuses anything that is not a tile', () => {
    expect(parseTile('12', '4096', '0')).toBeNull(); // x past the zoom's width
    expect(parseTile('23', '0', '0')).toBeNull();    // past TomTom's ceiling
    expect(parseTile('-1', '0', '0')).toBeNull();
    expect(parseTile('1.5', '0', '0')).toBeNull();
    expect(parseTile('..', 'x', 'y')).toBeNull();
  });

  it('builds the flow tile URL with the key encoded', () => {
    const u = trafficTileUrl({ z: 12, x: 655, y: 1425 }, 'a b&c');
    expect(u.startsWith('https://api.tomtom.com/traffic/map/4/tile/flow/relative0/12/655/1425.png?key=')).toBe(true);
    expect(u.endsWith('key=a%20b%26c')).toBe(true);
  });
});
