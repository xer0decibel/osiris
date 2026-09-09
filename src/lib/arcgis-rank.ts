/**
 * OSIRIS — ordering ArcGIS Online search results, and saying why an import
 * failed.
 *
 * ArcGIS Online ranks by popularity. Searching "parcels" over Seattle put
 * Regrid's nationwide parcel product first — 2.5 million views, and a data
 * service that is not public, so importing it fails — with King County's own
 * layer below the fold. When the search was for what is under the map, the
 * layer with the smallest footprint that still covers the view is the one the
 * operator meant, so results are ordered by extent area when a view was given.
 */

export interface RankableResult {
  extent?: number[][] | null;
  numViews?: number;
}

/** Square degrees of an item's extent, or Infinity when it has none. */
export function extentArea(extent: number[][] | null | undefined): number {
  if (!extent || extent.length !== 2) return Infinity;
  const [[w, s], [e, n]] = extent;
  if (![w, s, e, n].every(Number.isFinite)) return Infinity;
  return Math.abs(e - w) * Math.abs(n - s);
}

/** Local first when the search was scoped to a view; otherwise as ArcGIS ranked them. */
export function rankLocalFirst<T extends RankableResult>(results: T[], scopedToView: boolean): T[] {
  if (!scopedToView) return results;
  return [...results].sort((a, b) => {
    const d = extentArea(a.extent) - extentArea(b.extent);
    return d !== 0 ? d : (b.numViews ?? 0) - (a.numViews ?? 0);
  });
}

/**
 * ArcGIS answers a refused query three ways: an HTTP 401/403, an HTTP 404 for
 * a service that has moved or was never public, or an HTTP 200 carrying an
 * error object whose code is 498, 499 or 403 — subscriber content and expired
 * tokens. All of them used to surface as "query failed (N)".
 */
export function describeServiceFailure(httpStatus: number, errorCode?: number, errorMessage?: string): string {
  const code = errorCode ?? httpStatus;
  if (code === 498 || code === 499 || code === 403 || code === 401) {
    return 'This layer is listed publicly but its data needs a subscription or sign-in, so it cannot be imported here.';
  }
  if (code === 404) {
    return 'The service answered 404: it has moved, or is not open to the public.';
  }
  return errorMessage ? `Feature Service error: ${errorMessage}` : `Feature Service query failed (${httpStatus})`;
}
