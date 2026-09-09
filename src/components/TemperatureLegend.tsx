'use client';

import { TEMP_STOPS, cToF, type TempUnit } from '@/lib/isotherms';

/**
 * OSIRIS — the temperature scale.
 *
 * The ramp the map paints with, as a bar, with ticks in the chosen unit and
 * the other unit beneath in small; a C/F switch; and the observation time and
 * the credit Open-Meteo's licence asks for.
 */
export default function TemperatureLegend({ unit, onUnit, time }: { unit: TempUnit; onUnit: (u: TempUnit) => void; time: string | null }) {
  const lo = TEMP_STOPS[0][0], hi = TEMP_STOPS[TEMP_STOPS.length - 1][0];
  const gradient = `linear-gradient(90deg, ${TEMP_STOPS.map(([t, c]) => `${c} ${((t - lo) / (hi - lo)) * 100}%`).join(', ')})`;
  const ticks = TEMP_STOPS.filter(([t]) => t % 20 === 0 || t === lo || t === hi).map(([t]) => t);
  const fmt = (c: number, u: TempUnit) => `${Math.round(u === 'F' ? cToF(c) : c)}°`;
  const other: TempUnit = unit === 'C' ? 'F' : 'C';
  const when = time ? `${time.slice(11, 16)}Z` : '';

  return (
    <div className="glass-panel px-3 py-2 w-[260px] pointer-events-auto" aria-label="Temperature scale">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-[var(--gold-primary)]">Air temperature · 2 m</span>
        <div className="flex rounded overflow-hidden border border-[var(--border-primary)]">
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
      </div>
      <div className="h-2 rounded-sm" style={{ background: gradient }} />
      <div className="relative h-7 mt-0.5 text-[9px] font-mono tabular-nums">
        {ticks.map(t => (
          <div key={t} className="absolute -translate-x-1/2 text-center leading-tight" style={{ left: `${((t - lo) / (hi - lo)) * 100}%` }}>
            <div className="text-[var(--text-primary)]">{fmt(t, unit)}</div>
            <div className="text-[var(--text-muted)]">{fmt(t, other)}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 text-[8px] font-mono tracking-wider text-[var(--text-muted)] flex justify-between">
        <span>Isotherms every 2°C</span>
        <span>{when && `${when} · `}Open-Meteo, CC BY 4.0</span>
      </div>
    </div>
  );
}
