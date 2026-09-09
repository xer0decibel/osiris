/**
 * OSIRIS — NOAA's thermometers, for the combined temperature model.
 *
 * The National Weather Service API is keyless and asks only for an
 * identifying User-Agent. For a point it names the forecast grid cell and the
 * observation stations that serve it — 71 around Troutdale when measured —
 * and each station answers its latest observation. Not every station carries
 * a thermometer, and a reading can be an hour old; both are handled here.
 * It ends at the border: outside the US the point lookup answers 404, and
 * the model falls back to Open-Meteo alone.
 */
import type { Bbox } from './temperature-grid';

export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Celsius. */
  tempC: number;
  /** ISO time of the observation. */
  time: string;
}

export function nwsPointUrl(lat: number, lng: number): string {
  return `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export function nwsLatestUrl(stationId: string): string {
  return `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`;
}

/** The station-list URL a point lookup names, or null when the point is outside the service. */
export function readPoint(body: unknown): string | null {
  const url = (body as { properties?: { observationStations?: unknown } })?.properties?.observationStations;
  return typeof url === 'string' && url.startsWith('https://api.weather.gov/') ? url : null;
}

/**
 * The stations in the list that fall inside the view, nearest to its centre
 * first, capped — every station is another request, and thirty is a lot of
 * thermometers for one screen.
 */
export function readStationList(body: unknown, bbox: Bbox, limit = 24): { id: string; name: string; lat: number; lng: number }[] {
  const features = (body as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2;
  const out: { id: string; name: string; lat: number; lng: number; d: number }[] = [];
  for (const f of features) {
    const g = (f as { geometry?: { coordinates?: unknown } }).geometry?.coordinates;
    const p = (f as { properties?: { stationIdentifier?: unknown; name?: unknown } }).properties ?? {};
    if (!Array.isArray(g) || typeof p.stationIdentifier !== 'string') continue;
    const [lng, lat] = g as number[];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    out.push({ id: p.stationIdentifier, name: typeof p.name === 'string' ? p.name : p.stationIdentifier, lat, lng, d: (lng - cx) ** 2 + (lat - cy) ** 2 });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, limit).map(({ d: _d, ...s }) => s);
}

/** A station's latest reading in Celsius, or null when it has none or it is stale. */
export function readLatest(body: unknown, nowMs = Date.now(), maxAgeMs = 3 * 60 * 60 * 1000): { tempC: number; time: string } | null {
  const p = (body as { properties?: { temperature?: { value?: unknown; unitCode?: unknown }; timestamp?: unknown } })?.properties;
  const v = p?.temperature?.value;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const unit = String(p?.temperature?.unitCode ?? '');
  const tempC = /degF/.test(unit) ? (v - 32) * 5 / 9 : v;
  const time = typeof p?.timestamp === 'string' ? p.timestamp : '';
  const at = Date.parse(time);
  if (Number.isFinite(at) && nowMs - at > maxAgeMs) return null;
  return { tempC, time };
}
