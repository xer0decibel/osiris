import { describe, it, expect } from 'vitest';
import { extentArea, rankLocalFirst, describeServiceFailure } from './arcgis-rank';

const nationwide = { title: 'Regrid USA Nationwide Parcel Boundaries', numViews: 2_561_098, extent: [[-125, 24], [-66, 49]] };
const county = { title: 'Parcels with Address Property and Ownership Information (Public)', numViews: 40_000, extent: [[-122.55, 47.1], [-121.05, 47.8]] };
const noExtent = { title: 'Mystery layer', numViews: 9, extent: null };

describe('rankLocalFirst', () => {
  it('puts the county above the nation when the search was scoped to a view', () => {
    const out = rankLocalFirst([nationwide, county, noExtent], true);
    expect(out.map(r => r.title)).toEqual([county.title, nationwide.title, noExtent.title]);
  });

  it("keeps ArcGIS's own order when there was no view to scope to", () => {
    const out = rankLocalFirst([nationwide, county], false);
    expect(out.map(r => r.title)).toEqual([nationwide.title, county.title]);
  });

  it('breaks ties on popularity', () => {
    const a = { title: 'a', numViews: 1, extent: [[0, 0], [1, 1]] };
    const b = { title: 'b', numViews: 5, extent: [[0, 0], [1, 1]] };
    expect(rankLocalFirst([a, b], true).map(r => r.title)).toEqual(['b', 'a']);
  });

  it('measures an extent, and treats a missing one as infinite', () => {
    expect(extentArea([[0, 0], [2, 3]])).toBe(6);
    expect(extentArea(null)).toBe(Infinity);
    expect(extentArea([[0, 0]])).toBe(Infinity);
  });
});

describe('describeServiceFailure', () => {
  it('names subscriber content for every way ArcGIS refuses it', () => {
    for (const code of [401, 403]) expect(describeServiceFailure(code)).toMatch(/subscription or sign-in/);
    for (const code of [498, 499, 403]) expect(describeServiceFailure(200, code)).toMatch(/subscription or sign-in/);
  });

  it('explains a 404 rather than reporting the number', () => {
    expect(describeServiceFailure(404)).toMatch(/moved, or is not open/);
  });

  it('passes a provider message through, and falls back to the status', () => {
    expect(describeServiceFailure(200, 400, 'Invalid geometry')).toBe('Feature Service error: Invalid geometry');
    expect(describeServiceFailure(502)).toBe('Feature Service query failed (502)');
  });
});
