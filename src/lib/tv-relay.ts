/**
 * OSIRIS — relaying the TV streams a browser cannot fetch for itself.
 *
 * Pluto TV's whole catalogue reaches the index through one redirector, and
 * neither it nor Pluto answers a browser on any origin but pluto.tv with the
 * CORS headers hls.js needs. Measured, not assumed: the redirect carries no
 * Access-Control-Allow-Origin at all, and the stream behind it allows
 * `http://pluto.tv` only. From a shell the stream is perfectly healthy, which
 * is why the community index lists it as working.
 *
 * The relay fetches those playlists and segments server-side and hands them to
 * the browser from this origin, rewriting every URI in a playlist to come back
 * through the relay. That makes the server a video relay for its own viewers.
 * Where the server and the viewer are the same machine — a personal install,
 * or the drive booted on someone's own laptop — that costs nothing anyone else
 * pays for. On a hosted instance it makes the host carry every viewer's
 * stream, so it is off unless a deployment sets OSIRIS_TV_RELAY=1, and off it
 * means the entries that would need it are not offered at all rather than
 * offered dead.
 *
 * The pure parts live here so they can be tested without a network.
 */

/** Hosts the relay will fetch from: the redirector, Pluto's stitcher, and the
 *  CDN its segments come from — measured by walking one channel's chain.
 *  Anything else is refused, so the endpoint cannot be turned into a
 *  general-purpose proxy. Subdomains are included. */
export const RELAY_HOSTS = ['jmp2.uk', 'pluto.tv', 'plutotv.net'] as const;

export const RELAY_PATH = '/api/tv/relay';

export function relayEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.OSIRIS_TV_RELAY === '1';
}

/** True for an https URL on one of the relay hosts or their subdomains. */
export function isRelayHost(url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return RELAY_HOSTS.some(h => host === h || host.endsWith('.' + h));
}

/** The same-origin URL the browser fetches instead of `target`. */
export function relayUrl(target: string): string {
  return `${RELAY_PATH}?u=${encodeURIComponent(target)}`;
}

/** Playlist tags whose URI attribute names something the player will fetch. */
const URI_ATTRIBUTE_TAGS = ['#EXT-X-MEDIA', '#EXT-X-KEY', '#EXT-X-MAP', '#EXT-X-I-FRAME-STREAM-INF', '#EXT-X-SESSION-KEY'];

/**
 * Rewrites every URI in an HLS playlist to go back through the relay. A URI
 * is either a whole non-comment line — a variant playlist or a media segment —
 * or the URI="..." attribute of one of the tags above. Relative URIs are
 * resolved against the playlist's own final URL, which is the one after any
 * redirects, or Pluto's relative segment paths would be resolved against the
 * redirector. Line endings are kept as they came.
 */
export function rewritePlaylist(text: string, baseUrl: string, toRelay: (absolute: string) => string = relayUrl): string {
  const resolve = (uri: string) => {
    try { return toRelay(new URL(uri, baseUrl).toString()); } catch { return uri; }
  };
  return text.split(/(\r?\n)/).map(part => {
    if (part === '\n' || part === '\r\n' || part === '') return part;
    const line = part;
    if (line.startsWith('#')) {
      if (!URI_ATTRIBUTE_TAGS.some(tag => line.startsWith(tag))) return line;
      return line.replace(/URI="([^"]*)"/g, (_m, uri: string) => `URI="${resolve(uri)}"`);
    }
    const trimmed = line.trim();
    if (!trimmed) return line;
    return resolve(trimmed);
  }).join('');
}

/** Whether a response is a playlist to rewrite rather than a segment to pass through. */
export function isPlaylist(contentType: string | undefined, url: string): boolean {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('mpegurl') || ct.includes('application/x-mpegurl')) return true;
  try { return new URL(url).pathname.toLowerCase().endsWith('.m3u8'); } catch { return false; }
}
