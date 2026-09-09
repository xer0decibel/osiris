import { NextResponse } from 'next/server';
import { httpBytes } from '@/lib/httpJson';
import { readGrib2 } from '@/lib/grib2';
import { gfsCycles, gfsFilterUrl, toGlobalField, seriesFrom, fieldAt, cropField, GFS_RESOLUTION, GFS_HOURS, type GlobalSeries, type GlobalField } from '@/lib/gfs';
import { parseBbox } from '@/lib/temperature-grid';

/**
 * OSIRIS — the globe's temperature field, from NOAA's GFS. See lib/gfs.
 *
 * GET /api/temperature/gfs?bbox=w,s,e,n
 *
 * One run's forecast hours — five files of 160 KB — fetched together,
 * decoded once and held; every request interpolates them to the present
 * and crops the result. A newer run is looked for every twenty minutes
 * once it should exist, and the old one is kept if the new one is not up
 * yet. NOMADS is public domain and keyless and asks only for a reasonable
 * rate: this is at most five requests every six hours.
 */
export const dynamic = 'force-dynamic';

const RECHECK_MS = 20 * 60 * 1000;
let held: GlobalSeries | null = null;
let checkedAt = 0;
let loading: Promise<GlobalSeries | null> | null = null;

async function fetchFrame(cycle: ReturnType<typeof gfsCycles>[number], hour: number): Promise<GlobalField | null> {
  try {
    const bytes = await httpBytes(gfsFilterUrl(cycle, GFS_RESOLUTION, hour), { timeoutMs: 30000 });
    if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'GRIB') return null; // the filter's "not yet" is an HTML page
    const [field] = readGrib2(bytes);
    return field ? toGlobalField(field, GFS_RESOLUTION) : null;
  } catch (e) {
    console.warn(`[gfs] ${cycle.date}/${cycle.hour} f${hour}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function fetchRun(now: number): Promise<GlobalSeries | null> {
  for (const cycle of gfsCycles(now)) {
    if (held && cycle.iso <= held.run) return held; // nothing newer is due
    const frames = (await Promise.all(GFS_HOURS.map(h => fetchFrame(cycle, h)))).filter((f): f is GlobalField => f !== null);
    if (frames.length < 2) continue; // a run still being published: try the previous one
    try { return seriesFrom(frames); } catch (e) { console.warn(`[gfs] ${cycle.date}/${cycle.hour}: ${e instanceof Error ? e.message : e}`); }
  }
  return held;
}

async function currentSeries(): Promise<GlobalSeries | null> {
  const now = Date.now();
  if (held && now - checkedAt < RECHECK_MS) return held;
  if (!loading) {
    loading = fetchRun(now).then(s => { checkedAt = Date.now(); if (s) held = s; return held; }).finally(() => { loading = null; });
  }
  return loading;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bbox = parseBbox(searchParams.get('bbox'));
  if (!bbox) return NextResponse.json({ error: 'bbox=w,s,e,n required' }, { status: 400 });
  const series = await currentSeries();
  if (!series) return NextResponse.json({ error: 'no GFS run could be fetched from NOMADS' }, { status: 502 });
  const field = fieldAt(series, Date.now());
  const grid = cropField(field, bbox);
  return NextResponse.json(
    { ...grid, source: 'gfs', run: series.run, resolution: series.resolution, frames: series.frames.map(f => f.time) },
    { headers: { 'Cache-Control': 'public, max-age=120' } },
  );
}
