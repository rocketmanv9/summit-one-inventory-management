'use client';

import { Eye, X } from 'lucide-react';
import { useViewAs } from '@/lib/view-as';

/**
 * Sticky strip shown while previewing as a position, so it's always obvious the
 * view is filtered and your real access is unchanged.
 */
export function ViewAsBanner() {
  const { isPreviewing, selectedPosition, setSelectedPositionId } = useViewAs();
  if (!isPreviewing || !selectedPosition) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      <Eye className="h-4 w-4 flex-shrink-0" />
      <span>
        Previewing as <strong>{selectedPosition.title}</strong>. This only changes what you see — your real access is unchanged.
      </span>
      <button
        onClick={() => setSelectedPositionId(null)}
        className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white/60 px-2 py-0.5 text-xs font-medium hover:bg-white"
      >
        <X className="h-3 w-3" /> Exit preview
      </button>
    </div>
  );
}
