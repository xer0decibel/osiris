import { NextResponse } from 'next/server';
import { httpJson } from '@/lib/httpJson';
import { GRID_COLS, GRID_ROWS, GRID_MAX_POINTS, parseBbox, gridPoints, openMeteoUrl, readOpenMeteo, type TempGrid } from '@/lib/temperature-grid';

/**
 * OSIRIS — the current air-temperature field for a view. See
 * lib/temperature-grid for why it is built from points rather than tiles.
 *
 * GET /api/temperature?bbox=w,s,e,n[&cols=24&rows=16]
 *
 * Cached ten minutes per view rounded to a tenth of a degree: Open-Meteo
 * updates hourly, and a map nudged a few pixels is the same field.
 */
export const dynamic = 'force-dynamic';

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; grid: TempGrid }>();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bbox = parseBbox(searchParams.get('bbox'));
  if (!bbox) return NextResponse.json({ error: 'bbox=w,s,e,n required' }, { status: 400 });
  const cols = Math.min(64, Math.max(2, Number(searchParams.get('cols')) || GRID_COLS));
  const rows = Math.min(64, Math.max(2, Number(searchParams.get('rows')) || GRID_ROWS));
  if (cols * rows > GRID_MAX_POINTS) return NextResponse.json({ error: `at most ${GRID_MAX_POINTS} points` }, { status: 400 });

  const key = `${bbox.map(n => n.toFixed(1)).join(',')}:${cols}x${rows}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.grid, { headers: { 'Cache-Control': 'public, max-age=300' } });

  const points = gridPoints(bbox, cols, rows);
  try {
    const body = await httpJson<unknown>(openMeteoUrl(points), { timeoutMs: 20000, headers: { 'Accept-Encoding': 'gzip' } });
    const read = readOpenMeteo(body, points.length);
    if (!read) return NextResponse.json({ error: 'Open-Meteo answered with the wrong number of points' }, { status: 502 });
    const grid: TempGrid = { cols, rows, bbox, values: read.values, time: read.time };
    cache.set(key, { at: Date.now(), grid });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return NextResponse.json(grid, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'temperature fetch failed' }, { status: 502 });
  }
}
