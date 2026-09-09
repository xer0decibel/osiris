import { NextResponse } from 'next/server';
import { httpJson } from '@/lib/httpJson';

/**
 * OSIRIS — Weather raster overlays.
 *
 * Two keyless sources, both returned as ready-to-use MapLibre tile templates so
 * the client never has to know either provider's URL grammar:
 *
 *   radar   RainViewer — global precipitation, ~13 frames at 10-minute steps,
 *           which is what makes the layer animate. Note the hard tile ceiling:
 *           past tile zoom 7 RainViewer answers 200 OK with a grey PNG reading
 *           "Zoom Level Not Supported", which a map will cheerfully draw. The
 *           source maxzoom in OsirisMap is what stops that being requested.
 *   clouds  NASA GIBS — VIIRS/NOAA-20 true-colour reflectance.
 *
 * The cloud layer is true colour rather than infrared on purpose. GIBS also
 * serves MODIS brightness-temperature, which is the more literal reading of
 * "infrared", but rendered over a dark basemap it is a muddy tan wash crossed
 * by white orbital swath gaps. True colour gives clean white cloud structure
 * over visible ocean. The cost is that reflectance needs sunlight, so the night
 * side of the globe is empty.
 */

export const dynamic = 'force-dynamic';

const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const CLOUD_LAYER = 'VIIRS_NOAA20_CorrectedReflectance_TrueColor';

/** RainViewer colour scheme 2 (universal blue) with smoothing and snow on. */
const RADAR_STYLE = '2/1_1';

interface RvFrame { time?: number; path?: string }
interface RvIndex {
  host?: string;
  radar?: { past?: RvFrame[]; nowcast?: RvFrame[] };
}

export interface RadarFrame {
  /** Unix seconds for the frame, for labelling the scrubber. */
  time: number;
  /** MapLibre raster template. */
  url: string;
  /** Forecast frames are extrapolated, not observed, and are labelled as such. */
  forecast: boolean;
}

/**
 * GIBS publishes each day's imagery some hours after acquisition, so "today"
 * is often not there yet and would render as an empty layer. Stepping back
 * twelve hours lands on a published day for most of the UTC clock without
 * pinning the view a whole day behind.
 */
function cloudDate(nowMs: number): string {
  return new Date(nowMs - 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function GET() {
  const now = Date.now();
  const date = cloudDate(now);
  const clouds = {
    date,
    layer: CLOUD_LAYER,
    // GIBS orders the path row-before-column, so this is {z}/{y}/{x}, not the
    // {z}/{x}/{y} the rest of the map's raster sources use.
    url: `${GIBS}/${CLOUD_LAYER}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
  };

  let frames: RadarFrame[] = [];
  let radarError: string | null = null;

  try {
    const idx = await httpJson<RvIndex>(RAINVIEWER_INDEX, {
      timeoutMs: 15000,
      headers: { 'Accept-Encoding': 'gzip' },
    });
    const host = idx.host || 'https://tilecache.rainviewer.com';
    const build = (f: RvFrame, forecast: boolean): RadarFrame | null => {
      if (!f?.path || typeof f.time !== 'number') return null;
      return {
        time: f.time,
        /* 512px rather than 256px deliberately. RainViewer serves real data to
           tile zoom 7 at either size, and MapLibre asks for
           zoom+1 with 256px tiles but zoom+0 with 512px — so the larger tile is
           worth two levels of usable detail before the layer has to overzoom. */
        url: `${host}${f.path}/512/{z}/{x}/{y}/${RADAR_STYLE}.png`,
        forecast,
      };
    };
    frames = [
      ...(idx.radar?.past ?? []).map(f => build(f, false)),
      ...(idx.radar?.nowcast ?? []).map(f => build(f, true)),
    ].filter((f): f is RadarFrame => f !== null);
  } catch (e) {
    radarError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    radar: { frames, count: frames.length, error: radarError },
    clouds,
    generated: Math.floor(now / 1000),
  });
}
