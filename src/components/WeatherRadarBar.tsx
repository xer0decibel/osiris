'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Radar } from 'lucide-react';

export interface RadarFrame {
  time: number;
  url: string;
  forecast: boolean;
}

interface WeatherRadarBarProps {
  frames: RadarFrame[];
  index: number;
  onIndexChange: (i: number) => void;
}

/** Milliseconds each frame is held during playback. */
const FRAME_MS = 550;

/** Frames are ten minutes apart, so the clock alone tells you where you are. */
function label(t: number): string {
  return new Date(t * 1000).toISOString().slice(11, 16) + 'Z';
}

/**
 * OSIRIS — precipitation radar timeline.
 *
 * Thirteen frames covering the last two hours. Without a scrubber the layer is
 * a still image of whenever the page happened to load, which is the least
 * useful thing radar can be: the direction a front is moving is the whole
 * point, and that only exists across frames.
 */
export default function WeatherRadarBar({ frames, index, onIndexChange }: WeatherRadarBarProps) {
  const [playing, setPlaying] = useState(true);
  const count = frames.length;

  /* Re-armed each frame rather than run as one interval. The timeout is keyed
     on the current index, so a drag of the scrubber cancels the pending step
     and resumes from wherever it was dropped instead of fighting it. */
  useEffect(() => {
    if (!playing || count < 2) return;
    const t = setTimeout(() => onIndexChange((index + 1) % count), FRAME_MS);
    return () => clearTimeout(t);
  }, [playing, index, count, onIndexChange]);

  if (count === 0) return null;

  const frame = frames[Math.min(index, count - 1)];
  const isLatest = index === count - 1;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.25 }}
        className="fixed z-[400] bottom-[58px] left-1/2 -translate-x-1/2 w-[min(92vw,420px)]"
      >
        <div
          className="flex items-center gap-3 px-3 py-2 bg-black/85 backdrop-blur-xl border border-[var(--border-primary)]"
          style={{ boxShadow: '0 12px 32px rgba(0,0,0,0.8)' }}
        >
          <button
            onClick={() => setPlaying(p => !p)}
            className="flex items-center justify-center w-7 h-7 rounded-sm border flex-shrink-0 transition-colors hover:bg-[var(--gold-primary)]/10"
            style={{ borderColor: 'var(--gold-primary)' }}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing
              ? <Pause className="w-3.5 h-3.5" style={{ color: 'var(--gold-primary)' }} />
              : <Play className="w-3.5 h-3.5 ml-0.5" style={{ color: 'var(--gold-primary)' }} />}
          </button>

          <Radar className="w-3.5 h-3.5 flex-shrink-0 text-[var(--text-muted)]" />

          <input
            type="range"
            min={0}
            max={count - 1}
            step={1}
            value={Math.min(index, count - 1)}
            onChange={e => { setPlaying(false); onIndexChange(parseInt(e.target.value, 10)); }}
            className="flex-1 min-w-0 accent-[var(--gold-primary)] cursor-pointer"
            aria-label="Radar frame"
          />

          <span
            className="text-[9px] font-mono tracking-widest tabular-nums flex-shrink-0 w-[74px] text-right uppercase"
            style={{ color: frame.forecast ? 'var(--gold-primary)' : isLatest ? 'var(--alert-green)' : 'var(--text-muted)' }}
          >
            {frame.forecast ? '+' : ''}{label(frame.time)}
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
