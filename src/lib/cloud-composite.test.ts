import { describe, it, expect } from 'vitest';
import {
  cloudDates, compositeTemplate, parseCompositeUrl, gibsTileUrl, fillNoData, chooseTiles, countNoData, paintInfrared,
  NO_DATA_MAX, CLOUD_PROTOCOL, INFRARED_LAYER, CLOUD_WHITE, OCEAN_NAVY, IR_WARM_K, IR_COLD_K,
} from './cloud-composite';
import { temperatureOf, rampColour, BT_MIN_K, BT_MAX_K, BT_ENTRIES } from './gibs-bt-ramp';

/** The ramp entry whose temperature band holds k. */
const entryFor = (k: number) => Math.min(BT_ENTRIES - 1, Math.floor((k - BT_MIN_K) / (BT_MAX_K - BT_MIN_K) * BT_ENTRIES));

/**
 * The published ramp is the only thing that turns NASA's purple into kelvin,
 * so the lookup must land on the entry it was given, and stay close for the
 * JPEG-shifted colours the tiles actually contain.
 */
describe('temperatureOf', () => {
  it('returns the ramp ends, within the lookup\'s 8-level quantisation', () => {
    // The last few entries are all near-white and one unit apart, so the
    // quantised lookup can land a couple of entries early there. Nothing in
    // the recolouring cares above IR_WARM_K.
    expect(Math.abs(temperatureOf(...rampColour(0)) - BT_MIN_K)).toBeLessThan(2.5);
    expect(Math.abs(temperatureOf(...rampColour(BT_ENTRIES - 1)) - BT_MAX_K)).toBeLessThan(2.5);
  });

  it('recovers a mid-ramp temperature to within a step', () => {
    for (const k of [225, 250, 260, 275, 300]) {
      expect(Math.abs(temperatureOf(...rampColour(entryFor(k))) - k)).toBeLessThan(1.5);
    }
  });

  it('tolerates a few units of JPEG noise', () => {
    const [r, g, b] = rampColour(entryFor(260));
    expect(Math.abs(temperatureOf(r + 3, Math.max(0, g - 3), b + 2) - 260)).toBeLessThan(3);
  });
});

describe('paintInfrared', () => {
  const pixel = (k: number) => new Uint8ClampedArray([...rampColour(entryFor(k)), 255]);

  it('paints a cloud top the true-colour cloud white', () => {
    const px = pixel(IR_COLD_K - 10);
    paintInfrared(px);
    expect(Array.from(px)).toEqual([...CLOUD_WHITE, 255]);
  });

  it('paints open water the true-colour ocean navy', () => {
    const px = pixel(IR_WARM_K + 10);
    paintInfrared(px);
    expect(Array.from(px)).toEqual([...OCEAN_NAVY, 255]);
  });

  it('paints sea ice between the two', () => {
    const px = pixel((IR_WARM_K + IR_COLD_K) / 2);
    paintInfrared(px);
    for (let c = 0; c < 3; c++) {
      expect(px[c]).toBeGreaterThan(OCEAN_NAVY[c] + 60);
      expect(px[c]).toBeLessThan(CLOUD_WHITE[c] - 60);
    }
  });

  it('never produces no-data, so a later fill leaves it alone', () => {
    const px = new Uint8ClampedArray([...rampColour(0), 255, ...rampColour(BT_ENTRIES - 1), 255]);
    paintInfrared(px);
    expect(countNoData(px)).toBe(0);
  });
});

describe('countNoData', () => {
  it('counts black and transparent pixels, not dark imagery', () => {
    const px = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255, 8, 8, 8, 255, 9, 0, 0, 255, 24, 28, 40, 255]);
    expect(countNoData(px)).toBe(3);
  });
});

