import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

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
