import { describe, it, expect } from 'vitest';
import { NEARBY_QUERY, bboxParam, pickNearby } from './arcgis-nearby';

describe('auto find', () => {
  it('asks for property lines under both names, and the quick-pick subjects', () => {
    for (const word of ['parcels', 'taxlots', 'pipeline', 'military', 'emergency', 'flood']) {
      expect(NEARBY_QUERY).toContain(word);
    }
  });

  it('formats the view as the route wants it', () => {
    expect(bboxParam({ west: -122.4, south: 45.5, east: -122.3, north: 45.55 })).toBe('-122.4000,45.5000,-122.3000,45.5500');
  });

  it('leaves out what is already on the map and caps the list', () => {
    const results = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}` }));
    const picked = pickNearby(results, ['l0', 'l2']);
    expect(picked.map(r => r.id)).toEqual(['l1', 'l3', 'l4', 'l5', 'l6', 'l7']);
  });
});
