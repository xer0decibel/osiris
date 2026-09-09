import { describe, it, expect } from 'vitest';
import { isRelayHost, relayEnabled, relayUrl, rewritePlaylist, isPlaylist, RELAY_PATH } from './tv-relay';

describe('relay host allow-list', () => {
  it('accepts the redirector and Pluto, including subdomains', () => {
    expect(isRelayHost('https://jmp2.uk/plu-abc.m3u8')).toBe(true);
    expect(isRelayHost('https://stitcher-ipv4.pluto.tv/v2/stitch/hls/master.m3u8?x=1')).toBe(true);
    expect(isRelayHost('https://pluto.tv/')).toBe(true);
    // Segments come from a CDN on a different registered domain.
    expect(isRelayHost('https://mcdn-01.plutotv.net/548_Pluto_TV_OandO/clip/x.ts')).toBe(true);
  });

  it('refuses everything else, so the endpoint is not a general proxy', () => {
    expect(isRelayHost('https://example.com/pluto.tv/x.m3u8')).toBe(false);
    expect(isRelayHost('https://evil-pluto.tv/x.m3u8')).toBe(false);
    expect(isRelayHost('https://pluto.tv.example.net/x')).toBe(false);
    expect(isRelayHost('http://jmp2.uk/plain-http')).toBe(false);
    expect(isRelayHost('not a url')).toBe(false);
  });
});

describe('relay switch', () => {
  it('is off unless the deployment sets it to exactly 1', () => {
    expect(relayEnabled({})).toBe(false);
    expect(relayEnabled({ OSIRIS_TV_RELAY: 'true' })).toBe(false);
    expect(relayEnabled({ OSIRIS_TV_RELAY: '1' })).toBe(true);
  });
});

describe('playlist rewriting', () => {
  const base = 'https://stitcher-ipv4.pluto.tv/v2/stitch/embed/hls/channel/abc/master.m3u8?sid=1&authToken=t';

  it('sends variant playlists, segments and tag URIs back through the relay', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-VERSION:5',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="subtitle/en/playlist.m3u8?sid=1"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720',
      '1200/playlist.m3u8?sid=1',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000',
      'https://siloh.pluto.tv/abc/800/playlist.m3u8',
      '',
    ].join('\n');
    const out = rewritePlaylist(master, base);
    const lines = out.split('\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[2]).toBe(`#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="${relayUrl('https://stitcher-ipv4.pluto.tv/v2/stitch/embed/hls/channel/abc/subtitle/en/playlist.m3u8?sid=1')}"`);
    expect(lines[3]).toBe('#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720');
    expect(lines[4]).toBe(relayUrl('https://stitcher-ipv4.pluto.tv/v2/stitch/embed/hls/channel/abc/1200/playlist.m3u8?sid=1'));
    expect(lines[6]).toBe(relayUrl('https://siloh.pluto.tv/abc/800/playlist.m3u8'));
    expect(lines[7]).toBe('');
  });

  it('resolves relative segments against the final URL, not the redirector', () => {
    const media = '#EXTINF:6.0,\nseg-001.ts\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6.0,\nseg-002.ts\n';
    const out = rewritePlaylist(media, 'https://siloh.pluto.tv/abc/1200/playlist.m3u8?sid=1');
    expect(out).toContain(relayUrl('https://siloh.pluto.tv/abc/1200/seg-001.ts'));
    expect(out).toContain(`URI="${relayUrl('https://siloh.pluto.tv/abc/1200/key.bin')}"`);
    expect(out).not.toContain('jmp2.uk');
  });

  it('keeps CRLF endings and leaves comments alone', () => {
    const text = '#EXTM3U\r\n#EXT-X-TARGETDURATION:6\r\nseg.ts\r\n';
    const out = rewritePlaylist(text, 'https://siloh.pluto.tv/a/b.m3u8');
    expect(out.split('\r\n').length).toBe(4);
    expect(out.startsWith('#EXTM3U\r\n#EXT-X-TARGETDURATION:6\r\n')).toBe(true);
  });

  it('routes through the relay path with the target encoded', () => {
    const u = relayUrl('https://jmp2.uk/plu-abc.m3u8');
    expect(u.startsWith(RELAY_PATH + '?u=')).toBe(true);
    expect(decodeURIComponent(u.slice(u.indexOf('=') + 1))).toBe('https://jmp2.uk/plu-abc.m3u8');
  });
});

describe('playlist detection', () => {
  it('goes by content type first, then by the .m3u8 extension', () => {
    expect(isPlaylist('application/x-mpegURL', 'https://x/y')).toBe(true);
    expect(isPlaylist('application/vnd.apple.mpegurl', 'https://x/y')).toBe(true);
    expect(isPlaylist('text/html', 'https://x/master.m3u8?sid=1')).toBe(true);
    expect(isPlaylist('video/mp2t', 'https://x/seg.ts')).toBe(false);
  });
});
