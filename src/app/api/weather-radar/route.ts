import { NextResponse } from 'next/server';
import { httpJson } from '@/lib/httpJson';
import { cloudDates, gibsTileTemplate, compositeTemplate, CLOUD_LAYER } from '@/lib/cloud-composite';

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
 *   clouds  NASA GIBS — VIIRS/NOAA-20 true-colour reflectance, today's
 *           composite keyed over yesterday's in the browser — see
 *           lib/cloud-composite for why one day alone is half black.
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

export async function GET() {
  const now = Date.now();
  const { top, under } = cloudDates(now);
  const clouds = {
    date: top,
    under,
    layer: CLOUD_LAYER,
    /* The plain GIBS templates, for anything that wants one day as-is. The
       map uses `composite`, a custom-protocol template the browser resolves
       by fetching both days and filling today's black no-data from yesterday. */
    url: gibsTileTemplate(top),
    underUrl: gibsTileTemplate(under),
    composite: compositeTemplate(top, under),
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
