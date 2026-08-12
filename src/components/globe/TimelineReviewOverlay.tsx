'use client';

import { Sparkles, Truck, ShoppingCart, BarChart3, SkipBack, SkipForward, Play, Pause, X } from 'lucide-react';
import type { TourStop } from '@/app/api/ai/timeline-review/route';
import type { ReviewState } from '@/hooks/useTimelineReview';

interface TimelineReviewOverlayProps {
  state: ReviewState;
  currentStop: TourStop | null;
  currentIndex: number;
  totalStops: number;
  onPause: () => void;
  onResume: () => void;
  onNext: () => void;
  onPrev: () => void;
  onStop: () => void;
}

const STOP_ICONS: Record<TourStop['type'], typeof Sparkles> = {
  intro: Sparkles,
  transfer: Truck,
  purchase_order: ShoppingCart,
  outro: BarChart3,
};

const STOP_COLORS: Record<TourStop['type'], string> = {
  intro: 'bg-violet-100 text-violet-700',
  transfer: 'bg-amber-100 text-amber-700',
  purchase_order: 'bg-purple-100 text-purple-700',
  outro: 'bg-blue-100 text-blue-700',
};

const STOP_LABELS: Record<TourStop['type'], string> = {
  intro: 'Overview',
  transfer: 'Transfer',
  purchase_order: 'Purchase Order',
  outro: 'Insights',
};

export function TimelineReviewOverlay({
  state,
  currentStop,
  currentIndex,
  totalStops,
  onPause,
  onResume,
  onNext,
  onPrev,
  onStop,
}: TimelineReviewOverlayProps) {
  if (!currentStop || state === 'idle' || state === 'loading') return null;

  const Icon = STOP_ICONS[currentStop.type];
  const colorClass = STOP_COLORS[currentStop.type];
  const label = STOP_LABELS[currentStop.type];
  const isPlaying = state === 'playing';
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalStops - 1;

  return (
    <div
      className={`absolute bottom-28 left-1/2 -translate-x-1/2 z-20 w-[420px] max-w-[calc(100%-2rem)] transition-all duration-300 ${
        currentStop ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
    >
      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-xl border border-gray-200 overflow-hidden">
        {/* Card content */}
        <div className="px-5 pt-4 pb-3">
          {/* Header row */}
          <div className="flex items-center gap-3 mb-2">
            <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colorClass}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 truncate">
                {currentStop.headline}
              </h3>
            </div>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${colorClass}`}>
              {label}
            </span>
          </div>

          {/* Summary */}
          <p className="text-xs text-gray-600 leading-relaxed">
            {currentStop.summary}
          </p>
        </div>

        {/* Controls footer */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/80 border-t border-gray-100">
          {/* Progress */}
          <span className="text-[11px] text-gray-500 font-medium tabular-nums">
            {currentIndex + 1} of {totalStops}
          </span>

          {/* Playback controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={onPrev}
              disabled={isFirst}
              className="p-1.5 rounded-md hover:bg-gray-200 text-gray-600 disabled:text-gray-300 disabled:hover:bg-transparent transition-colors"
              title="Previous"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={isPlaying ? onPause : onResume}
              className="p-1.5 rounded-md hover:bg-gray-200 text-gray-700 transition-colors"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>

            <button
              onClick={onNext}
              disabled={isLast}
              className="p-1.5 rounded-md hover:bg-gray-200 text-gray-600 disabled:text-gray-300 disabled:hover:bg-transparent transition-colors"
              title="Next"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>

            <div className="w-px h-4 bg-gray-200 mx-1" />

            <button
              onClick={onStop}
              className="p-1.5 rounded-md hover:bg-red-100 text-gray-500 hover:text-red-600 transition-colors"
              title="Close review"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Progress dots */}
          <div className="flex gap-0.5">
            {Array.from({ length: Math.min(totalStops, 20) }).map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === currentIndex ? 'bg-primary' : i < currentIndex ? 'bg-gray-400' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
