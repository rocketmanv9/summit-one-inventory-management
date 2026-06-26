'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useViewAs } from '@/lib/view-as';

/**
 * Top-nav "Viewing as" picker. Admin/developer only. Selecting a position
 * previews the app as that position (sidebar/settings hide what they can't
 * access). Selecting "Myself" exits the preview.
 */
export function ViewAsPicker() {
  const { enabled, positions, selectedPosition, isPreviewing, setSelectedPositionId } = useViewAs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Hidden for non-admins, and until at least one position exists to view as.
  if (!enabled || positions.length === 0) return null;

  const label = isPreviewing ? selectedPosition?.title ?? 'Myself' : 'Myself';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
          isPreviewing
            ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
            : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
        aria-label="View as position"
        title="Preview the app as a different position"
      >
        <Eye className="h-4 w-4" />
        <span className="hidden max-w-[10rem] truncate sm:inline">
          <span className="text-[11px] font-normal opacity-70">View as: </span>
          {label}
        </span>
        <ChevronDown className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 max-h-80 w-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
          <div className="p-1.5">
            <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Preview access as…
            </p>
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
