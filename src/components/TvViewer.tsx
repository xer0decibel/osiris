'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import DraggablePanel from './DraggablePanel';
import { X, Tv, MapPin, Search, AlertTriangle, ExternalLink } from 'lucide-react';
import Hls from 'hls.js';

export interface TvCountrySel {
  code: string;
  name: string;
  count: number;
  lat: number;
  lng: number;
}

interface TvChannel {
  id: string;
  name: string;
  network: string;
  country: string;
  categories: string[];
  url: string;
  quality: string;
  website: string;
}

interface TvViewerProps {
  country: TvCountrySel | null;
  onClose: () => void;
  onLocate?: (lat: number, lng: number) => void;
}

type PlayState = 'idle' | 'loading' | 'playing' | 'error';

/**
 * OSIRIS — Live TV.
 *
 * The map marker is a country, not a transmitter, because that is all the
 * upstream index knows — so picking a channel happens here rather than on the
 * map. Playback is hls.js, which is what these .m3u8 streams need and what the
 * camera viewer already carries.
 *
 * Expect failures. hls.js fetches segments over XHR, so a stream that omits
 * CORS headers cannot play here no matter how healthy it is, and community
 * IPTV entries go dark without warning. The list is built to make moving to
 * the next channel cheap rather than to pretend every entry works.
 */
export default function TvViewer({ country, onClose, onLocate }: TvViewerProps) {
  if (!country) return null;
  /* TvPanel is keyed by country so switching markers remounts it, rather than
     unwinding the previous country's channels, selection and filter by hand.
     It also keeps the fetch effect free of the synchronous setState that
     resetting needed.

     DraggablePanel sits *outside* that key on purpose: it holds where the
     operator put the window, and remounting it would throw the window back to
     its default corner every time they picked a different country. */
  return (
    <AnimatePresence>
      <DraggablePanel className="fixed z-[498] top-14 left-2 right-2 md:top-20 md:right-6 md:left-auto md:w-[420px]">
        <TvPanel key={country.code} country={country} onClose={onClose} onLocate={onLocate} />
      </DraggablePanel>
    </AnimatePresence>
  );
}

