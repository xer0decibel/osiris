'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import DraggablePanel from './DraggablePanel';
import { X, Radio, Play, Pause, MapPin, Volume2, VolumeX, ExternalLink, AlertTriangle } from 'lucide-react';

/** What the map click hands over. A subset of the API's station record: the
 *  fields that survive the trip through GeoJSON feature properties. */
export interface RadioStationView {
  id?: string;
  name: string;
  url: string;
  homepage?: string;
  country?: string;
  state?: string;
  codec?: string;
  bitrate?: number;
  tags?: string[];
  lat: number;
  lng: number;
}

interface RadioPlayerProps {
  station: RadioStationView | null;
  onClose: () => void;
  onLocate?: (lat: number, lng: number) => void;
}

type Status = 'idle' | 'buffering' | 'playing' | 'paused' | 'error';

/**
 * OSIRIS — Broadcast Radio tuner.
 *
 * Icecast and Shoutcast streams are endless, so there is no duration, no seek
 * and no progress: the only states worth showing are whether audio is arriving
 * and how loud it is. The transport is a plain <audio> element — every codec in
 * the index that matters (MP3, AAC, AAC+, OGG) plays natively, so hls.js earns
 * nothing here.
 */
export default function RadioPlayer({ station, onClose, onLocate }: RadioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);

  /* Keyed on the url rather than the id: swapping the src is what actually
     retunes, and the same broadcaster can appear twice in the index. */
  const streamUrl: string | null = station?.url ?? null;

  // Retune whenever the selected stream changes.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !streamUrl) return;

    setStatus('buffering');
    el.src = streamUrl;
    el.load();

    /* The click on the map dot is itself the user gesture, so autoplay is
       normally allowed. If a browser refuses anyway, fall back to paused with
       the play control showing rather than reporting a stream failure. */
    el.play().catch(() => setStatus('paused'));

    return () => {
      el.pause();
      /* Detaching the source matters more than pausing: a paused <audio> still
         holding a live Icecast src keeps the socket open and the station keeps
         counting a listener. Loading an empty src is what actually hangs up. */
      el.removeAttribute('src');
      el.load();
    };
  }, [streamUrl]);

  /* Applied imperatively. streamUrl is a dependency because the <audio> element
     does not exist until a station is picked: on the render that creates it,
     volume and muted are unchanged, so a deps list without streamUrl never fires
     and the slider reads 0.8 while the stream actually plays at 1. */
  useEffect(() => {
    const el = audioRef.current;
    if (el) { el.volume = volume; el.muted = muted; }
  }, [volume, muted, streamUrl]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !streamUrl) return;
    if (el.paused) {
      setStatus('buffering');
      /* A stream paused for any length of time is stale — reloading rejoins the
         live edge instead of resuming into a dead buffer. */
      el.src = streamUrl;
      el.load();
      el.play().catch(() => setStatus('error'));
    } else {
      el.pause();
    }
  }, [streamUrl]);

  if (!station) return null;

  const place = [station.state, station.country].filter(Boolean).join(', ');
  const quality = [station.codec, station.bitrate ? station.bitrate + 'kbps' : null]
    .filter(Boolean).join(' · ');
  const live = status === 'playing';

  return (
    <AnimatePresence>
      <DraggablePanel className="fixed z-[499] bottom-[70px] left-2 right-2 md:bottom-6 md:left-6 md:right-auto md:w-[360px]">
        <div
          className="relative overflow-hidden flex flex-col bg-black/85 backdrop-blur-xl border border-[var(--border-primary)]"
          style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.9), inset 0 0 30px rgba(0,0,0,0.8)' }}
        >
          {/* Tactical grid wash, matching the camera viewer */}
          <div className="absolute inset-0 pointer-events-none opacity-20" style={{
            backgroundImage: 'linear-gradient(var(--border-secondary) 1px, transparent 1px), linear-gradient(90deg, var(--border-secondary) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }} />

          {/* Meta bar */}
          <div data-drag-handle className="flex items-center justify-between px-3 py-1 border-b border-white/5 text-[9px] font-mono tracking-[0.2em] text-[var(--text-muted)] bg-[var(--hover-accent)] relative z-10">
            <span className="text-[var(--gold-primary)] font-bold">BROADCAST</span>
            <span className="truncate ml-3">{station.lat?.toFixed(3)}, {station.lng?.toFixed(3)}</span>
          </div>

          {/* Title */}
          <div data-drag-handle className="flex items-start justify-between px-3 md:px-4 py-2.5 relative z-10 gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="relative flex items-center justify-center w-6 h-6 border border-[var(--gold-primary)] bg-[var(--gold-primary)]/10 rounded-sm flex-shrink-0">
                <Radio className="w-3.5 h-3.5 text-[var(--gold-primary)]" />
                <div className="absolute top-0 left-0 w-1 h-1 border-t border-l border-[var(--gold-primary)]" />
                <div className="absolute bottom-0 right-0 w-1 h-1 border-b border-r border-[var(--gold-primary)]" />
              </div>
              <div className="min-w-0 flex-1">
                <h3
                  className="text-[11px] md:text-[12px] font-mono font-bold tracking-widest truncate text-white uppercase"
                  style={{ textShadow: '0 0 10px rgba(255,255,255,0.3)' }}
                  title={station.name}
                >
                  {station.name}
                </h3>
                <p className="text-[9px] font-mono text-[var(--gold-primary)] uppercase tracking-wider opacity-80 truncate">
                  {place || 'LOCATION UNKNOWN'}{quality ? ' • ' + quality : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {onLocate && (
                <button
                  onClick={() => onLocate(station.lat, station.lng)}
                  className="p-1.5 hover:bg-white/10 rounded transition-colors"
                  title="Centre on transmitter"
                >
                  <MapPin className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </button>
              )}
              {station.homepage && (
                <a
                  href={station.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 hover:bg-white/10 rounded transition-colors"
                  title="Station homepage"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </a>
              )}
              <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded transition-colors" title="Close">
                <X className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              </button>
            </div>
          </div>

          {/* Transport */}
          <div className="flex items-center gap-3 px-3 md:px-4 py-3 border-t border-[var(--border-primary)] bg-black/40 relative z-10">
            <button
              onClick={toggle}
              disabled={status === 'error'}
              className="flex items-center justify-center w-9 h-9 rounded-sm border transition-all flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--gold-primary)]/10"
              style={{ borderColor: 'var(--gold-primary)' }}
              title={live || status === 'buffering' ? 'Stop' : 'Play'}
            >
              {status === 'buffering' ? (
                <div
                  className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: 'var(--gold-dim)', borderTopColor: 'transparent' }}
                />
              ) : live ? (
                <Pause className="w-4 h-4" style={{ color: 'var(--gold-primary)' }} />
              ) : (
                <Play className="w-4 h-4 ml-0.5" style={{ color: 'var(--gold-primary)' }} />
              )}
            </button>

            {/* Status / level meter */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {status === 'error' ? (
                <span className="flex items-center gap-1.5 text-[9px] font-mono tracking-widest text-red-400 uppercase">
                  <AlertTriangle className="w-3 h-3" /> Stream offline
                </span>
              ) : (
                <>
                  {/* Bars animate only while audio is actually arriving, so the
                      meter reads as signal rather than decoration. */}
                  <div className="flex items-end gap-[2px] h-4" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map(i => (
                      <span
                        key={i}
                        className={live ? 'radio-bar' : undefined}
                        style={{
                          width: '3px',
                          borderRadius: '1px',
                          background: live ? 'var(--gold-primary)' : 'var(--border-primary)',
                          height: live ? '4px' : '4px',
                          animationDelay: live ? i * 120 + 'ms' : undefined,
                          boxShadow: live ? '0 0 6px var(--gold-primary)' : undefined,
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className="text-[9px] font-mono tracking-widest uppercase truncate"
                    style={{ color: live ? 'var(--alert-green)' : 'var(--text-muted)' }}
                  >
                    {status === 'buffering' ? 'Acquiring signal' : live ? 'On air' : 'Standby'}
                  </span>
                </>
              )}
            </div>

            {/* Volume */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setMuted(m => !m)}
                className="p-1 hover:bg-white/10 rounded transition-colors"
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted || volume === 0
                  ? <VolumeX className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  : <Volume2 className="w-3.5 h-3.5 text-[var(--gold-primary)]" />}
              </button>
              <input
                type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
                onChange={e => { setVolume(parseFloat(e.target.value)); setMuted(false); }}
                className="w-16 accent-[var(--gold-primary)] cursor-pointer"
                aria-label="Volume"
              />
            </div>
          </div>

          {/* Tags */}
          {!!station.tags?.length && (
            <div className="flex flex-wrap gap-1 px-3 md:px-4 pb-2.5 pt-0.5 relative z-10">
              {station.tags.slice(0, 5).map(t => (
                <span
                  key={t}
                  className="px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider rounded-sm text-[var(--text-muted)] border border-[var(--border-secondary)]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <audio
            ref={audioRef}
            preload="none"
            onPlaying={() => setStatus('playing')}
            onWaiting={() => setStatus('buffering')}
            onPause={() => setStatus(s => (s === 'error' ? s : 'paused'))}
            onError={() => setStatus('error')}
          />
        </div>
      </DraggablePanel>
    </AnimatePresence>
  );
}
