import { describe, it, expect } from 'vitest';
import { NEARBY_CATEGORIES, bboxParam, pickNearby } from './arcgis-nearby';

describe('auto find', () => {
  it('asks for property lines under both names, and has a subject for each quick-pick', () => {
    const lines = NEARBY_CATEGORIES.find(c => c.label === 'Property Lines')!;
    expect(lines.query).toContain('parcels');
    expect(lines.query).toContain('taxlots');
    expect(NEARBY_CATEGORIES.map(c => c.label)).toEqual(['Property Lines', 'Pipelines', 'Power Grid', 'Infrastructure', 'Military', 'Emergency']);
  });

  it('formats the view as the route wants it', () => {
    expect(bboxParam({ west: -122.4, south: 45.5, east: -122.3, north: 45.55 })).toBe('-122.4000,45.5000,-122.3000,45.5500');
  });

  it('keeps a few per subject, skips what is on the map, and never repeats a layer', () => {
    const r = (id: string, category: string) => ({ id, category });
    const results = [
      r('tax1', 'Property Lines'), r('tax2', 'Property Lines'), r('tax3', 'Property Lines'),
      r('pipe1', 'Pipelines'), r('tax1', 'Pipelines'), r('pipe2', 'Pipelines'),
      r('grid1', 'Power Grid'),
    ];
    const picked = pickNearby(results, ['tax2'], 2);
    expect(picked.map(x => x.id)).toEqual(['tax1', 'tax3', 'pipe1', 'pipe2', 'grid1']);
  });
});
