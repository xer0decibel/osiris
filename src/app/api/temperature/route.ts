import { NextResponse } from 'next/server';
import { httpJson, HttpError } from '@/lib/httpJson';
import { GRID_COLS, GRID_ROWS, GRID_MAX_POINTS, parseBbox, snapBbox, bboxContains, gridPoints, openMeteoUrl, readOpenMeteo, cooldownFor, type TempGrid, type Bbox } from '@/lib/temperature-grid';

/**
 * OSIRIS — the current air-temperature field for a view. See
 * lib/temperature-grid for why it is built from points rather than tiles.
 *
 * GET /api/temperature?bbox=w,s,e,n[&cols=12&rows=8]
 *
 * Open-Meteo's free tier is about 600 location-calls a minute, and it answers
 * a 429 for a while once that is spent — which blanked the layer the first
 * afternoon. So this route is careful with it: the view is snapped to a
 * lattice, a fresh field that covers the request is served from cache without
 * asking, no more than one request goes upstream every few seconds, and a
 * 429 starts a cooldown during which the best cached field is served instead.
 * Open-Meteo says which limit was hit — a minute's, an hour's, a day's — and
 * the cooldown lasts until that limit resets, so the page can say when.
 */
export const dynamic = 'force-dynamic';

const TTL_MS = 15 * 60 * 1000;
const MIN_GAP_MS = 4000;
const COOLDOWN_MS = 90 * 1000;
const cache = new Map<string, { at: number; grid: TempGrid }>();
let lastUpstream = 0;
let cooldownUntil = 0;
let cooldownReason = '';

/** The freshest cached field that covers the request, or failing that overlaps it most. */
function bestCached(bbox: Bbox, nowMs: number): TempGrid | null {
  let covering: { at: number; grid: TempGrid } | null = null;
  let overlapping: { at: number; grid: TempGrid; share: number } | null = null;
  for (const entry of cache.values()) {
    if (nowMs - entry.at > TTL_MS) continue;
    if (bboxContains(entry.grid.bbox, bbox)) { if (!covering || entry.at > covering.at) covering = entry; continue; }
    const b = entry.grid.bbox;
    const w = Math.max(0, Math.min(b[2], bbox[2]) - Math.max(b[0], bbox[0]));
    const h = Math.max(0, Math.min(b[3], bbox[3]) - Math.max(b[1], bbox[1]));
    const share = (w * h) / ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
    if (share > 0.5 && (!overlapping || share > overlapping.share)) overlapping = { ...entry, share };
  }
  return covering?.grid ?? overlapping?.grid ?? null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const asked = parseBbox(searchParams.get('bbox'));
  if (!asked) return NextResponse.json({ error: 'bbox=w,s,e,n required' }, { status: 400 });
  const bbox = snapBbox(asked);
  const cols = Math.min(32, Math.max(2, Number(searchParams.get('cols')) || GRID_COLS));
  const rows = Math.min(32, Math.max(2, Number(searchParams.get('rows')) || GRID_ROWS));
  if (cols * rows > GRID_MAX_POINTS) return NextResponse.json({ error: `at most ${GRID_MAX_POINTS} points` }, { status: 400 });

  const now = Date.now();
  const headers = { 'Cache-Control': 'public, max-age=300' };
  const served = bestCached(bbox, now);
  if (served) return NextResponse.json({ ...served, cached: true }, { headers });

  if (now < cooldownUntil || now - lastUpstream < MIN_GAP_MS) {
    const retryAfterMs = Math.max(cooldownUntil - now, MIN_GAP_MS);
    return NextResponse.json({ error: 'temperature provider is being rate-limited; try again shortly', reason: now < cooldownUntil ? cooldownReason : '', retryAfterMs, resumesAt: new Date(now + retryAfterMs).toISOString() }, { status: 503, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } });
  }

  const points = gridPoints(bbox, cols, rows);
  lastUpstream = now;
  try {
    const body = await httpJson<unknown>(openMeteoUrl(points), { timeoutMs: 20000, headers: { 'Accept-Encoding': 'gzip' } });
    const read = readOpenMeteo(body, points.length);
    if (!read) return NextResponse.json({ error: 'Open-Meteo answered with the wrong number of points' }, { status: 502 });
    const grid: TempGrid = { cols, rows, bbox, values: read.values, time: read.time };
    cache.set(bbox.join(','), { at: Date.now(), grid });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return NextResponse.json(grid, { headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'temperature fetch failed';
    if (e instanceof HttpError && e.status === 429) {
      let reason = '';
      try { reason = String((JSON.parse(e.body) as { reason?: unknown }).reason ?? ''); } catch { /* not JSON */ }
      cooldownReason = reason;
      cooldownUntil = Date.now() + cooldownFor(reason, Date.now(), COOLDOWN_MS);
      return NextResponse.json({ error: message, reason, retryAfterMs: cooldownUntil - Date.now(), resumesAt: new Date(cooldownUntil).toISOString() }, { status: 503, headers: { 'Retry-After': String(Math.ceil((cooldownUntil - Date.now()) / 1000)) } });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
