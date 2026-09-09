'use client';

import { Thermometer } from 'lucide-react';
import FloatingWindow from './FloatingWindow';
import { TEMP_STOPS, cToF, type TempUnit } from '@/lib/isotherms';

/**
 * OSIRIS — the temperature scale, as a window like the others.
 *
 * The ramp the map paints with, as a bar, with ticks in the chosen unit and
 * the other unit beneath in small; a C/F switch in the header; the status
 * line as the subtitle (a provider refusal, or how many thermometers are in
 * the blend); and the source in the meta bar — Open-Meteo with the credit its
 * licence asks for when zoomed in, NOAA's GFS and its run when the view is
 * wide. Closing it turns the layer off.
 */
export default function TemperatureLegend({
  unit, onUnit, time, stations = 0, note = null, source = 'model', run = null, className = '', onClose,
}: {
  unit: TempUnit;
  onUnit: (u: TempUnit) => void;
  time: string | null;
  stations?: number;
  note?: string | null;
  source?: 'model' | 'gfs';
  run?: string | null;
  className?: string;
  onClose?: () => void;
}) {
  const lo = TEMP_STOPS[0][0], hi = TEMP_STOPS[TEMP_STOPS.length - 1][0];
  const gradient = `linear-gradient(90deg, ${TEMP_STOPS.map(([t, c]) => `${c} ${((t - lo) / (hi - lo)) * 100}%`).join(', ')})`;
  const ticks = TEMP_STOPS.filter(([t]) => t % 20 === 0 || t === lo || t === hi).map(([t]) => t);
  const fmt = (c: number, u: TempUnit) => `${Math.round(u === 'F' ? cToF(c) : c)}°`;
  const other: TempUnit = unit === 'C' ? 'F' : 'C';
  const when = time ? `${time.slice(11, 16)}Z` : '';
  const status = note ?? (source === 'gfs'
    ? `Global model${run ? ` · ${run.slice(11, 13)}Z run` : ''}`
    : stations > 0 ? `Model + ${stations} NWS station${stations === 1 ? '' : 's'}` : 'Model only · isotherms every 2°C');

  return (
    <FloatingWindow
      className={className}
      eyebrow="Temperature"
      meta={source === 'gfs' ? 'NOAA GFS 0.5°' : 'Open-Meteo'}
      icon={Thermometer}
      title="Air temperature · 2 m"
      subtitle={note ? <span className="text-white">{status}</span> : status}
      actions={
        <div className="flex rounded overflow-hidden border border-[var(--border-primary)] mr-1" role="group" aria-label="Temperature unit">
          {(['C', 'F'] as TempUnit[]).map(u => (
            <button
              key={u}
              onClick={() => onUnit(u)}
              aria-pressed={unit === u}
              className={`px-1.5 py-0.5 text-[9px] font-mono font-bold ${unit === u ? 'bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              °{u}
            </button>
          ))}
        </div>
      }
      onClose={onClose}
      closeLabel="Turn the temperature layer off"
      ariaLabel="Temperature scale"
      bodyClassName="px-3 pt-2 pb-1.5"
    >
      <div className="h-2 rounded-sm" style={{ background: gradient }} />
      <div className="relative h-7 mt-0.5 text-[9px] font-mono tabular-nums">
        {ticks.map(t => (
          <div key={t} className="absolute -translate-x-1/2 text-center leading-tight" style={{ left: `${((t - lo) / (hi - lo)) * 100}%` }}>
            <div className="text-[var(--text-primary)]">{fmt(t, unit)}</div>
            <div className="text-[var(--text-muted)]">{fmt(t, other)}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 text-[8px] font-mono tracking-wider text-[var(--text-muted)] text-right">
        {when && `${when} · `}{source === 'gfs' ? 'NOAA/NCEP, public domain' : 'Open-Meteo, CC BY 4.0'}
      </div>
    </FloatingWindow>
  );
}
