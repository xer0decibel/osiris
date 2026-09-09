/**
 * OSIRIS — where to look for property near a point.
 *
 * There is no free, keyless, terms-compliant source of listings: Zillow,
 * Redfin, Realtor, Apartments.com and LoopNet publish none, Craigslist retired
 * its feeds, and the aggregators that do sell an API meter it to a few dozen
 * calls a month on the free tier. So the map does not draw listings; it hands
 * the reader to the listings site with the search already on the spot, which
 * is the one thing that is free, current and allowed.
 *
 * Zillow's search page reads its state from a JSON query parameter with map
 * bounds — confirmed working by the operator. Redfin and LoopNet have no
 * public bounds link; their stable public addresses are by ZIP code, so those
 * links need the dossier to know the ZIP, and are omitted when it does not.
 * Neither site can be checked from a shell: both answer non-browser requests
 * with a block page.
 */

/** A box roughly `km` kilometres on each side of the point, in degrees. */
export function boxAround(lat: number, lng: number, km = 2): { west: number; south: number; east: number; north: number } {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat };
}

function zillowUrl(path: 'for_rent' | 'for_sale', lat: number, lng: number, km: number): string {
  const b = boxAround(lat, lng, km);
  const state: Record<string, unknown> = {
    mapBounds: { west: b.west, east: b.east, south: b.south, north: b.north },
    isMapVisible: true,
  };
  if (path === 'for_rent') {
    state.filterState = {
      fr: { value: true },
      fsba: { value: false }, fsbo: { value: false }, nc: { value: false },
      cmsn: { value: false }, auc: { value: false }, fore: { value: false },
    };
  }
  return `https://www.zillow.com/homes/${path}/?searchQueryState=${encodeURIComponent(JSON.stringify(state))}`;
}

export function zillowRentalsUrl(lat: number, lng: number, km = 2): string {
  return zillowUrl('for_rent', lat, lng, km);
}

export function zillowSaleUrl(lat: number, lng: number, km = 2): string {
  return zillowUrl('for_sale', lat, lng, km);
}

/** A US ZIP, five digits, as the sites' URL slugs want it; null otherwise. */
export function zipSlug(postcode: string | null | undefined): string | null {
  const m = (postcode || '').trim().match(/^(\d{5})(-\d{4})?$/);
  return m ? m[1] : null;
}

export function redfinUrls(postcode: string | null | undefined): { rent: string; sale: string } | null {
  const zip = zipSlug(postcode);
  if (!zip) return null;
  return {
    sale: `https://www.redfin.com/zipcode/${zip}`,
    rent: `https://www.redfin.com/zipcode/${zip}/apartments-for-rent`,
  };
}

/** A place name as a URL slug: lower case, letters and digits, hyphens between. */
export function placeSlug(name: string | null | undefined): string {
  return (name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * LoopNet's search pages are addressed by `city-st-zip`, with `?view=map` to
 * open on the map — the form the operator sent, portland-or-97214, from a
 * working page. All three parts are needed; the two-letter state is the
 * geocoder's ISO 3166-2 code.
 */
export function loopnetUrls(city: string | null | undefined, stateCode: string | null | undefined, postcode: string | null | undefined): { lease: string; sale: string } | null {
  const zip = zipSlug(postcode);
  const c = placeSlug(city);
  const st = (stateCode || '').trim().toLowerCase();
  if (!zip || !c || !/^[a-z]{2}$/.test(st)) return null;
  const base = `https://www.loopnet.com/search/commercial-real-estate/${c}-${st}-${zip}`;
  return { lease: `${base}/for-lease/?view=map`, sale: `${base}/for-sale/?view=map` };
}
