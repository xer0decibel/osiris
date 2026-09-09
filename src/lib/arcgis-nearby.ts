/**
 * OSIRIS — auto find: the layers ArcGIS Online has for wherever the map is.
 *
 * One broad search, scoped to the view and ranked by coverage like any other,
 * so the county's own layers rise and the nation-wide products sink. The
 * query is the union of what the window's quick-picks ask for — property
 * lines under both names, pipelines, the grid, infrastructure, military,
 * emergency — plus flood and zoning, which are the two things people look up
 * about a place they have just found on a map. Measured over Multnomah
 * County: the two taxlot layers lead, a tsunami study and a pipeline layer
 * follow, Regrid's paid product sits seventh.
 */
export const NEARBY_QUERY =
  'parcels OR taxlots OR "tax lots" OR pipeline OR "power grid" OR transmission OR "critical infrastructure" OR military OR emergency OR evacuation OR flood OR zoning';

/** How many suggestions the strip shows. Enough to be useful, few enough to glance at. */
export const NEARBY_LIMIT = 6;

/** How long the map has to sit still before a search is spent on the view. */
export const NEARBY_SETTLE_MS = 1200;

export interface Bounds { west: number; south: number; east: number; north: number }

/** The route's bbox parameter, in the order it expects. */
export function bboxParam(b: Bounds): string {
  return [b.west, b.south, b.east, b.north].map(n => n.toFixed(4)).join(',');
}

export interface NearbyResult {
  id: string;
  title: string;
  url: string;
  owner: string;
  numViews: number;
}

/** Drop what is already on the map, and cap the list. */
export function pickNearby<T extends { id: string }>(results: T[], importedIds: Iterable<string>, limit = NEARBY_LIMIT): T[] {
  const have = new Set(importedIds);
  return results.filter(r => !have.has(r.id)).slice(0, limit);
}
