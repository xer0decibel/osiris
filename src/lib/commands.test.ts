import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseCommand, buildGazetteer, lookupPlace, layerLabel, createGazetteerLoader,
  COMMAND_LAYER_KEYS, COMMAND_LAYER_LABELS, OFFLINE_GAZETTEER_FILES,
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

  /** Same guard for the wording: the search bar echoes the panel's label back,
   *  and the two must not drift apart. */
  it('names each layer exactly as LayerPanel does', () => {
    const panel = fs.readFileSync(
      path.join(process.cwd(), 'src/components/LayerPanel.tsx'), 'utf8',
    );
    const real = new Map(
      [...panel.matchAll(/\{ key: '([a-z0-9_]+)', label: '([^']+)'/g)].map(m => [m[1], m[2]]),
    );
    expect(real.size).toBeGreaterThan(20);
    const drift = COMMAND_LAYER_KEYS
      .filter(k => real.get(k) !== COMMAND_LAYER_LABELS[k])
      .map(k => `${k}: parser says "${COMMAND_LAYER_LABELS[k]}", panel says "${real.get(k)}"`);
    expect(drift).toEqual([]);
    expect(layerLabel('fires')).toBe('Active Fires');
    expect(layerLabel('no_such_layer')).toBe('no_such_layer');
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
    expect(kenya!.lng).toBeCloseTo(38, 6);
    expect(kenya!.lat).toBeCloseTo(0, 6);
    expect(tokyo!.lat).toBeCloseTo(35.68, 2);
  });

  it('centres a polygon on its extent, not on wherever the vertices crowd', () => {
    // The square above, with its east edge drawn as fifty vertices — the shape
    // of every real coastline in Natural Earth. A vertex average lands on the
    // beach; the extent centre stays at 38.
    const east = Array.from({ length: 50 }, (_, i) => [42, -4 + (8 * i) / 49]);
    const ring = [[34, -4], ...east, [34, 4], [34, -4]];
    const g = buildGazetteer({ features: [{ properties: { NAME: 'Coastal' }, geometry: { type: 'Polygon', coordinates: [ring] } }] }, null);
    expect(g[0].lng).toBeCloseTo(38, 6);
  });

  it('centres a MultiPolygon on its largest piece, not its first', () => {
    // Chile's first ring is Easter Island. Russia's is a Kuril island. A country
    // has to be placed on its mainland regardless of Natural Earth's ordering.
    const island = [[[-109.5, -27.2], [-109.2, -27.2], [-109.2, -27.0], [-109.5, -27.0], [-109.5, -27.2]]];
    const mainland = [[[-75, -55], [-67, -55], [-67, -17], [-75, -17], [-75, -55]]];
    const g = buildGazetteer({
      features: [{ properties: { NAME: 'Chile' }, geometry: { type: 'MultiPolygon', coordinates: [island, mainland] } }],
    }, null);
    expect(g[0].lng).toBeCloseTo(-71, 6);
    expect(g[0].lat).toBeCloseTo(-36, 6);
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

describe('gazetteer loader', () => {
  const files: Record<string, unknown> = {
    [OFFLINE_GAZETTEER_FILES.countries]: {
      features: [{ properties: { NAME: 'Kenya' }, geometry: { type: 'Polygon', coordinates: [[[34, -4], [42, -4], [42, 4], [34, 4], [34, -4]]] } }],
    },
    [OFFLINE_GAZETTEER_FILES.places]: {
      features: [{ properties: { NAME: 'Nairobi' }, geometry: { type: 'Point', coordinates: [36.8, -1.28] } }],
    },
    [OFFLINE_GAZETTEER_FILES.regions]: { features: [] },
  };
  const fakeFetch = (log: string[]) => async (url: string) => {
    log.push(url);
    const body = files[url];
    return { ok: body !== undefined, json: async () => body };
  };

  it('fetches the three basemap files once and keeps the result', async () => {
    const log: string[] = [];
    const load = createGazetteerLoader(fakeFetch(log));
    const a = await load();
    const b = await load();
    expect(a.map(e => e.name).sort()).toEqual(['Kenya', 'Nairobi']);
    expect(b).toBe(a);
    expect(log.length).toBe(3);
  });

  it('gives an empty gazetteer, not an error, when the files are not there', async () => {
    // A fresh checkout before tools/fetch-offline-basemap.mjs has been run.
    const load = createGazetteerLoader(async () => ({ ok: false, json: async () => null }));
    await expect(load()).resolves.toEqual([]);
    const broken = createGazetteerLoader(async () => { throw new Error('offline'); });
    await expect(broken()).resolves.toEqual([]);
  });

  it('tries again after an empty result rather than caching the failure', async () => {
    let ready = false;
    const load = createGazetteerLoader(async (url: string) => ({
      ok: ready && files[url] !== undefined,
      json: async () => files[url],
    }));
    expect(await load()).toEqual([]);
    ready = true;
    expect((await load()).length).toBe(2);
  });
});
