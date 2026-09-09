import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readHomeView, writeHomeView, isValidView, DEFAULT_VIEW } from './homeView';

const KEY = 'osiris:home-view';

/** Minimal localStorage stand-in; jsdom is not configured for these lib tests. */
function installStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>();
  const base: Storage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    clear: () => store.clear(),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
  vi.stubGlobal('window', { localStorage: { ...base, ...impl } });
  return store;
}

describe('homeView', () => {
  beforeEach(() => { installStorage(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('round-trips a resolved location', () => {
    writeHomeView({ lat: 47.6062, lng: -122.332, zoom: 8 });
    expect(readHomeView()).toEqual({ lat: 47.6062, lng: -122.332, zoom: 8 });
  });

  it('returns null when nothing has been stored', () => {
    expect(readHomeView()).toBeNull();
  });

  it('rejects coordinates outside the globe', () => {
    expect(isValidView({ lat: 91, lng: 0, zoom: 8 })).toBe(false);
    expect(isValidView({ lat: 0, lng: 181, zoom: 8 })).toBe(false);
    expect(isValidView({ lat: NaN, lng: 0, zoom: 8 })).toBe(false);
  });

  it("rejects a zoom the map could not honour", () => {
    expect(isValidView({ lat: 0, lng: 0, zoom: 0.5 })).toBe(false);
    expect(isValidView({ lat: 0, lng: 0, zoom: 25 })).toBe(false);
    expect(isValidView({ lat: 0, lng: 0, zoom: 8 })).toBe(true);
  });

  it('treats corrupt stored JSON as absent rather than throwing', () => {
    const store = installStorage();
    store.set(KEY, '{not json');
    expect(readHomeView()).toBeNull();
  });

  it('treats a structurally wrong stored value as absent', () => {
    const store = installStorage();
    store.set(KEY, JSON.stringify({ lat: 'north', lng: 0, zoom: 8 }));
    expect(readHomeView()).toBeNull();
  });

  it('never writes a value it would refuse to read back', () => {
    writeHomeView({ lat: 999, lng: 999, zoom: 99 });
    expect(readHomeView()).toBeNull();
  });

  it('survives storage that throws, as in a locked-down browser', () => {
    installStorage({
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(() => writeHomeView({ lat: 1, lng: 1, zoom: 5 })).not.toThrow();
    expect(readHomeView()).toBeNull();
  });

  it('falls back to the whole world, matching the reset shortcut', () => {
    expect(DEFAULT_VIEW).toEqual({ lat: 20, lng: 0, zoom: 2.5 });
    expect(isValidView(DEFAULT_VIEW)).toBe(true);
  });
});
