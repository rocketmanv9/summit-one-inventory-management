'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, SkipBack, Clock } from 'lucide-react';

interface GlobeTimelineProps {
  active: boolean;
  onToggle: (active: boolean) => void;
  timeRange: { start: Date; end: Date } | null;
  currentTime: Date | null;
  onTimeChange: (time: Date | null) => void;
}

const SPEED_OPTIONS = [1, 2, 5, 10] as const;
const PLAYBACK_DURATION_MS = 30_000; // 30s at 1x to traverse full range

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export function GlobeTimeline({
  active,
  onToggle,
  timeRange,
  currentTime,
  onTimeChange,
}: GlobeTimelineProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const draggingRef = useRef(false);
  const scrubberRef = useRef<HTMLDivElement>(null);

  // Compute progress (0..1)
  const progress =
    timeRange && currentTime
      ? Math.max(0, Math.min(1, (currentTime.getTime() - timeRange.start.getTime()) / (timeRange.end.getTime() - timeRange.start.getTime())))
      : 0;

  // Animation loop
  const animate = useCallback(
    (timestamp: number) => {
      if (!timeRange || draggingRef.current) {
        rafRef.current = requestAnimationFrame(animate);
        lastFrameRef.current = timestamp;
        return;
      }

      const delta = timestamp - lastFrameRef.current;
      lastFrameRef.current = timestamp;

      const rangeMs = timeRange.end.getTime() - timeRange.start.getTime();
      if (rangeMs <= 0) return;

      const advanceMs = (delta / PLAYBACK_DURATION_MS) * rangeMs * speed;
      const current = currentTime ?? timeRange.start;
      const nextMs = current.getTime() + advanceMs;

      if (nextMs >= timeRange.end.getTime()) {
        onTimeChange(timeRange.end);
        setPlaying(false);
        return;
      }

      onTimeChange(new Date(nextMs));
      rafRef.current = requestAnimationFrame(animate);
    },
    [timeRange, currentTime, speed, onTimeChange],
  );

  useEffect(() => {
    if (playing && active && timeRange) {
      lastFrameRef.current = performance.now();
      rafRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing, active, timeRange, animate]);

  // Stop playback when deactivated
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);

  const handleToggle = () => {
    if (!active) {
      onToggle(true);
      if (timeRange) onTimeChange(timeRange.start);
    } else {
      onToggle(false);
      setPlaying(false);
      onTimeChange(null);
    }
  };

  const handlePlayPause = () => {
    if (!timeRange) return;
    if (!currentTime) {
      onTimeChange(timeRange.start);
    }
    // If at end, restart
    if (currentTime && timeRange && currentTime.getTime() >= timeRange.end.getTime()) {
      onTimeChange(timeRange.start);
    }
    setPlaying((p) => !p);
  };

  const handleRewind = () => {
    if (timeRange) {
      onTimeChange(timeRange.start);
      setPlaying(false);
    }
  };

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(speed as (typeof SPEED_OPTIONS)[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setSpeed(next);
  };

  const handleScrub = (clientX: number) => {
    if (!scrubberRef.current || !timeRange) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const rangeMs = timeRange.end.getTime() - timeRange.start.getTime();
    onTimeChange(new Date(timeRange.start.getTime() + pct * rangeMs));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    draggingRef.current = true;
    setPlaying(false);
    handleScrub(e.clientX);

    const onMove = (ev: MouseEvent) => handleScrub(ev.clientX);
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 px-4 py-3 w-[460px] max-w-[calc(100%-2rem)]">
      <div className="flex items-center gap-3">
        {/* Toggle */}
        <button
          onClick={handleToggle}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            active
              ? 'bg-primary text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          title={active ? 'Disable timeline' : 'Enable timeline'}
        >
          <Clock className="h-3.5 w-3.5" />
          Timeline
        </button>

        {active && (
          <>
            {/* Rewind */}
            <button
              onClick={handleRewind}
              className="p-1 rounded hover:bg-gray-100 text-gray-600"
              title="Rewind"
            >
              <SkipBack className="h-4 w-4" />
            </button>

            {/* Play/Pause */}
            <button
              onClick={handlePlayPause}
              className="p-1 rounded hover:bg-gray-100 text-gray-600"
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>

            {/* Speed */}
            <button
              onClick={cycleSpeed}
              className="px-2 py-0.5 rounded-md bg-gray-100 hover:bg-gray-200 text-xs font-mono font-medium text-gray-700 min-w-[36px] text-center"
              title="Cycle playback speed"
            >
              {speed}x
            </button>
          </>
        )}
      </div>

      {active && timeRange && (
        <div className="mt-2.5">
          {/* Scrubber */}
          <div
            ref={scrubberRef}
            className="relative h-2 bg-gray-200 rounded-full cursor-pointer group"
            onMouseDown={handleMouseDown}
          >
            {/* Filled portion */}
            <div
              className="absolute inset-y-0 left-0 bg-primary rounded-full transition-[width] duration-75"
              style={{ width: `${progress * 100}%` }}
            />
            {/* Thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white border-2 border-primary rounded-full shadow-sm group-hover:scale-110 transition-transform"
              style={{ left: `${progress * 100}%` }}
            />
          </div>

          {/* Date labels */}
          <div className="flex justify-between mt-1.5 text-[10px] text-gray-500">
            <span>{formatDate(timeRange.start)}</span>
            {currentTime && (
              <span className="font-medium text-gray-700">{formatDate(currentTime)}</span>
            )}
            <span>{formatDate(timeRange.end)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
