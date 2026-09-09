/**
 * OSIRIS — where to look for rentals near a point.
 *
 * There is no free, keyless, terms-compliant source of rental listings:
 * Zillow, Redfin, Realtor and Apartments.com publish none, Craigslist retired
 * its feeds, and the aggregators that do sell an API meter it to a few dozen
 * calls a month on the free tier. So the map does not draw listings; it hands
 * the reader to the listings site with the map already centred on the spot,
 * which is the one thing that is free, current and allowed.
 *
 * Zillow's search page reads its state from a JSON query parameter with map
 * bounds and a for-rent filter. That contract is theirs to change; it is the
 * one their own map uses, but it cannot be checked from a shell, since Zillow
 * answers non-browser requests with a block page.
 */

/** A box roughly `km` kilometres on each side of the point, in degrees. */
export function boxAround(lat: number, lng: number, km = 2): { west: number; south: number; east: number; north: number } {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat };
}

export function zillowRentalsUrl(lat: number, lng: number, km = 2): string {
  const b = boxAround(lat, lng, km);
  const state = {
    mapBounds: { west: b.west, east: b.east, south: b.south, north: b.north },
    isMapVisible: true,
    filterState: {
      fr: { value: true },
      fsba: { value: false }, fsbo: { value: false }, nc: { value: false },
      cmsn: { value: false }, auc: { value: false }, fore: { value: false },
    },
  };
  return `https://www.zillow.com/homes/for_rent/?searchQueryState=${encodeURIComponent(JSON.stringify(state))}`;
}
