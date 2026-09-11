import { describe, it, expect } from 'vitest';
import {
  cloudDates, compositeTemplate, parseCompositeUrl, gibsTileUrl, chooseTiles, paintInfrared,
  dataWeights, compositeWeighted, uncovered,
  NO_DATA_MAX, RINGING_MAX, CLOUD_PROTOCOL, INFRARED_LAYER, CLOUD_WHITE, OCEAN_NAVY, IR_WARM_K, IR_COLD_K,
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

  it('never produces no-data, so it is believed everywhere', () => {
    const px = new Uint8ClampedArray([...rampColour(0), 255, ...rampColour(BT_ENTRIES - 1), 255]);
    paintInfrared(px);
    expect(Array.from(dataWeights(px, 2, 1))).toEqual([1, 1]);
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

/** A 1-pixel-high strip from brightest-channel values, opaque. */
const strip = (...maxes: number[]) => new Uint8ClampedArray(maxes.flatMap(m => [m, m, m, 255]));

/**
 * Confidence is what the whole composite blends by, so the mask has to catch
 * the ringing beside a swath edge — and only there. Dark night ocean far from
 * any hole is imagery.
 */
describe('dataWeights', () => {
  it('is 0 on no-data, ramps out over the radius, and 1 beyond', () => {
    const w = dataWeights(strip(0, 250, 250, 250, 250), 5, 1, 2);
    expect(Array.from(w).map(v => +v.toFixed(3))).toEqual([0, 0.333, 0.667, 1, 1]);
  });

  it('treats a ringing-dark pixel beside no-data as no-data too', () => {
    const w = dataWeights(strip(0, RINGING_MAX, 250, 250, 250, 250), 6, 1, 2);
    expect(Array.from(w).map(v => +v.toFixed(3))).toEqual([0, 0, 0.333, 0.667, 1, 1]);
  });

  it('believes a dark pixel that is nowhere near a hole', () => {
    expect(Array.from(dataWeights(strip(250, 250, 250, RINGING_MAX, NO_DATA_MAX + 1), 5, 1, 2))).toEqual([1, 1, 1, 1, 1]);
  });

  it('treats transparent black as no-data', () => {
    const px = new Uint8ClampedArray(8); // two transparent pixels
    expect(Array.from(dataWeights(px, 2, 1))).toEqual([0, 0]);
  });

  it('refuses a size that does not match the buffer', () => {
    expect(() => dataWeights(new Uint8ClampedArray(8), 3, 1)).toThrow(/3×1/);
  });
});

describe('compositeWeighted', () => {
  it('lets each layer take its share of what the layers above left', () => {
    const top = strip(250, 250, 250);
    const under = strip(100, 100, 100);
    const out = compositeWeighted([top, under], [new Float32Array([0, 0.5, 1]), new Float32Array([1, 1, 1])], 3, 1);
    expect(Array.from(out)).toEqual([100, 100, 100, 255, 175, 175, 175, 255, 250, 250, 250, 255]);
  });

  it('keeps the colour and lowers the alpha where coverage runs out, rather than darkening', () => {
    const out = compositeWeighted([strip(200, 200)], [new Float32Array([0.5, 0])], 2, 1);
    expect(Array.from(out)).toEqual([200, 200, 200, 128, 0, 0, 0, 0]);
  });

  it('is transparent with no layers at all', () => {
    expect(Array.from(compositeWeighted([], [], 2, 1))).toEqual(Array(8).fill(0));
  });

  it('refuses mismatched layers and weights', () => {
    expect(() => compositeWeighted([strip(1)], [], 1, 1)).toThrow(/1 layers, 0 weights/);
  });
});

describe('uncovered', () => {
  it('counts the pixels no layer fully covers', () => {
    expect(uncovered([new Float32Array([1, 0.5, 0]), new Float32Array([1, 1, 0])], 3)).toBe(1);
    expect(uncovered([], 3)).toBe(3);
  });
});
