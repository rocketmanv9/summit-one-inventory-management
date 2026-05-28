'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { MapProvider } from 'react-map-gl/mapbox';
import { AppShell } from '@/components/layout/AppShell';
import { useGlobeData } from '@/hooks/useGlobeData';
import { useTimelineFilter } from '@/hooks/useTimelineFilter';
import { useTimelineReview } from '@/hooks/useTimelineReview';
import { GlobeFilterBar } from '@/components/globe/GlobeFilterBar';
import { GlobeTimeline } from '@/components/globe/GlobeTimeline';
import { GlobeDetailPanel } from '@/components/globe/GlobeDetailPanel';
import { TimelineReviewButton } from '@/components/globe/TimelineReviewButton';
import { TimelineReviewOverlay } from '@/components/globe/TimelineReviewOverlay';
import { Loader2 } from 'lucide-react';
import type { GlobePoint, GlobeArc, VisibleLayers } from '@/components/globe/GlobeVisualization';
import type { GlobeFilters } from '@/lib/rpc/operations';

const GlobeVisualization = dynamic(
  () => import('@/components/globe/GlobeVisualization').then((mod) => mod.GlobeVisualization),
  { ssr: false }
);

function deriveTimeRange(data: { transfers: { created_at: string }[]; purchaseOrders: { created_at: string }[] } | null) {
  if (!data) return null;
  const dates: number[] = [];
  for (const t of data.transfers) dates.push(new Date(t.created_at).getTime());
  for (const po of data.purchaseOrders) dates.push(new Date(po.created_at).getTime());
  if (dates.length === 0) return null;
  return { start: new Date(Math.min(...dates)), end: new Date(Math.max(...dates)) };
}

export default function OperationsGlobePage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [filters, setFilters] = useState<GlobeFilters>({});
  const [visibleLayers, setVisibleLayers] = useState<VisibleLayers>({
    locations: true,
    vendors: true,
    transfers: true,
    pos: true,
  });
  const [selectedPoint, setSelectedPoint] = useState<GlobePoint | null>(null);
  const [selectedArc, setSelectedArc] = useState<GlobeArc | null>(null);

  // Multi-select statuses (empty = show all)
  const [transferStatuses, setTransferStatuses] = useState<string[]>([]);
  const [poStatuses, setPoStatuses] = useState<string[]>([]);

  // Timeline state
  const [timelineActive, setTimelineActive] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  const { data, loading, error } = useGlobeData({
    ...filters,
    show_vendors: visibleLayers.vendors,
    show_pos: visibleLayers.pos,
  });

  const timeRange = useMemo(() => deriveTimeRange(data), [data]);

  const filteredData = useTimelineFilter(
    data,
    timelineActive ? currentTime : null,
    transferStatuses,
    poStatuses,
  );

  // AI Timeline Review
  const review = useTimelineReview(data);
  const reviewActive = review.state !== 'idle';

  // Count of reviewable events for the button
  const reviewEventCount = useMemo(() => {
    if (!data) return 0;
    return data.transfers.length + data.purchaseOrders.length;
  }, [data]);

  // Observe the map container (not the full page) for sizing
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handlePointClick = useCallback((point: GlobePoint) => {
    setSelectedArc(null);
    setSelectedPoint(point);
  }, []);

  const handleArcClick = useCallback((arc: GlobeArc) => {
    setSelectedPoint(null);
    setSelectedArc(arc);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedPoint(null);
    setSelectedArc(null);
  }, []);

  const handleToggleLayer = useCallback((layer: keyof VisibleLayers, value: boolean) => {
    setVisibleLayers((prev) => ({ ...prev, [layer]: value }));
  }, []);

  const handleTimelineToggle = useCallback((active: boolean) => {
    setTimelineActive(active);
    if (!active) setCurrentTime(null);
  }, []);

  const stats = filteredData
    ? {
        locations: filteredData.locations.length,
        vendors: filteredData.vendors.length,
        transfers: filteredData.transfers.length,
        pos: filteredData.purchaseOrders.length,
      }
    : null;

  return (
    <AppShell>
      {/* Full-bleed flex row: sidebar filter panel + map */}
      <div className="-mx-6 -mt-6 flex" style={{ height: 'calc(100vh - 4rem)' }}>
        {/* Left filter sidebar */}
        <GlobeFilterBar
          filters={filters}
          onChange={setFilters}
          visibleLayers={visibleLayers}
          onToggleLayer={handleToggleLayer}
          transferStatuses={transferStatuses}
          onTransferStatusChange={setTransferStatuses}
          poStatuses={poStatuses}
          onPoStatusChange={setPoStatuses}
          timelineActive={timelineActive}
          reviewActive={reviewActive}
        />

        {/* Right map area */}
        <div className="flex-1 relative" ref={mapContainerRef}>
          {loading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
              <div className="flex items-center gap-3 bg-white rounded-lg shadow-lg px-6 py-4">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm font-medium text-gray-700">Loading map data...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
              <div className="bg-white rounded-lg shadow-lg px-6 py-4 max-w-md">
                <p className="text-sm text-red-600 font-medium">Failed to load globe data</p>
                <p className="text-xs text-gray-500 mt-1">{error}</p>
              </div>
            </div>
          )}

          <MapProvider>
            {filteredData && (
              <GlobeVisualization
                id="globe-map"
                data={filteredData}
                visibleLayers={visibleLayers}
                onPointClick={handlePointClick}
                onArcClick={handleArcClick}
                width={dimensions.width}
                height={dimensions.height}
              />
            )}

            <TimelineReviewButton
              state={review.state}
              error={review.error}
              eventCount={reviewEventCount}
              onStart={review.start}
              onStop={review.stop}
            />

            <TimelineReviewOverlay
              state={review.state}
              currentStop={review.currentStop}
              currentIndex={review.currentIndex}
              totalStops={review.stops.length}
              onPause={review.pause}
              onResume={review.resume}
              onNext={review.next}
              onPrev={review.prev}
              onStop={review.stop}
            />
          </MapProvider>

          <GlobeTimeline
            active={timelineActive}
            onToggle={handleTimelineToggle}
            timeRange={timeRange}
            currentTime={currentTime}
            onTimeChange={setCurrentTime}
            disabled={reviewActive}
          />

          {stats && !reviewActive && (
            <div className="absolute bottom-4 left-4 z-10 flex gap-3">
              {visibleLayers.locations && <StatBadge label="Locations" count={stats.locations} color="bg-blue-500" />}
              {visibleLayers.vendors && <StatBadge label="Vendors" count={stats.vendors} color="bg-green-500" />}
              {visibleLayers.transfers && <StatBadge label="Transfers" count={stats.transfers} color="bg-amber-500" />}
              {visibleLayers.pos && <StatBadge label="POs" count={stats.pos} color="bg-purple-500" />}
            </div>
          )}

          <GlobeDetailPanel
            selectedPoint={selectedPoint}
            selectedArc={selectedArc}
            onClose={handleCloseDetail}
          />
        </div>
      </div>
    </AppShell>
  );
}

function StatBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-sm border border-gray-200">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-xs font-medium text-gray-700">
        {count} {label}
      </span>
    </div>
  );
}
