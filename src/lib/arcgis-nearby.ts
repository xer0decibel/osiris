/**
 * OSIRIS — auto find: the layers ArcGIS Online has for wherever the map is.
 *
 * One search per subject, each scoped to the view and ranked by coverage like
 * any other, so the county's own layers rise and the nation-wide products
 * sink. One broad query was tried first and the local taxlot layers crowded
 * everything else out of six slots; per subject, pipelines and the grid get
 * their own turn. The subjects are the ArcGIS window's quick-picks, which live
 * here so the window and the strip cannot drift apart.
 */
export interface NearbyCategory { label: string; query: string }

/* Property lines lead: there is no national parcel layer anywhere, free or
   paid, but most counties publish their own, and searching against the current
   view finds the local one. The query asks for both names the layers go by —
   Washington says parcels, Oregon says taxlots, and "parcels" alone never found
   Multnomah County's layer. Measured over both: King County gives addresses and
   parcel numbers, Multnomah gives owners. Imports are capped at 2,000 features
   per view, so parcels want a neighbourhood zoom, not a county. */
export const NEARBY_CATEGORIES: readonly NearbyCategory[] = [
  { label: 'Property Lines', query: 'parcels OR taxlots OR "tax lots"' },
  { label: 'Pipelines', query: 'pipeline' },
  { label: 'Power Grid', query: 'power grid transmission' },
  { label: 'Infrastructure', query: 'critical infrastructure' },
  { label: 'Military', query: 'military base installation' },
  { label: 'Emergency', query: 'emergency shelter evacuation' },
] as const;

/** How many suggestions the strip shows per subject. */
export const NEARBY_PER_CATEGORY = 2;

/** How long the map has to sit still before searches are spent on the view. */
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
  /** The subject whose search found it. */
  category: string;
}

/**
 * Keep the first few of each subject, skip what is already on the map, and
 * never list the same layer under two subjects.
 */
export function pickNearby<T extends { id: string; category: string }>(
  results: T[], importedIds: Iterable<string>, perCategory = NEARBY_PER_CATEGORY,
): T[] {
  const have = new Set(importedIds);
  const seen = new Set<string>();
  const count: Record<string, number> = {};
  const out: T[] = [];
  for (const r of results) {
    if (have.has(r.id) || seen.has(r.id)) continue;
    if ((count[r.category] ?? 0) >= perCategory) continue;
    seen.add(r.id);
    count[r.category] = (count[r.category] ?? 0) + 1;
    out.push(r);
  }
  return out;
}
