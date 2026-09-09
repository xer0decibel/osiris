import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './middleware';
import { version as maplibreVersion } from 'maplibre-gl/package.json';

/**
 * The middleware reads its configuration at module load, so each case loads a
 * fresh copy under the environment it wants.
 */
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import('./middleware');
}

describe('analytics middleware', () => {
  const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response('ok'));
  const request = () => new NextRequest('http://localhost:3000/', {
    headers: { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'test' },
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.UMAMI_WEBSITE_ID;
    delete process.env.UMAMI_URL;
  });

  it('sends nothing at all when no Umami site is configured', async () => {
    // The default for a fork, an appliance, or anyone's own instance: no page
    // views, no visitor IPs, no requests to a host that is not there.
    const { middleware } = await load({ UMAMI_WEBSITE_ID: undefined, UMAMI_URL: undefined });
    const event = { waitUntil: vi.fn() };
    const res = middleware(request(), event as never);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(event.waitUntil).not.toHaveBeenCalled();
  });

  it('posts the page view and the visitor event to the configured site', async () => {
    const { middleware } = await load({ UMAMI_WEBSITE_ID: 'site-123', UMAMI_URL: 'http://umami.test' });
    const event = { waitUntil: vi.fn() };
    const res = middleware(request(), event as never);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const bodies = fetchSpy.mock.calls.map(([url, init]) => ({
      url,
      payload: JSON.parse(String(init?.body)).payload,
    }));
    expect(bodies.every(b => b.url === 'http://umami.test/api/send')).toBe(true);
    expect(bodies.every(b => b.payload.website === 'site-123')).toBe(true);
    expect(bodies[1].payload.data).toEqual({ IP: '203.0.113.9' });
    expect(event.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('never carries the original deployment\'s site ID as a fallback', async () => {
    const { middleware } = await load({ UMAMI_WEBSITE_ID: undefined });
    middleware(request(), { waitUntil: vi.fn() } as never);
    const sent = JSON.stringify(fetchSpy.mock.calls);
    expect(sent).not.toContain('cd8f216c');
  });
});

/* ── Upstream's half (PR #332): the map worker ships and analytics leave it alone ── */
const vendorDir = fileURLToPath(new URL('../public/vendor/maplibre/', import.meta.url));
const workerPath = `/vendor/maplibre/${maplibreVersion}/maplibre-gl-worker.mjs`;

/* PR #330 moved the MapLibre worker out of the bundle and onto a self-hosted
   public/ path. When that file is not retrievable the canvas and the
   main-thread entity layers still draw, but no vector tile can be parsed, so
   the basemap never arrives and startup times out into "The map couldn't
   finish loading" — the production failure that forced the revert to fac8d1b.
   Both halves of that path are asserted here: the file has to ship, and the
   analytics matcher has to leave it alone. */
describe('map runtime assets', () => {
  const matches = (path: string) => config.matcher.some(m => new RegExp(`^${m}$`).test(path));

  it('ships the worker the bundle actually asks for', () => {
    expect(existsSync(`${vendorDir}${maplibreVersion}/maplibre-gl-worker.mjs`)).toBe(true);
    // The worker is a module that imports this sibling by relative path.
    expect(existsSync(`${vendorDir}${maplibreVersion}/maplibre-gl-shared.mjs`)).toBe(true);
  });

  it('keeps exactly one vendored version, so local cannot pass while a clean deploy fails', () => {
    expect(readdirSync(vendorDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name)).toEqual([maplibreVersion]);
  });

  it('does not put analytics in front of the map worker, its sibling, or the basemap style', () => {
    expect(matches(workerPath)).toBe(false);
    expect(matches(`/vendor/maplibre/${maplibreVersion}/maplibre-gl-shared.mjs`)).toBe(false);
    expect(matches('/dark-matter-style.json')).toBe(false);
  });

  it('still counts page views', () => {
    expect(matches('/')).toBe(true);
    expect(matches('/merch')).toBe(true);
    expect(matches('/api/cctv')).toBe(false);
  });
});
