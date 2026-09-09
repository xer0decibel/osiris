import { NextResponse } from 'next/server';
import { httpJson } from '@/lib/httpJson';
import { cachedSource } from '@/lib/sourceCache';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Named wildfire incidents (NIFC / WFIGS).
 *
 * The counterpart to /api/fires. That route serves satellite hotspots: a pixel
 * read hot, with no name and no size. This one serves what the fire agencies
 * themselves report — incident name, acres, containment, cause, personnel — the
 * figures a hotspot can never carry.
 *
 * Coverage is the United States only. It complements FIRMS rather than
 * replacing it, and a quiet US map here does not mean the world is not burning.
 *
 * Keyless ArcGIS REST, the same feed the public wildfire trackers run on.
 */

const WFIGS =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';

/* Pulled explicitly rather than with outFields=*: the layer carries 97 columns
   and all but a dozen are administrative keys the map has no use for. */
const FIELDS = [
  'OBJECTID', 'IncidentName', 'IncidentSize', 'PercentContained', 'FireCause',
  'FireCauseGeneral', 'POOState', 'POOCounty', 'TotalIncidentPersonnel',
  'FireDiscoveryDateTime', 'IncidentTypeCategory', 'IncidentComplexityLevel',
  'POOJurisdictionalAgency',
].join(',');

export interface FireIncident {
  id: number;
  name: string;
  lat: number;
  lng: number;
  /** Acres. Null where the agency has not reported a size yet. */
  acres: number | null;
  contained: number | null;
  cause: string;
  state: string;
  county: string;
  personnel: number | null;
  /** Epoch ms of discovery, as the service reports it. */
  discovered: number | null;
  /** WF = wildfire, RX = prescribed burn. Kept apart, never conflated. */
  kind: string;
  complexity: string;
  agency: string;
}

interface EsriFeature {
  geometry?: { coordinates?: number[] };
  properties?: Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function fetchIncidents(): Promise<FireIncident[]> {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: FIELDS,
    f: 'geojson',
    returnGeometry: 'true',
    resultRecordCount: '2000',
  });

  const body = await httpJson<{ features?: EsriFeature[] }>(`${WFIGS}?${params}`, {
    timeoutMs: 30000,
    headers: { 'Accept-Encoding': 'gzip' },
  });

  const out: FireIncident[] = [];
  for (const f of body.features ?? []) {
    const co = f.geometry?.coordinates;
    if (!co || co.length < 2 || !Number.isFinite(co[0]) || !Number.isFinite(co[1])) continue;
    const p = f.properties ?? {};
    const name = str(p.IncidentName);
    if (!name) continue;

    out.push({
      id: Number(p.OBJECTID) || out.length,
      name,
      lat: co[1],
      lng: co[0],
      acres: num(p.IncidentSize),
      contained: num(p.PercentContained),
      cause: str(p.FireCause) || str(p.FireCauseGeneral),
      // Reported as "US-OR"; the prefix is noise on a map that is already US-only.
      state: str(p.POOState).replace(/^US-/, ''),
      county: str(p.POOCounty),
      personnel: num(p.TotalIncidentPersonnel),
      discovered: num(p.FireDiscoveryDateTime),
      kind: str(p.IncidentTypeCategory) || 'WF',
      complexity: str(p.IncidentComplexityLevel),
      agency: str(p.POOJurisdictionalAgency),
    });
  }

  // Largest first, so the significant fires win any marker collision.
  out.sort((a, b) => (b.acres ?? 0) - (a.acres ?? 0));
  return out;
}

const load = cachedSource<FireIncident>('fire-incidents', fetchIncidents, 15 * 60 * 1000);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  /* Prescribed burns are real incidents on the same feed but they are planned
     fires, and showing them beside wildfires without distinction would misread
     the map. Excluded unless asked for. */
  const includeRx = searchParams.get('rx') === '1';

  try {
    const all = await load();
    const incidents = includeRx ? all : all.filter(i => i.kind !== 'RX');
    return NextResponse.json({
      incidents,
      count: incidents.length,
      wildfires: all.filter(i => i.kind !== 'RX').length,
      prescribed: all.filter(i => i.kind === 'RX').length,
      source: 'NIFC / WFIGS',
      coverage: 'United States',
    });
  } catch (e) {
    return NextResponse.json(
      { incidents: [], count: 0, error: 'WFIGS unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
