'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { AppShell } from '@/components/layout/AppShell';
import { useGlobeData } from '@/hooks/useGlobeData';
import { GlobeFilterBar } from '@/components/globe/GlobeFilterBar';
import { GlobeDetailPanel } from '@/components/globe/GlobeDetailPanel';
import { Loader2 } from 'lucide-react';
import type { GlobePoint, GlobeArc, VisibleLayers } from '@/components/globe/GlobeVisualization';
import type { GlobeFilters } from '@/lib/rpc/operations';

const GlobeVisualization = dynamic(
  () => import('@/components/globe/GlobeVisualization').then((mod) => mod.GlobeVisualization),
  { ssr: false }
);

export default function OperationsGlobePage() {
  const containerRef = useRef<HTMLDivElement>(null);
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

  const { data, loading, error } = useGlobeData({
    ...filters,
    show_vendors: visibleLayers.vendors,
    show_pos: visibleLayers.pos,
  });

  useEffect(() => {
    const container = containerRef.current;
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

  const stats = data
    ? {
        locations: data.locations.length,
        vendors: data.vendors.length,
        transfers: data.transfers.length,
        pos: data.purchaseOrders.length,
      }
    : null;

  return (
    <AppShell>
      <div className="-mx-6 -mt-6 relative" ref={containerRef} style={{ height: 'calc(100vh - 4rem)' }}>
        {loading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
            <div className="flex items-center gap-3 bg-white rounded-lg shadow-lg px-6 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm font-medium text-gray-700">Loading globe data...</span>
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

        {data && (
          <GlobeVisualization
            data={data}
            visibleLayers={visibleLayers}
            onPointClick={handlePointClick}
            onArcClick={handleArcClick}
            width={dimensions.width}
            height={dimensions.height}
          />
        )}

        <GlobeFilterBar
          filters={filters}
          onChange={setFilters}
          visibleLayers={visibleLayers}
          onToggleLayer={handleToggleLayer}
        />

        {stats && (
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
