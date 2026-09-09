import { describe, it, expect } from 'vitest';

/**
 * Live, opt-in: RUN_LIVE_TESTS=1. Walks one Pluto channel through the relay
 * the way hls.js would — master playlist, then a variant it names, then a
 * segment that names — and checks each answer is the kind of thing the player
 * expects. Off by default because it reaches Pluto over the network.
 */
const live = process.env.RUN_LIVE_TESTS === '1' ? describe : describe.skip;

const PLUTO = 'https://jmp2.uk/plu-5f357e91b18f0b00073583d2.m3u8'; // Comedy Central

async function relay(u: string) {
  process.env.OSIRIS_TV_RELAY = '1';
  const { GET } = await import('./route');
  return GET(new Request(`http://localhost/api/tv/relay?u=${encodeURIComponent(u)}`));
}

function firstUri(playlist: string): string {
  const line = playlist.split(/\r?\n/).find(l => l && !l.startsWith('#'));
  if (!line) throw new Error('playlist names no URI');
  const u = new URL(line, 'http://localhost').searchParams.get('u');
  if (!u) throw new Error('URI was not rewritten through the relay: ' + line);
  return u;
}

live('tv relay, end to end', () => {
  it('refuses a host outside the allow-list', async () => {
    const res = await relay('https://example.com/x.m3u8');
    expect(res.status).toBe(400);
  });

  it('serves a rewritten master, then a variant, then a segment', async () => {
    const master = await relay(PLUTO);
    expect(master.status).toBe(200);
    expect(master.headers.get('content-type')).toContain('mpegurl');
    const masterText = await master.text();
    expect(masterText.startsWith('#EXTM3U')).toBe(true);
    expect(masterText).not.toContain('https://stitcher'); // every absolute URI went through the relay

    const variantUrl = firstUri(masterText);
    expect(variantUrl).toMatch(/pluto\.tv/);
    const variant = await relay(variantUrl);
    expect(variant.status).toBe(200);
    const variantText = await variant.text();
    expect(variantText).toContain('#EXTINF');

    const segmentUrl = firstUri(variantText);
    const segment = await relay(segmentUrl);
    expect(segment.status).toBe(200);
    const bytes = new Uint8Array(await segment.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(10_000);
  }, 60_000);
});
