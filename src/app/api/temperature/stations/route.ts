import { NextResponse } from 'next/server';
import { httpJson } from '@/lib/httpJson';
import { parseBbox } from '@/lib/temperature-grid';
import { nwsPointUrl, nwsLatestUrl, readPoint, readStationList, readLatest, type Station } from '@/lib/nws-stations';

/**
 * OSIRIS — NOAA's latest thermometer readings for a view. See
 * lib/nws-stations. GET /api/temperature/stations?bbox=w,s,e,n
 *
 * One point lookup for the view's centre, one station list, then the
 * nearest stations' latest observations in parallel. Cached five minutes
 * per view rounded to a tenth of a degree; observations are hourly or so.
 * Outside the US the point lookup is a 404 and the answer is an empty list.
 */
export const dynamic = 'force-dynamic';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; stations: Station[] }>();
const NWS_HEADERS = { Accept: 'application/geo+json' };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bbox = parseBbox(searchParams.get('bbox'));
  if (!bbox) return NextResponse.json({ error: 'bbox=w,s,e,n required' }, { status: 400 });
  const key = bbox.map(n => n.toFixed(1)).join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ stations: hit.stations, cached: true });

  const lat = (bbox[1] + bbox[3]) / 2, lng = (bbox[0] + bbox[2]) / 2;
  let listUrl: string | null = null;
  try {
    listUrl = readPoint(await httpJson<unknown>(nwsPointUrl(lat, lng), { timeoutMs: 10000, headers: NWS_HEADERS }));
  } catch { /* outside the service, or the service is down: no stations */ }
  if (!listUrl) {
    cache.set(key, { at: Date.now(), stations: [] });
    return NextResponse.json({ stations: [], note: 'No NWS coverage for this view' });
  }

  let candidates: ReturnType<typeof readStationList> = [];
  try {
    candidates = readStationList(await httpJson<unknown>(listUrl, { timeoutMs: 10000, headers: NWS_HEADERS }), bbox);
  } catch { /* fall through with none */ }

  const now = Date.now();
  const settled = await Promise.allSettled(candidates.map(async s => {
    const latest = readLatest(await httpJson<unknown>(nwsLatestUrl(s.id), { timeoutMs: 8000, headers: NWS_HEADERS }), now);
    return latest ? { ...s, ...latest } : null;
  }));
  const stations = settled.flatMap(r => (r.status === 'fulfilled' && r.value ? [r.value] : []));
  cache.set(key, { at: now, stations });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return NextResponse.json({ stations, asked: candidates.length });
}
