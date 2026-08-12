'use client';

import { Sparkles, Loader2, X } from 'lucide-react';
import type { ReviewState } from '@/hooks/useTimelineReview';

interface TimelineReviewButtonProps {
  state: ReviewState;
  error: string | null;
  eventCount: number;
  onStart: () => void;
  onStop: () => void;
}

export function TimelineReviewButton({
  state,
  error,
  eventCount,
  onStart,
  onStop,
}: TimelineReviewButtonProps) {
  const isActive = state === 'playing' || state === 'paused' || state === 'finished';
  const isLoading = state === 'loading';
  const notEnoughData = eventCount === 0;

  return (
    <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-1">
      <button
        onClick={isActive ? onStop : onStart}
        disabled={isLoading || notEnoughData}
        title={notEnoughData ? 'Not enough activity for review' : isActive ? 'Stop AI Review' : 'Start AI Review'}
        className={`flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium shadow-lg border transition-all ${
          isActive
            ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
            : isLoading
              ? 'bg-white/90 border-gray-200 text-gray-500 cursor-wait'
              : notEnoughData
                ? 'bg-white/70 border-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-white/90 border-gray-200 text-gray-700 hover:bg-white hover:border-primary hover:text-primary'
        } backdrop-blur-sm`}
      >
        {isActive ? (
          <>
            <X className="h-4 w-4" />
            Stop Review
          </>
        ) : isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            AI Review
          </>
        )}
      </button>

      {error && state === 'idle' && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 text-xs text-red-600 max-w-[200px]">
          {error}
        </div>
      )}
    </div>
  );
}
