import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseCommand, buildGazetteer, lookupPlace, COMMAND_LAYER_KEYS,
} from './commands';

describe('parseCommand', () => {
  it('turns a layer word into a layer', () => {
    expect(parseCommand('fires').layers).toEqual(['fires']);
    expect(parseCommand('radar').layers).toEqual(['wx_radar']);
  });

  it('separates a layer from a place', () => {
    const r = parseCommand('fires in oregon');
    expect(r.layers).toEqual(['fires']);
    expect(r.place).toBe('oregon');
  });

  it('leaves a bare place alone, so the old behaviour still works', () => {
    const r = parseCommand('Tokyo');
    expect(r.layers).toEqual([]);
    expect(r.place).toBe('tokyo');
  });

  it('prefers the longer phrase over the word inside it', () => {
    // "fire perimeters" must not be swallowed by "fire".
    expect(parseCommand('fire perimeters').layers).toEqual(['fire_perimeters']);
    expect(parseCommand('named fires').layers).toEqual(['fire_incidents']);
  });

  it('accepts more than one layer at once', () => {
    const r = parseCommand('show me fires and radar over california');
    expect(r.layers).toContain('fires');
    expect(r.layers).toContain('wx_radar');
    expect(r.place).toBe('and california');
  });

  it('strips filler verbs rather than geocoding them', () => {
    expect(parseCommand('show me the radar').place).toBeNull();
    expect(parseCommand('find flights near london').place).toBe('london');
  });

  it('recognises a request to turn something off', () => {
    const r = parseCommand('turn off cctv');
    expect(r.off).toBe(true);
    expect(r.layers).toEqual(['cctv']);
  });

  it('matches on word boundaries, not substrings', () => {
    // The classic: "rain" inside "Ukraine" must not switch on the radar.
    expect(parseCommand('Ukraine').layers).toEqual([]);
    expect(parseCommand('Ukraine').place).toBe('ukraine');
    // ...but the standalone word still works.
    expect(parseCommand('rain').layers).toEqual(['wx_radar']);
  });

  it('survives punctuation and empty input', () => {
    expect(parseCommand('  ').layers).toEqual([]);
    expect(parseCommand('  ').place).toBeNull();
    expect(parseCommand('fires, oregon!').layers).toEqual(['fires']);
    expect(parseCommand('fires, oregon!').place).toBe('oregon');
  });

  /**
   * The guard that matters most. Every key the parser can emit has to exist in
   * the real layer registry — otherwise a renamed layer leaves a command that
   * looks like it works and silently toggles nothing.
   */
  it('only emits layer keys that LayerPanel actually defines', () => {
    const panel = fs.readFileSync(
      path.join(process.cwd(), 'src/components/LayerPanel.tsx'), 'utf8',
    );
    const real = new Set([...panel.matchAll(/\{ key: '([a-z0-9_]+)'/g)].map(m => m[1]));
    expect(real.size).toBeGreaterThan(20); // the scrape itself still works
    const unknown = COMMAND_LAYER_KEYS.filter(k => !real.has(k));
    expect(unknown).toEqual([]);
  });
});

describe('offline gazetteer', () => {
  const countries = {
    features: [{
      properties: { NAME: 'Kenya' },
      geometry: { type: 'Polygon', coordinates: [[[34, -4], [42, -4], [42, 4], [34, 4], [34, -4]]] },
    }],
  };
  const places = {
    features: [{
      properties: { NAME: 'Tokyo' },
      geometry: { type: 'Point', coordinates: [139.75, 35.68] },
    }],
  };

  it('places a country from its polygon and a city from its point', () => {
    const g = buildGazetteer(countries, places);
    const kenya = g.find(e => e.name === 'Kenya');
    const tokyo = g.find(e => e.name === 'Tokyo');
    expect(kenya).toBeDefined();
    expect(tokyo).toBeDefined();
    // The ring is closed, so its repeated first vertex must not be averaged in.
    expect(Math.round(kenya!.lng)).toBe(38);
    expect(tokyo!.lat).toBeCloseTo(35.68, 2);
  });

  it('zooms wider for a country than a state, and a state than a city', () => {
    const regions = {
      features: [{
        properties: { name: 'Oregon' },
        geometry: { type: 'Polygon', coordinates: [[[-124, 42], [-117, 42], [-117, 46], [-124, 46], [-124, 42]]] },
      }],
    };
    const g = buildGazetteer(countries, places, regions);
    const zoom = (n: string) => g.find(e => e.name === n)?.zoom;
    expect(zoom('Kenya')).toBeLessThan(zoom('Oregon')!);
    expect(zoom('Oregon')).toBeLessThan(zoom('Tokyo')!);
  });

  it('reads a lowercase name, which the simple Natural Earth layers use', () => {
    // Filtering for NAME only is what silently emptied every place feature and
    // cost the offline map its city labels.
    const g = buildGazetteer(null, {
      features: [{ properties: { name: 'Nairobi' }, geometry: { type: 'Point', coordinates: [36.8, -1.28] } }],
    });
    expect(g.map(e => e.name)).toEqual(['Nairobi']);
  });

  it('matches exact, then prefix, then substring', () => {
    const g = buildGazetteer(countries, places);
    expect(lookupPlace(g, 'kenya')?.name).toBe('Kenya');
    expect(lookupPlace(g, 'ken')?.name).toBe('Kenya');
    expect(lookupPlace(g, 'oky')?.name).toBe('Tokyo');
  });

  it('returns nothing rather than a wrong guess', () => {
    const g = buildGazetteer(countries, places);
    expect(lookupPlace(g, 'atlantis')).toBeNull();
    expect(lookupPlace(g, '')).toBeNull();
  });

  it('ignores features with no name or no usable geometry', () => {
    const g = buildGazetteer(
      { features: [{ properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }] },
      { features: [{ properties: { NAME: 'Nowhere' }, geometry: null }] },
    );
    expect(g).toEqual([]);
  });

  it('copes with a missing or empty source', () => {
    expect(buildGazetteer(null, null)).toEqual([]);
    expect(buildGazetteer({}, {})).toEqual([]);
  });
});
