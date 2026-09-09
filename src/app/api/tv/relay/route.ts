import { NextResponse } from 'next/server';
import https from 'https';
import type { IncomingMessage } from 'http';
import { Readable } from 'stream';
import { OSIRIS_UA } from '@/lib/httpJson';
import { isRelayHost, isPlaylist, relayEnabled, rewritePlaylist } from '@/lib/tv-relay';

/**
 * OSIRIS — the TV relay. See lib/tv-relay for why it exists and why it is off
 * by default.
 *
 * GET /api/tv/relay?u=<https url on an allowed host>
 *
 * Playlists are fetched whole, rewritten so every URI comes back here, and
 * returned as a playlist. Segments are streamed through untouched. Redirects
 * are followed here rather than by the browser — the redirector's 302 is the
 * thing the browser could not get past — and every hop has to pass the same
 * host check as the first.
 *
 * Node's https client rather than fetch, for the reasons in lib/httpJson: the
 * bundled fetch stalls on some upstreams, and this one identifies itself.
 */

export const dynamic = 'force-dynamic';

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20000;

interface Upstream { res: IncomingMessage; url: string }

function open(url: string, hops = 0): Promise<Upstream> {
  return new Promise((resolve, reject) => {
    if (!isRelayHost(url)) { reject(new Error('host not allowed')); return; }
    const req = https.get(url, { headers: { 'User-Agent': OSIRIS_UA, Accept: '*/*' }, timeout: TIMEOUT_MS }, res => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        if (hops >= MAX_REDIRECTS) { reject(new Error('too many redirects')); return; }
        let next: string;
        try { next = new URL(location, url).toString(); } catch { reject(new Error('bad redirect')); return; }
        open(next, hops + 1).then(resolve, reject);
        return;
      }
      if (status >= 400) { res.resume(); reject(new Error(`HTTP ${status}`)); return; }
      resolve({ res, url });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function readAll(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

export async function GET(req: Request) {
  if (!relayEnabled()) {
    return NextResponse.json({ error: 'The TV relay is off on this deployment. Set OSIRIS_TV_RELAY=1 to enable it.' }, { status: 404 });
  }
  const target = new URL(req.url).searchParams.get('u') || '';
  if (!isRelayHost(target)) {
    return NextResponse.json({ error: 'Not a relayable URL' }, { status: 400 });
  }

  let up: Upstream;
  try {
    up = await open(target);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'upstream failed' }, { status: 502 });
  }

  const contentType = up.res.headers['content-type'];
  if (isPlaylist(contentType, up.url)) {
    const text = await readAll(up.res);
    return new Response(rewritePlaylist(text, up.url), {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' },
    });
  }

  return new Response(Readable.toWeb(up.res) as ReadableStream, {
    headers: { 'Content-Type': contentType || 'application/octet-stream', 'Cache-Control': 'no-store' },
  });
}
