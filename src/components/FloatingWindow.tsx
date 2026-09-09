'use client';

import type { ReactNode, ComponentType } from 'react';
import { X } from 'lucide-react';
import DraggablePanel from './DraggablePanel';

/**
 * OSIRIS — the one window chrome.
 *
 * Every floating panel used to bring its own frame: some a glass card with a
 * heading and a ✕ in the corner, some the broadcast viewers' two-row header
 * with a drag handle, some nothing at all. This is the broadcast viewers'
 * frame, lifted out so the rest can share it: a meta bar (eyebrow left, detail
 * right), a title row (cornered icon, name, subtitle, actions, ✕), both rows a
 * drag handle, over a DraggablePanel that remembers where the operator put it.
 *
 * `className` positions the window — it is passed straight to the panel, so a
 * window keeps its responsive placement and is dragged from there.
 */
export interface FloatingWindowProps {
  className: string;
  style?: React.CSSProperties;
  /** Small caps label in the meta bar, e.g. "BROADCAST TV". */
  eyebrow: ReactNode;
  /** Right-hand side of the meta bar, e.g. "US · 1462 CH". */
  meta?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Buttons that sit before the close button. Use `windowButtonClass`. */
  actions?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  /** Extra classes on the body wrapper below the header. */
  bodyClassName?: string;
  /** Suppresses dragging, for a full-bleed window. */
  disabled?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}

/** The header's button style, exported so a window's own actions match its ✕. */
export const windowButtonClass = 'p-1.5 hover:bg-white/10 rounded transition-colors';
export const windowIconClass = 'w-3.5 h-3.5 text-[var(--text-muted)]';

export default function FloatingWindow({
  className, style, eyebrow, meta, icon: Icon, title, subtitle, actions, onClose,
  closeLabel = 'Close', bodyClassName = '', disabled, ariaLabel, children,
}: FloatingWindowProps) {
  return (
    <DraggablePanel className={className} style={style} disabled={disabled}>
      <div
        className="relative overflow-hidden flex flex-col max-h-[inherit] bg-black/85 backdrop-blur-xl border border-[var(--border-primary)]"
        style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.9), inset 0 0 30px rgba(0,0,0,0.8)' }}
        role="dialog"
        aria-label={ariaLabel}
      >
        {/* Meta bar */}
        <div data-drag-handle className="flex items-center justify-between px-3 py-1 border-b border-white/5 text-[9px] font-mono tracking-[0.2em] text-[var(--text-muted)] bg-[var(--hover-accent)] relative z-10 shrink-0">
          <span className="text-[var(--gold-primary)] font-bold uppercase">{eyebrow}</span>
          {meta && <span className="truncate ml-3">{meta}</span>}
        </div>

        {/* Title */}
        <div data-drag-handle className="flex items-center justify-between px-3 md:px-4 py-2.5 relative z-10 gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {Icon && (
              <div className="relative flex items-center justify-center w-6 h-6 border border-[var(--gold-primary)] bg-[var(--gold-primary)]/10 rounded-sm flex-shrink-0">
                <Icon className="w-3.5 h-3.5 text-[var(--gold-primary)]" />
                <div className="absolute top-0 left-0 w-1 h-1 border-t border-l border-[var(--gold-primary)]" />
                <div className="absolute bottom-0 right-0 w-1 h-1 border-b border-r border-[var(--gold-primary)]" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3
                className="text-[11px] md:text-[12px] font-mono font-bold tracking-widest truncate text-white uppercase"
                style={{ textShadow: '0 0 10px rgba(255,255,255,0.3)' }}
              >
                {title}
              </h3>
              {subtitle && (
                <p className="text-[9px] font-mono text-[var(--gold-primary)] uppercase tracking-wider opacity-80 truncate">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {actions}
            {onClose && (
              <button onClick={onClose} className={windowButtonClass} title={closeLabel} aria-label={closeLabel}>
                <X className={windowIconClass} />
              </button>
            )}
          </div>
        </div>

        <div className={`relative min-h-0 flex-1 border-t border-[var(--border-primary)] ${bodyClassName}`}>
          {children}
        </div>
      </div>
    </DraggablePanel>
  );
}
