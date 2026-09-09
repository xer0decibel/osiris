/**
 * OSIRIS — the pure parts of the traffic tile proxy, kept out of the route
 * file because Next allows a route module to export only its handlers.
 */
export const TRAFFIC_MAX_ZOOM = 22;

export interface TileXYZ { z: number; x: number; y: number }

/** Tile coordinates are non-negative integers, and x and y fit the zoom. */
export function parseTile(z: string, x: string, y: string): TileXYZ | null {
  if (![z, x, y].every(v => /^\d{1,7}$/.test(v))) return null;
  const zi = Number(z), xi = Number(x), yi = Number(y);
  if (zi > TRAFFIC_MAX_ZOOM) return null;
  const n = 2 ** zi;
  if (xi >= n || yi >= n) return null;
  return { z: zi, x: xi, y: yi };
}

/**
 * TomTom's Traffic Flow tile. `relative0` colours each road by its current
 * speed as a fraction of free-flow, green through red, which is the reading
 * an operator wants; the absolute styles are for routing engines.
 */
export function trafficTileUrl(t: TileXYZ, key: string): string {
  return `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${t.z}/${t.x}/${t.y}.png?key=${encodeURIComponent(key)}`;
}