function TvPanel({ country, onClose, onLocate }: TvViewerProps & { country: TvCountrySel }) {
  const [channels, setChannels] = useState<TvChannel[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState(false);
  const [selected, setSelected] = useState<TvChannel | null>(null);
  const [play, setPlay] = useState<PlayState>('idle');
  const [query, setQuery] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const code = country.code;

  // Channel list for this country. Mount-scoped, so nothing needs clearing.
  useEffect(() => {
    let cancelled = false;

    fetch(`/api/tv?country=${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { channels?: TvChannel[] }) => {
        if (cancelled) return;
        setChannels(Array.isArray(d.channels) ? d.channels : []);
      })
      .catch(() => { if (!cancelled) setListError(true); })
      .finally(() => { if (!cancelled) setLoadingList(false); });

    return () => { cancelled = true; };
  }, [code]);

  // Attach the selected stream. `play` is moved to 'loading' by the click that
  // sets the selection, so this effect writes no state synchronously.
  useEffect(() => {
    const video = videoRef.current;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (!selected || !video) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false });
      hlsRef.current = hls;
      hls.loadSource(selected.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) setPlay('error'); });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari plays HLS natively, and without the CORS requirement hls.js
      // imposes — so some streams work there and nowhere else.
      video.src = selected.url;
      video.play().catch(() => {});
    } else {
      setPlay('error');
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      video.removeAttribute('src');
      video.load();
    };
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.network.toLowerCase().includes(q) ||
      c.categories.some(t => t.toLowerCase().includes(q)));
  }, [channels, query]);

  const close = useCallback(() => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    onClose();
  }, [onClose]);

  const pick = useCallback((c: TvChannel) => {
    setSelected(c);
    setPlay('loading');
  }, []);

  return (
    <div
      className="relative overflow-hidden flex flex-col bg-black/85 backdrop-blur-xl border border-[var(--border-primary)]"
      style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.9), inset 0 0 30px rgba(0,0,0,0.8)' }}
    >
      {/* Meta bar */}
      <div data-drag-handle className="flex items-center justify-between px-3 py-1 border-b border-white/5 text-[9px] font-mono tracking-[0.2em] text-[var(--text-muted)] bg-[var(--hover-accent)] relative z-10">
        <span className="text-[var(--gold-primary)] font-bold">BROADCAST TV</span>
        <span>{country.code} · {country.count} CH</span>
      </div>

      {/* Title */}
      <div data-drag-handle className="flex items-center justify-between px-3 md:px-4 py-2.5 relative z-10 gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="relative flex items-center justify-center w-6 h-6 border border-[var(--gold-primary)] bg-[var(--gold-primary)]/10 rounded-sm flex-shrink-0">
            <Tv className="w-3.5 h-3.5 text-[var(--gold-primary)]" />
            <div className="absolute top-0 left-0 w-1 h-1 border-t border-l border-[var(--gold-primary)]" />
            <div className="absolute bottom-0 right-0 w-1 h-1 border-b border-r border-[var(--gold-primary)]" />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="text-[11px] md:text-[12px] font-mono font-bold tracking-widest truncate text-white uppercase"
              style={{ textShadow: '0 0 10px rgba(255,255,255,0.3)' }}
            >
              {selected ? selected.name : country.name}
            </h3>
            <p className="text-[9px] font-mono text-[var(--gold-primary)] uppercase tracking-wider opacity-80 truncate">
              {selected
                ? [selected.network, selected.quality, selected.categories[0]].filter(Boolean).join(' • ') || country.name
                : 'SELECT A CHANNEL'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onLocate && (
            <button
              onClick={() => onLocate(country.lat, country.lng)}
              className="p-1.5 hover:bg-white/10 rounded transition-colors"
              title="Centre on country"
            >
              <MapPin className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            </button>
          )}
          {selected?.website && (
            <a
              href={selected.website}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 hover:bg-white/10 rounded transition-colors"
              title="Channel website"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            </a>
          )}
          <button onClick={close} className="p-1.5 hover:bg-white/10 rounded transition-colors" title="Close">
            <X className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          </button>
        </div>
      </div>

      {/* Video */}
      <div className="relative bg-[#020202] aspect-video border-y border-[var(--border-primary)]">
        {/* CRT wash, matching the camera viewer */}
        <div className="absolute inset-0 pointer-events-none z-20" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.02) 2px, rgba(255,255,255,0.02) 2px)',
          backgroundSize: '100% 4px',
        }} />
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          playsInline
          controls={play === 'playing'}
          onPlaying={() => setPlay('playing')}
          onWaiting={() => setPlay(p => (p === 'error' ? p : 'loading'))}
          onError={() => setPlay('error')}
        />
        {!selected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 z-30">
            <Tv className="w-6 h-6 mb-2 opacity-40 text-[var(--text-muted)]" />
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">No channel selected</p>
          </div>
        )}
        {selected && play === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 z-30">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mb-3"
                 style={{ borderColor: 'var(--gold-dim)', borderTopColor: 'transparent' }} />
            <p className="text-[10px] font-mono uppercase tracking-[0.25em]" style={{ color: 'var(--gold-primary)' }}>
              Acquiring feed
            </p>
          </div>
        )}
        {selected && play === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-30 px-5 text-center">
            <AlertTriangle className="w-5 h-5 mb-2 text-red-400" />
            <p className="text-[10px] font-mono uppercase tracking-widest text-red-400 mb-1">Feed unavailable</p>
            <p className="text-[9px] font-mono text-[var(--text-muted)] leading-relaxed">
              Off air, geo-fenced, or serving no CORS header — pick another below
            </p>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-3 md:px-4 py-2 border-b border-[var(--border-primary)] bg-black/40 relative z-10">
        <Search className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="FILTER CHANNELS"
          className="w-full bg-transparent outline-none text-[10px] font-mono tracking-wider text-white placeholder:text-[var(--text-muted)] uppercase"
        />
        <span className="text-[9px] font-mono text-[var(--text-muted)] flex-shrink-0">{filtered.length}</span>
      </div>

      {/* Channel list */}
      <div className="max-h-[190px] overflow-y-auto relative z-10">
        {loadingList && (
          <p className="px-4 py-4 text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Loading channels…
          </p>
        )}
        {listError && (
          <p className="px-4 py-4 text-[10px] font-mono uppercase tracking-widest text-red-400">
            Channel list unavailable
          </p>
        )}
        {!loadingList && !listError && filtered.length === 0 && (
          <p className="px-4 py-4 text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
            No matches
          </p>
        )}
        {filtered.map(c => {
          const active = selected?.id === c.id;
          return (
            <button
              key={c.id}
              onClick={() => pick(c)}
              className={`w-full text-left px-3 md:px-4 py-2 border-b border-white/5 transition-colors flex items-center gap-2 ${
                active ? 'bg-[var(--gold-primary)]/12' : 'hover:bg-white/5'
              }`}
            >
              <span className="w-1 h-1 rounded-full flex-shrink-0"
                    style={{ background: active ? 'var(--gold-primary)' : 'var(--border-primary)' }} />
              <span className="min-w-0 flex-1">
                <span className={`block text-[10px] font-mono tracking-wider truncate ${active ? 'text-[var(--gold-primary)]' : 'text-white'}`}>
                  {c.name}
                </span>
                {(c.network || c.categories.length > 0) && (
                  <span className="block text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)] truncate">
                    {[c.network, ...c.categories].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              {c.quality && (
                <span className="text-[8px] font-mono text-[var(--text-muted)] flex-shrink-0">{c.quality}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
