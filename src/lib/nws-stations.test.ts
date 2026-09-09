import { describe, it, expect } from 'vitest';
import { nwsPointUrl, readPoint, readStationList, readLatest } from './nws-stations';

const list = {
  features: [
    { geometry: { coordinates: [-122.41, 45.55] }, properties: { stationIdentifier: 'KTTD', name: 'Portland-Troutdale' } },
    { geometry: { coordinates: [-122.61, 45.60] }, properties: { stationIdentifier: 'KPDX', name: 'Portland International' } },
    { geometry: { coordinates: [-121.0, 44.0] }, properties: { stationIdentifier: 'FAR', name: 'Far away' } },
    { geometry: { coordinates: [-122.35, 45.72] }, properties: { stationIdentifier: 'TR951', name: 'Larch Mt.' } },
    { geometry: { coordinates: ['x', 45] }, properties: { stationIdentifier: 'BAD' } },
  ],
};

describe('NWS stations', () => {
  it('addresses the point lookup to four decimals', () => {
    expect(nwsPointUrl(45.51951, -122.34364)).toBe('https://api.weather.gov/points/45.5195,-122.3436');
  });

  it('reads the station list a point names, and nothing outside the service', () => {
    expect(readPoint({ properties: { observationStations: 'https://api.weather.gov/gridpoints/PQR/123,102/stations' } })).toBe('https://api.weather.gov/gridpoints/PQR/123,102/stations');
    expect(readPoint({ title: 'Not Found', status: 404 })).toBeNull();
  });

  it('keeps the stations inside the view, nearest first, capped', () => {
    const got = readStationList(list, [-122.8, 45.3, -122.0, 45.9], 2);
    expect(got.map(s => s.id)).toEqual(['KTTD', 'TR951']);
    expect(readStationList(list, [-122.8, 45.3, -122.0, 45.9]).map(s => s.id)).not.toContain('FAR');
  });

  it('reads a reading, converts Fahrenheit, and drops missing or stale ones', () => {
    const now = Date.parse('2026-09-09T17:00:00Z');
    expect(readLatest({ properties: { temperature: { value: 18, unitCode: 'wmoUnit:degC' }, timestamp: '2026-09-09T16:50:00+00:00' } }, now)).toEqual({ tempC: 18, time: '2026-09-09T16:50:00+00:00' });
    expect(readLatest({ properties: { temperature: { value: 68, unitCode: 'wmoUnit:degF' }, timestamp: '2026-09-09T16:50:00+00:00' } }, now)?.tempC).toBeCloseTo(20, 6);
    expect(readLatest({ properties: { temperature: { value: null, unitCode: 'wmoUnit:degC' }, timestamp: '2026-09-09T16:50:00+00:00' } }, now)).toBeNull();
    expect(readLatest({ properties: { temperature: { value: 18, unitCode: 'wmoUnit:degC' }, timestamp: '2026-09-09T10:00:00+00:00' } }, now)).toBeNull();
  });
});
