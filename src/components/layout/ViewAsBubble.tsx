'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Check, X, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useViewAs } from '@/lib/view-as';

/**
 * Floating "view as position" bubble — a draggable corner FAB that follows you
 * across every page. Admin/developer only. It's a second surface onto the same
 * `useViewAs` context as the top-nav <ViewAsPicker/>, so the two stay in sync
 * (and with the <ViewAsBanner/> + real enforcement). Built for fast role-flipping
 * while testing: always visible, obvious when a preview is active.
 *
 * - Collapsed: a round button. Amber + ringed while previewing.
 * - Click (without dragging): expand a compact role list.
 * - Drag (from the bubble or the panel's grip): reposition; saved to localStorage.
 */

const POS_KEY = 'viewAsBubblePos';
const MARGIN = 16;
const BUBBLE = 52; // px, collapsed diameter
const DRAG_THRESHOLD = 4; // px of movement before a press counts as a drag

interface Pos { x: number; y: number }

export function ViewAsBubble() {
  const { enabled, positions, selectedPosition, isPreviewing, setSelectedPositionId } = useViewAs();

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);

  const dragState = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Default to the bottom-right corner, or restore the saved position. Done after
  // mount so it never mismatches SSR and can read the viewport size.
  useEffect(() => {
    const clamp = (p: Pos): Pos => ({
      x: Math.min(Math.max(p.x, MARGIN), window.innerWidth - BUBBLE - MARGIN),
      y: Math.min(Math.max(p.y, MARGIN), window.innerHeight - BUBBLE - MARGIN),
    });
    let initial: Pos = { x: window.innerWidth - BUBBLE - MARGIN, y: window.innerHeight - BUBBLE - MARGIN };
    try {
      const raw = window.localStorage.getItem(POS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved?.x === 'number' && typeof saved?.y === 'number') initial = saved;
      }
    } catch { /* ignore */ }
    setPos(clamp(initial));
  }, []);

  // Keep the bubble on-screen if the window shrinks.
  useEffect(() => {
    function onResize() {
      setPos((p) => p && ({
        x: Math.min(Math.max(p.x, MARGIN), window.innerWidth - BUBBLE - MARGIN),
        y: Math.min(Math.max(p.y, MARGIN), window.innerHeight - BUBBLE - MARGIN),
      }));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close the expanded panel on an outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const st = dragState.current;
    if (!st) return;
    setPos({
      x: Math.min(Math.max(e.clientX - st.dx, MARGIN), window.innerWidth - BUBBLE - MARGIN),
      y: Math.min(Math.max(e.clientY - st.dy, MARGIN), window.innerHeight - BUBBLE - MARGIN),
    });
  }, []);

  const startDrag = useCallback((e: React.PointerEvent) => {
    if (!pos) return;
    const startX = e.clientX;
    const startY = e.clientY;
    dragState.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
    setDragging(true);

    const move = (ev: PointerEvent) => {
      if (!dragState.current) return;
      if (Math.abs(ev.clientX - startX) > DRAG_THRESHOLD || Math.abs(ev.clientY - startY) > DRAG_THRESHOLD) {
        dragState.current.moved = true;
      }
      onPointerMove(ev);
    };
    const up = () => {
      const moved = dragState.current?.moved ?? false;
      dragState.current = null;
      setDragging(false);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      setPos((p) => {
        if (p) { try { window.localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ } }
        return p;
      });
      // A press that never moved is a click → toggle the panel.
      if (!moved) setOpen((o) => !o);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }, [pos, onPointerMove]);

  // Hidden for non-admins, and until at least one position exists to view as.
  if (!enabled || positions.length === 0 || !pos) return null;

  // Anchor the expanded panel toward whichever side has more room.
  const openLeft = pos.x > window.innerWidth / 2;
  const openUp = pos.y > window.innerHeight / 2;

  return (
    <div
      ref={rootRef}
      className="fixed z-50 select-none"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Collapsed bubble — also the drag handle. */}
      <button
        onPointerDown={startDrag}
        className={cn(
          'flex items-center justify-center rounded-full shadow-lg ring-1 transition-colors',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
          isPreviewing
            ? 'bg-amber-500 text-white ring-amber-300 hover:bg-amber-600'
            : 'bg-primary text-primary-foreground ring-black/10 hover:opacity-90',
        )}
        style={{ width: BUBBLE, height: BUBBLE }}
        aria-label="View as position"
        title={isPreviewing ? `Previewing as ${selectedPosition?.title}` : 'View as position'}
      >
        <Eye className="h-5 w-5" />
        {isPreviewing && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full bg-amber-300 ring-2 ring-white" />
        )}
      </button>

      {isPreviewing && !open && (
        <div
          className="pointer-events-none absolute whitespace-nowrap rounded-md bg-amber-500 px-2 py-0.5 text-xs font-medium text-white shadow"
          style={openUp ? { bottom: BUBBLE + 6, [openLeft ? 'right' : 'left']: 0 } as any
                        : { top: BUBBLE + 6, [openLeft ? 'right' : 'left']: 0 } as any}
        >
          {selectedPosition?.title}
        </div>
      )}

      {open && (
        <div
          className="absolute max-h-[60vh] w-64 overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
          style={{
            [openLeft ? 'right' : 'left']: 0,
            [openUp ? 'bottom' : 'top']: BUBBLE + 8,
          } as any}
        >
          <div
            onPointerDown={startDrag}
            className={cn('flex items-center gap-2 border-b bg-muted/50 px-3 py-2', dragging ? 'cursor-grabbing' : 'cursor-grab')}
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preview access as…</span>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setOpen(false)}
              className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[calc(60vh-40px)] overflow-y-auto p-1.5">
            <button
              onClick={() => { setSelectedPositionId(null); setOpen(false); }}
              className="flex w-full items-center justify-between rounded px-3 py-2 text-sm hover:bg-muted"
            >
              <span>Myself <span className="text-xs text-muted-foreground">(full access)</span></span>
              {!isPreviewing && <Check className="h-4 w-4 text-primary" />}
            </button>
            <div className="my-1 h-px bg-border" />
            {positions.map((p) => {
              const active = selectedPosition?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => { setSelectedPositionId(p.id); setOpen(false); }}
                  className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.title}</span>
                    {p.role_level && <span className="block truncate text-xs text-muted-foreground">{p.role_level}</span>}
                  </span>
                  {active && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
