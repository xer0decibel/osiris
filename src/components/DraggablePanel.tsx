'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useDragControls, useMotionValue } from 'framer-motion';

interface DraggablePanelProps {
  /** Positioning classes, exactly as the panel had them before wrapping. */
  className?: string;
  style?: React.CSSProperties;
  /** Suppresses dragging — used while a panel is full-bleed, where there is
   *  nowhere to drag to. Any offset already applied is returned to zero. */
  disabled?: boolean;
  children: React.ReactNode;
}

/** Gap kept between a panel edge and the viewport edge, in px. */
const MARGIN = 8;

/** Below this the panels lay out as full-width sheets, so there is no room to
 *  drag and a stray swipe would only fight the map. Matches Tailwind's `md`. */
const MIN_DRAG_WIDTH = 768;

/**
 * Raised each time a panel is grabbed so the one being moved comes to the
 * front. Module scope on purpose: the ordering is between panels, and there is
 * no common React parent to hang it on.
 */
let topZ = 600;

/**
 * A floating panel that can be dragged by its title bar.
 *
 * Drag starts only from an element marked `data-drag-handle`, and only when the
 * press did not land on something interactive inside it — otherwise closing a
 * panel or nudging a volume slider would drag the window instead.
 *
 * The panel keeps its CSS placement (`fixed bottom-6 left-6`, and so on) and is
 * moved with a transform on top of it, so the responsive layout still decides
 * where a window first appears.
 */
export default function DraggablePanel({ className, style, disabled, children }: DraggablePanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [zIndex, setZIndex] = useState<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [constraints, setConstraints] = useState({ left: 0, right: 0, top: 0, bottom: 0 });

  /* Constraints are measured against the element's *layout* position, which is
     where a transform of zero would put it — so the current offset has to be
     subtracted back out, or the box drifts further every time it is grabbed. */
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const layoutLeft = r.left - x.get();
    const layoutTop = r.top - y.get();
    const left = MARGIN - layoutLeft;
    const top = MARGIN - layoutTop;
    // A panel taller or wider than the viewport would otherwise produce an
    // inverted box that framer-motion cannot satisfy.
    const right = Math.max(left, window.innerWidth - MARGIN - r.width - layoutLeft);
    const bottom = Math.max(top, window.innerHeight - MARGIN - r.height - layoutTop);
    return { left, right, top, bottom };
  }, [x, y]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    if (window.innerWidth < MIN_DRAG_WIDTH) return;

    const target = e.target as HTMLElement | null;
    if (!target?.closest('[data-drag-handle]')) return;
    // The header carries the close, locate and link controls; a press on any of
    // them is a click, not the start of a drag.
    if (target.closest('button, a, input, select, textarea, [role="slider"]')) return;

    const box = measure();
    if (box) setConstraints(box);
    setZIndex(++topZ);
    setDragging(true);
    controls.start(e);
  }, [controls, disabled, measure]);

  // A window dragged to one edge would otherwise end up unreachable when the
  // viewport shrinks, so pull it back inside whenever the window resizes.
  useEffect(() => {
    const onResize = () => {
      const box = measure();
      if (!box) return;
      setConstraints(box);
      x.set(Math.min(Math.max(x.get(), box.left), box.right));
      y.set(Math.min(Math.max(y.get(), box.top), box.bottom));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure, x, y]);

  // Full-bleed panels have nowhere to go; drop any offset so they sit square.
  useEffect(() => {
    if (disabled) { x.set(0); y.set(0); }
  }, [disabled, x, y]);

  return (
    <motion.div
      ref={ref}
      /* Only opacity and scale are animated. `y` belongs to the drag, and an
         entrance that animated it too would fight the transform on mount. */
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, type: 'spring', bounce: 0 }}
      drag={!disabled}
      dragListener={false}
      dragControls={controls}
      dragConstraints={constraints}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={() => setDragging(false)}
      onPointerDown={onPointerDown}
      style={{ ...style, x, y, zIndex }}
      className={className}
      data-dragging={dragging || undefined}
    >
      {children}
    </motion.div>
  );
}
