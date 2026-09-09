import { NextResponse } from 'next/server';
import { httpBytes } from '@/lib/httpJson';
import { readGrib2 } from '@/lib/grib2';
import { gfsCycles, gfsFilterUrl, toGlobalField, cropField, GFS_RESOLUTION, type GlobalField } from '@/lib/gfs';
import { parseBbox } from '@/lib/temperature-grid';

/**
 * OSIRIS — the globe's temperature field, from NOAA's GFS. See lib/gfs.
 *
 * GET /api/temperature/gfs?bbox=w,s,e,n
 *
 * One 160 KB download per model run, decoded once and held; every view is
 * a crop of it. A newer run is looked for every twenty minutes once it
 * should exist, and the old one is kept if the new one is not up yet. NOMADS
 * is public domain and keyless and asks only for a reasonable rate.
 */
export const dynamic = 'force-dynamic';

const RECHECK_MS = 20 * 60 * 1000;
let held: GlobalField | null = null;
let checkedAt = 0;
let loading: Promise<GlobalField | null> | null = null;

async function fetchRun(now: number): Promise<GlobalField | null> {
  for (const cycle of gfsCycles(now)) {
    if (held && cycle.iso <= held.run) return held; // nothing newer is due
    try {
      const bytes = await httpBytes(gfsFilterUrl(cycle, GFS_RESOLUTION), { timeoutMs: 30000 });
      if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'GRIB') continue; // the filter's "not yet" is an HTML page
      const [field] = readGrib2(bytes);
      if (!field) continue;
      return toGlobalField(field, GFS_RESOLUTION);
    } catch (e) {
      console.warn(`[gfs] ${cycle.date}/${cycle.hour}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return held;
}

async function currentField(): Promise<GlobalField | null> {
  const now = Date.now();
  if (held && now - checkedAt < RECHECK_MS) return held;
  if (!loading) {
    loading = fetchRun(now).then(f => { checkedAt = Date.now(); if (f) held = f; return held; }).finally(() => { loading = null; });
  }
  return loading;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bbox = parseBbox(searchParams.get('bbox'));
  if (!bbox) return NextResponse.json({ error: 'bbox=w,s,e,n required' }, { status: 400 });
  const field = await currentField();
  if (!field) return NextResponse.json({ error: 'no GFS run could be fetched from NOMADS' }, { status: 502 });
  const grid = cropField(field, bbox);
  return NextResponse.json({ ...grid, source: 'gfs', run: field.run, resolution: field.resolution }, { headers: { 'Cache-Control': 'public, max-age=600' } });
}
