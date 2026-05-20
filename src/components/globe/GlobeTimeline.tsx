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

  // Use refs for values that the animation loop reads, so the loop
  // callback doesn't need to be recreated each frame.
  const currentTimeRef = useRef<Date | null>(currentTime);
  const speedRef = useRef(speed);
  const timeRangeRef = useRef(timeRange);
  const onTimeChangeRef = useRef(onTimeChange);

  currentTimeRef.current = currentTime;
  speedRef.current = speed;
  timeRangeRef.current = timeRange;
  onTimeChangeRef.current = onTimeChange;

  // Compute progress (0..1)
  const progress =
    timeRange && currentTime
      ? Math.max(0, Math.min(1, (currentTime.getTime() - timeRange.start.getTime()) / (timeRange.end.getTime() - timeRange.start.getTime())))
      : 0;

  // Stable animation loop — reads from refs, never recreated
  const animate = useCallback((timestamp: number) => {
    const tr = timeRangeRef.current;
    if (!tr || draggingRef.current) {
      lastFrameRef.current = timestamp;
      rafRef.current = requestAnimationFrame(animate);
      return;
    }

    const delta = timestamp - lastFrameRef.current;
    lastFrameRef.current = timestamp;

    const rangeMs = tr.end.getTime() - tr.start.getTime();
    if (rangeMs <= 0) return;

    const current = currentTimeRef.current ?? tr.start;
    const advanceMs = (delta / PLAYBACK_DURATION_MS) * rangeMs * speedRef.current;
    const nextMs = current.getTime() + advanceMs;

    if (nextMs >= tr.end.getTime()) {
      onTimeChangeRef.current(tr.end);
      setPlaying(false);
      return;
    }

    onTimeChangeRef.current(new Date(nextMs));
    rafRef.current = requestAnimationFrame(animate);
  }, []); // stable — no deps, reads everything from refs

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
    if (currentTime && currentTime.getTime() >= timeRange.end.getTime()) {
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

  const handleScrub = useCallback((clientX: number) => {
    const el = scrubberRef.current;
    const tr = timeRangeRef.current;
    if (!el || !tr) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const rangeMs = tr.end.getTime() - tr.start.getTime();
    onTimeChangeRef.current(new Date(tr.start.getTime() + pct * rangeMs));
  }, []);

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
              className="absolute inset-y-0 left-0 bg-primary rounded-full"
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
