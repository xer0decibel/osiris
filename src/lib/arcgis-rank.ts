/**
 * OSIRIS — ordering ArcGIS Online search results, and saying why an import
 * failed.
 *
 * ArcGIS Online ranks by popularity. Searching "parcels" over Seattle put
 * Regrid's nationwide parcel product first — 2.5 million views, and a data
 * service that is not public, so importing it fails — with the county's own
 * layer below the fold. Ordering by extent size alone then put Kirkland's
 * parcels first: the smallest layer around, and one that only touches the
 * edge of the view, so it imported nothing. Measured, both.
 *
 * So the order is: how much of the view a layer's extent covers, most first;
 * then the smaller extent, so a county beats a nation that also covers the
 * view; then popularity. A layer that does not touch the view at all goes to
 * the bottom rather than out, in case the view was the wrong guess.
 */

export type Bbox = [west: number, south: number, east: number, north: number];

export interface RankableResult {
  extent?: number[][] | null;
  numViews?: number;
}

/** "west,south,east,north" as the route receives it, or null if malformed. */
export function parseBbox(s: string | null | undefined): Bbox | null {
  if (!s) return null;
  const n = s.split(',').map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return null;
  const [w, so, e, no] = n;
  if (e <= w || no <= so) return null;
  return [w, so, e, no];
}

/** An item's extent as a bbox, or null when it has none. */
function extentBbox(extent: number[][] | null | undefined): Bbox | null {
  if (!extent || extent.length !== 2) return null;
  const [[w, s], [e, n]] = extent;
  if (![w, s, e, n].every(Number.isFinite)) return null;
  return [Math.min(w, e), Math.min(s, n), Math.max(w, e), Math.max(s, n)];
}

/** Square degrees of an item's extent, or Infinity when it has none. */
export function extentArea(extent: number[][] | null | undefined): number {
  const b = extentBbox(extent);
  return b ? (b[2] - b[0]) * (b[3] - b[1]) : Infinity;
}

/** The fraction of `view` that `extent` covers, 0 to 1. */
export function coverage(extent: number[][] | null | undefined, view: Bbox): number {
  const b = extentBbox(extent);
  if (!b) return 0;
  const w = Math.max(0, Math.min(b[2], view[2]) - Math.max(b[0], view[0]));
  const h = Math.max(0, Math.min(b[3], view[3]) - Math.max(b[1], view[1]));
  const viewArea = (view[2] - view[0]) * (view[3] - view[1]);
  return viewArea > 0 ? (w * h) / viewArea : 0;
}

/** Local first when the search was scoped to a view; otherwise as ArcGIS ranked them. */
export function rankLocalFirst<T extends RankableResult>(results: T[], view: Bbox | null): T[] {
  if (!view) return results;
  return [...results].sort((a, b) => {
    const c = coverage(b.extent, view) - coverage(a.extent, view);
    if (Math.abs(c) > 1e-9) return c;
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

/**
 * What to tell the operator about an import that came back. ArcGIS caps a
 * query at the service's record limit and marks the response when it did;
 * the records it returns are then whichever it counted first, not the ones
 * under the cursor, which reads as "no property lines at my spot".
 */
export function describeImport(count: number, capped: boolean): string | null {
  if (count === 0) return 'That layer has nothing in this view. Try one whose owner is the city or county you are over.';
  if (capped) return `Capped at ${count.toLocaleString()} features — a view this wide holds more. Zoom in and import again for the rest.`;
  return null;
}