describe('infrared tile address', () => {
  it('is the same GIBS path with the thermal layer swapped in', () => {
    expect(gibsTileUrl('2026-09-10', 3, 7, 5, INFRARED_LAYER))
      .toBe(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${INFRARED_LAYER}/default/2026-09-10/GoogleMapsCompatible_Level9/3/7/5.jpg`);
  });
});

const TODAY = new Blob(['today']);
const YESTERDAY = new Blob(['yesterday']);

/**
 * GIBS answers a not-yet-imaged tile with black at low zoom and a 404 at high
 * zoom, and either day can be missing. What gets drawn must follow from that
 * without a canvas in the loop.
 */
describe('chooseTiles', () => {
  it('composites when both days are there', () => {
    expect(chooseTiles({ tile: TODAY }, { tile: YESTERDAY })).toEqual({ mode: 'composite', top: TODAY, under: YESTERDAY });
  });

  it('draws yesterday alone where today is a 404, which is every high-zoom tile before its pass', () => {
    expect(chooseTiles({ tile: null }, { tile: YESTERDAY })).toEqual({ mode: 'single', tile: YESTERDAY });
  });

  it('draws today alone where yesterday failed', () => {
    expect(chooseTiles({ tile: TODAY }, { error: new Error('offline') })).toEqual({ mode: 'single', tile: TODAY });
  });

  it('draws nothing, silently, when neither day has the tile', () => {
    expect(chooseTiles({ tile: null }, { tile: null })).toEqual({ mode: 'empty' });
  });

  it('rethrows a failure only when there is nothing to fall back on', () => {
    const boom = new Error('offline');
    expect(() => chooseTiles({ error: boom }, { tile: null })).toThrow(boom);
    expect(() => chooseTiles({ tile: null }, { error: boom })).toThrow(boom);
    expect(() => chooseTiles({ error: boom }, { error: new Error('also') })).toThrow(boom);
  });
});

/**
 * The dates are the whole point: today's partial composite on top, yesterday's
 * complete one underneath, with the UTC day — not the machine's — deciding
 * which is which.
 */
describe('cloudDates', () => {
  it('puts today on top and yesterday underneath', () => {
    expect(cloudDates(Date.UTC(2026, 8, 11, 18, 45))).toEqual({ top: '2026-09-11', under: '2026-09-10' });
  });

  it('is a UTC day, so half past midnight UTC is already the new day', () => {
    expect(cloudDates(Date.UTC(2026, 8, 11, 0, 30))).toEqual({ top: '2026-09-11', under: '2026-09-10' });
  });

  it('steps back across a month boundary', () => {
    expect(cloudDates(Date.UTC(2026, 9, 1, 1, 0))).toEqual({ top: '2026-10-01', under: '2026-09-30' });
  });
});

describe('composite URL', () => {
  it('keeps the placeholders bare so MapLibre can substitute them', () => {
    const t = compositeTemplate('2026-09-11', '2026-09-10');
    expect(t).toBe(`${CLOUD_PROTOCOL}://{z}/{y}/{x}?top=2026-09-11&under=2026-09-10`);
  });

  it('round-trips once the map has filled in a tile address', () => {
    const t = compositeTemplate('2026-09-11', '2026-09-10');
    const url = t.replace('{z}', '3').replace('{y}', '2').replace('{x}', '1');
    expect(parseCompositeUrl(url)).toEqual({ z: 3, y: 2, x: 1, top: '2026-09-11', under: '2026-09-10' });
  });

  it('refuses other protocols and malformed dates', () => {
    expect(parseCompositeUrl('https://example.com/3/2/1?top=2026-09-11&under=2026-09-10')).toBeNull();
    expect(parseCompositeUrl(`${CLOUD_PROTOCOL}://3/2/1?top=today&under=2026-09-10`)).toBeNull();
    expect(parseCompositeUrl(`${CLOUD_PROTOCOL}://3/2/1?top=2026-09-11`)).toBeNull();
  });

  it('builds the GIBS path row-before-column', () => {
    expect(gibsTileUrl('2026-09-11', 2, 1, 0)).toMatch(/\/2026-09-11\/GoogleMapsCompatible_Level9\/2\/1\/0\.jpg$/);
  });
});

/** Four pixels: black, brightest channel at the threshold, one over it, and white. */
function tile(): { top: Uint8ClampedArray; under: Uint8ClampedArray } {
  const m = NO_DATA_MAX;
  const top = new Uint8ClampedArray([
    0, 0, 0, 255,
    m, 0, 0, 255,
    m + 1, 0, 0, 255,
    255, 255, 255, 255,
  ]);
  const under = new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 255,
    70, 80, 90, 255,
    100, 110, 120, 255,
  ]);
  return { top, under };
}

describe('fillNoData', () => {
  it('fills black and at-threshold pixels from underneath, keeps the rest', () => {
    const { top, under } = tile();
    expect(fillNoData(top, under)).toBe(2);
    expect(Array.from(top)).toEqual([
      10, 20, 30, 255,
      40, 50, 60, 255,
      NO_DATA_MAX + 1, 0, 0, 255,
      255, 255, 255, 255,
    ]);
  });

  it('reports zero when today already covers the tile', () => {
    const top = new Uint8ClampedArray([200, 200, 200, 255, 30, 60, 90, 255]);
    const under = new Uint8ClampedArray(8);
    expect(fillNoData(top, under)).toBe(0);
    expect(Array.from(top)).toEqual([200, 200, 200, 255, 30, 60, 90, 255]);
  });

  it('reports every pixel when today is entirely black, which is the Americas before their pass', () => {
    const top = new Uint8ClampedArray(16);
    const under = new Uint8ClampedArray(16).fill(90);
    expect(fillNoData(top, under)).toBe(4);
    expect(Array.from(top)).toEqual(Array(16).fill(90));
  });

  it('refuses tiles of different sizes rather than reading past the end', () => {
    expect(() => fillNoData(new Uint8ClampedArray(8), new Uint8ClampedArray(4))).toThrow(/8 vs 4/);
  });
});
