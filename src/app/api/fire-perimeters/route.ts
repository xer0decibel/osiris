import { NextResponse } from 'next/server';
import { httpJson } from '@/lib/httpJson';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Wildfire perimeters (NIFC / WFIGS).
 *
 * The burned footprint rather than a marker: a fire stops being a dot and
 * becomes its actual shape. Agency-reported and mapped by hand or by overflight,
 * so it updates a few times a day, not live — the edge drawn here is where the
 * fire was last surveyed, not where it is burning this minute.
 *
 * ── On geometry generalisation ──
 * At full resolution these 194 polygons are 38MB, which is not a payload, it is
 * an outage. Requested at maxAllowableOffset=0.005° (roughly 500m) they are
 * 0.53MB — seventy times smaller, and indistinguishable at any zoom where a
 * whole fire is on screen. Anyone who needs survey-grade edges should be
 * looking at the agency's own product, not a situational-awareness map.
 */

const WFIGS =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';

/** Degrees. ~500m at the equator, less nearer the poles. */
const SIMPLIFY = '0.005';

interface EsriFeature {
  type?: string;
  geometry?: unknown;
  properties?: Record<string, unknown>;
}

export async function GET() {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'poly_IncidentName,poly_GISAcres,attr_PercentContained,attr_FireCause,attr_POOState',
    f: 'geojson',
    returnGeometry: 'true',
    maxAllowableOffset: SIMPLIFY,
    resultRecordCount: '1000',
  });

  try {
    const body = await httpJson<{ features?: EsriFeature[] }>(`${WFIGS}?${params}`, {
      timeoutMs: 45000,
      headers: { 'Accept-Encoding': 'gzip' },
    });

    /* Rebuilt rather than passed through so the property names match the rest of
       the app, and so a change in the upstream schema surfaces here instead of
       silently emptying a popup. */
    const features = (body.features ?? [])
      .filter(f => f.geometry)
      .map((f, i) => {
        const p = f.properties ?? {};
        const acres = typeof p.poly_GISAcres === 'number' ? Math.round(p.poly_GISAcres) : null;
        const contained = typeof p.attr_PercentContained === 'number' ? p.attr_PercentContained : null;
        return {
          type: 'Feature' as const,
          geometry: f.geometry,
          properties: {
            id: i,
            name: typeof p.poly_IncidentName === 'string' ? p.poly_IncidentName.trim() : 'Unnamed',
            acres,
            contained,
            cause: typeof p.attr_FireCause === 'string' ? p.attr_FireCause : '',
            state: typeof p.attr_POOState === 'string' ? p.attr_POOState.replace(/^US-/, '') : '',
          },
        };
      });

    return NextResponse.json({
      perimeters: { type: 'FeatureCollection', features },
      count: features.length,
      simplified_deg: Number(SIMPLIFY),
      source: 'NIFC / WFIGS',
      coverage: 'United States',
    });
  } catch (e) {
    return NextResponse.json(
      {
        perimeters: { type: 'FeatureCollection', features: [] },
        count: 0,
        error: 'WFIGS perimeters unreachable',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
