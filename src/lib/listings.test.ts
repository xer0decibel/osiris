import { describe, it, expect } from 'vitest';
import { boxAround, zillowRentalsUrl } from './listings';

describe('rentals link', () => {
  it('boxes the point by kilometres, wider in longitude away from the equator', () => {
    const b = boxAround(45.52, -122.34, 2);
    expect(b.north - b.south).toBeCloseTo(4 / 111, 6);
    expect(b.east - b.west).toBeGreaterThan(b.north - b.south);
    expect((b.east + b.west) / 2).toBeCloseTo(-122.34, 6);
  });

  it('opens Zillow for rent with the map on the point', () => {
    const u = zillowRentalsUrl(45.52, -122.34);
    expect(u.startsWith('https://www.zillow.com/homes/for_rent/?searchQueryState=')).toBe(true);
    const state = JSON.parse(decodeURIComponent(u.split('searchQueryState=')[1]));
    expect(state.filterState.fr.value).toBe(true);
    expect(state.filterState.fsba.value).toBe(false);
    expect(state.mapBounds.west).toBeLessThan(-122.34);
    expect(state.mapBounds.east).toBeGreaterThan(-122.34);
    expect(state.isMapVisible).toBe(true);
  });
});
