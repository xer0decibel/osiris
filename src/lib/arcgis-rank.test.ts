import { describe, it, expect } from 'vitest';
import { extentArea, coverage, parseBbox, rankLocalFirst, describeServiceFailure, describeImport, type Bbox } from './arcgis-rank';

// The Seattle view the measurements were taken over.
const view: Bbox = [-122.45, 47.55, -122.25, 47.7];
const nationwide = { title: 'Regrid USA Nationwide Parcel Boundaries', numViews: 2_561_098, extent: [[-125, 24], [-66, 49]] };
const county = { title: 'Parcels with Address Property and Ownership Information (Public)', numViews: 40_000, extent: [[-122.55, 47.1], [-121.05, 47.8]] };
const kirkland = { title: 'Tax Parcel Boundaries', numViews: 3_000, extent: [[-122.26, 47.64], [-122.15, 47.73]] };
const noExtent = { title: 'Mystery layer', numViews: 9, extent: null };

describe('rankLocalFirst', () => {
  it('puts the county above the nation, and both above a neighbour that only touches the view', () => {
    // Kirkland's is the smallest extent of all — and covers a sliver of the
    // view, which is why size alone had it first and importing it gave nothing.
    const out = rankLocalFirst([kirkland, nationwide, county, noExtent], view);
    expect(out.map(r => r.title)).toEqual([county.title, nationwide.title, kirkland.title, noExtent.title]);
  });

  it("keeps ArcGIS's own order when there was no view to scope to", () => {
    expect(rankLocalFirst([nationwide, county], null).map(r => r.title)).toEqual([nationwide.title, county.title]);
  });

  it('breaks ties on popularity', () => {
    const a = { title: 'a', numViews: 1, extent: [[-123, 47], [-122, 48]] };
    const b = { title: 'b', numViews: 5, extent: [[-123, 47], [-122, 48]] };
    expect(rankLocalFirst([a, b], view).map(r => r.title)).toEqual(['b', 'a']);
  });
});

describe('geometry helpers', () => {
  it('measures coverage of the view', () => {
    expect(coverage(nationwide.extent, view)).toBeCloseTo(1, 6);
    expect(coverage(county.extent, view)).toBeCloseTo(1, 6);
    expect(coverage(kirkland.extent, view)).toBeGreaterThan(0);
    expect(coverage(kirkland.extent, view)).toBeLessThan(0.05);
    expect(coverage(null, view)).toBe(0);
  });

  it('measures an extent, and treats a missing one as infinite', () => {
    expect(extentArea([[0, 0], [2, 3]])).toBe(6);
    expect(extentArea(null)).toBe(Infinity);
    expect(extentArea([[0, 0]])).toBe(Infinity);
  });

  it('parses the route\'s bbox string and rejects a malformed one', () => {
    expect(parseBbox('-122.45,47.55,-122.25,47.7')).toEqual(view);
    expect(parseBbox('')).toBeNull();
    expect(parseBbox('1,2,3')).toBeNull();
    expect(parseBbox('3,2,1,4')).toBeNull(); // east west of west
    expect(parseBbox('a,b,c,d')).toBeNull();
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

describe('describeImport', () => {
  it('says when a layer had nothing here, and when the service capped the answer', () => {
    expect(describeImport(0, false)).toMatch(/nothing in this view/);
    expect(describeImport(2000, true)).toMatch(/Capped at 2,000/);
    expect(describeImport(703, false)).toBeNull();
  });
});
