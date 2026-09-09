import { describe, it, expect } from 'vitest';
import { parseBbox, padBbox, gridPoints, openMeteoUrl, readOpenMeteo, snapBbox, bboxContains, GRID_COLS, GRID_ROWS } from './temperature-grid';

describe('the request budget', () => {
  it('keeps a grid under a hundred points', () => {
    expect(GRID_COLS * GRID_ROWS).toBeLessThanOrEqual(100);
  });

  it('snaps a view outward to a lattice so pans share a field', () => {
    expect(snapBbox([-122.52, 45.44, -122.16, 45.6])).toEqual([-122.75, 45.25, -122, 45.75]);
    expect(snapBbox([-122.51, 45.41, -122.2, 45.62])).toEqual([-122.75, 45.25, -122, 45.75]); // a small pan, same field
    expect(snapBbox([-130, 40, -110, 50])).toEqual([-130, 40, -110, 50]);                    // a wide view, whole degrees
  });

  it('knows when a cached field covers a request', () => {
    expect(bboxContains([-123, 45, -122, 46], [-122.75, 45.25, -122, 45.75])).toBe(true);
    expect(bboxContains([-123, 45, -122, 46], [-123.5, 45.25, -122, 45.75])).toBe(false);
  });
});

describe('temperature grid', () => {
  it('parses a view and rejects nonsense', () => {
    expect(parseBbox('-125,42,-116,49')).toEqual([-125, 42, -116, 49]);
    expect(parseBbox('-116,42,-125,49')).toBeNull();
    expect(parseBbox('-200,42,-116,49')).toBeNull();
    expect(parseBbox('x')).toBeNull();
  });

  it('pads the view each side and stays on the globe', () => {
    expect(padBbox([-10, 0, 10, 10], 0.5)).toEqual([-20, -5, 20, 15]);
    expect(padBbox([-179, 80, 179, 85], 0.5)[3]).toBe(85);
  });

  it('samples row-major from the south-west corner', () => {
    const pts = gridPoints([-125, 42, -116, 49], 4, 3);
    expect(pts).toHaveLength(12);
    expect(pts[0]).toEqual({ lat: 42, lng: -125 });
    expect(pts[3]).toEqual({ lat: 42, lng: -116 });
    expect(pts[4]).toEqual({ lat: 45.5, lng: -125 });
    expect(pts[11]).toEqual({ lat: 49, lng: -116 });
  });

  it('asks Open-Meteo for every point at once, in Celsius', () => {
    const u = openMeteoUrl([{ lat: 42, lng: -125 }, { lat: 49, lng: -116 }]);
    expect(u).toContain('latitude=42,49');
    expect(u).toContain('longitude=-125,-116');
    expect(u).toContain('current=temperature_2m');
  });

  it('reads the answer in order, and refuses a short one', () => {
    const body = [
      { current: { time: '2026-09-09T16:45', temperature_2m: 12.5 } },
      { current: { time: '2026-09-09T16:45', temperature_2m: null } },
    ];
    expect(readOpenMeteo(body, 2)).toEqual({ values: [12.5, null], time: '2026-09-09T16:45' });
    expect(readOpenMeteo(body, 3)).toBeNull();
    expect(readOpenMeteo({ current: { time: 't', temperature_2m: 1 } }, 1)?.values).toEqual([1]);
  });
});
