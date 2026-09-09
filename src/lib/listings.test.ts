import { describe, it, expect } from 'vitest';
import { boxAround, zillowRentalsUrl, zillowSaleUrl, zipSlug, redfinUrls, loopnetUrls } from './listings';

describe('property links', () => {
  it('boxes the point by kilometres, wider in longitude away from the equator', () => {
    const b = boxAround(45.52, -122.34, 2);
    expect(b.north - b.south).toBeCloseTo(4 / 111, 6);
    expect(b.east - b.west).toBeGreaterThan(b.north - b.south);
    expect((b.east + b.west) / 2).toBeCloseTo(-122.34, 6);
  });

  it('opens Zillow for rent with the map on the point and the rental filter set', () => {
    const u = zillowRentalsUrl(45.52, -122.34);
    expect(u.startsWith('https://www.zillow.com/homes/for_rent/?searchQueryState=')).toBe(true);
    const state = JSON.parse(decodeURIComponent(u.split('searchQueryState=')[1]));
    expect(state.filterState.fr.value).toBe(true);
    expect(state.filterState.fsba.value).toBe(false);
    expect(state.mapBounds.west).toBeLessThan(-122.34);
    expect(state.isMapVisible).toBe(true);
  });

  it('opens Zillow for sale on the same box with no rental filter', () => {
    const u = zillowSaleUrl(45.52, -122.34);
    expect(u.startsWith('https://www.zillow.com/homes/for_sale/?searchQueryState=')).toBe(true);
    const state = JSON.parse(decodeURIComponent(u.split('searchQueryState=')[1]));
    expect(state.filterState).toBeUndefined();
    expect(state.mapBounds.east).toBeGreaterThan(-122.34);
  });

  it('accepts a five-digit ZIP, with or without the plus-four, and nothing else', () => {
    expect(zipSlug('97060')).toBe('97060');
    expect(zipSlug(' 97060-1234 ')).toBe('97060');
    expect(zipSlug('SW1A 1AA')).toBeNull();
    expect(zipSlug('')).toBeNull();
    expect(zipSlug(undefined)).toBeNull();
  });

  it('builds Redfin ZIP pages, and none without a ZIP', () => {
    expect(redfinUrls('97060')).toEqual({ sale: 'https://www.redfin.com/zipcode/97060', rent: 'https://www.redfin.com/zipcode/97060/apartments-for-rent' });
    expect(redfinUrls('')).toBeNull();
  });

  it('builds LoopNet pages as city-st-zip on the map, the form from a working page', () => {
    expect(loopnetUrls('Portland', 'OR', '97214')).toEqual({
      lease: 'https://www.loopnet.com/search/commercial-real-estate/portland-or-97214/for-lease/?view=map',
      sale: 'https://www.loopnet.com/search/commercial-real-estate/portland-or-97214/for-sale/?view=map',
    });
    expect(loopnetUrls('Lake Oswego', 'or', '97034')?.sale).toContain('/lake-oswego-or-97034/');
    expect(loopnetUrls('', 'OR', '97060')).toBeNull();
    expect(loopnetUrls('Springdale', 'Oregon', '97060')).toBeNull(); // needs the two-letter code
    expect(loopnetUrls('London', 'EN', 'EC1A')).toBeNull();
  });
});
