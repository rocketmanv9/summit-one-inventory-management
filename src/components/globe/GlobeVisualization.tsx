'use client';

import { useRef, useEffect, useMemo, useCallback } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeData, GlobeLocation, GlobeVendor, GlobeTransfer, GlobePurchaseOrder } from '@/lib/rpc/operations';

export type PointType = 'location' | 'vendor';
export type ArcType = 'transfer' | 'po';

export interface GlobePoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  type: PointType;
  data: GlobeLocation | GlobeVendor;
}

export interface GlobeArc {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  type: ArcType;
  status?: string;
  data: GlobeTransfer | GlobePurchaseOrder;
}

interface GlobeVisualizationProps {
  data: GlobeData;
  showVendors: boolean;
  showPOs: boolean;
  onPointClick?: (point: GlobePoint) => void;
  onArcClick?: (arc: GlobeArc) => void;
  width: number;
  height: number;
}

const STATUS_COLORS: Record<string, string> = {
  draft: '#f59e0b',
  in_transit: '#3b82f6',
  completed: '#22c55e',
  cancelled: '#6b7280',
};

export function GlobeVisualization({
  data,
  showVendors,
  showPOs,
  onPointClick,
  onArcClick,
  width,
  height,
}: GlobeVisualizationProps) {
  const globeRef = useRef<any>(null);

  // Auto-rotate and initial position
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    // Center on continental US
    globe.pointOfView({ lat: 39.8, lng: -98.5, altitude: 2.5 }, 1000);

    // Slow auto-rotate
    const controls = globe.controls();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.3;
    }
  }, []);

  // Build points data
  const pointsData = useMemo(() => {
    const points: GlobePoint[] = [];

    for (const loc of data.locations) {
      points.push({
        id: loc.id,
        lat: loc.latitude,
        lng: loc.longitude,
        name: loc.name,
        type: 'location',
        data: loc,
      });
    }

    if (showVendors) {
      for (const vendor of data.vendors) {
        points.push({
          id: vendor.id,
          lat: vendor.latitude,
          lng: vendor.longitude,
          name: vendor.name,
          type: 'vendor',
          data: vendor,
        });
      }
    }

    return points;
  }, [data.locations, data.vendors, showVendors]);

  // Build arcs data
  const arcsData = useMemo(() => {
    const arcs: GlobeArc[] = [];

    // Transfer arcs
    for (const transfer of data.transfers) {
      const from = transfer.from_location;
      const to = transfer.to_location;
      if (!from?.latitude || !from?.longitude || !to?.latitude || !to?.longitude) continue;

      arcs.push({
        id: transfer.id,
        startLat: from.latitude,
        startLng: from.longitude,
        endLat: to.latitude,
        endLng: to.longitude,
        type: 'transfer',
        status: transfer.status,
        data: transfer,
      });
    }

    // PO arcs (vendor -> delivery location)
    if (showPOs) {
      const vendorMap = new Map(data.vendors.map((v) => [v.id, v]));
      const locationMap = new Map(data.locations.map((l) => [l.id, l]));

      for (const po of data.purchaseOrders) {
        const vendor = vendorMap.get(po.vendor_id);
        const location = po.delivery_location_id ? locationMap.get(po.delivery_location_id) : null;
        if (!vendor || !location) continue;

        arcs.push({
          id: po.id,
          startLat: vendor.latitude,
          startLng: vendor.longitude,
          endLat: location.latitude,
          endLng: location.longitude,
          type: 'po',
          status: po.status,
          data: po,
        });
      }
    }

    return arcs;
  }, [data.transfers, data.purchaseOrders, data.vendors, data.locations, showPOs]);

  const getPointColor = useCallback((point: object) => {
    const p = point as GlobePoint;
    return p.type === 'location' ? '#3b82f6' : '#22c55e';
  }, []);

  const getPointAltitude = useCallback(() => 0.01, []);
  const getPointRadius = useCallback((point: object) => {
    const p = point as GlobePoint;
    return p.type === 'location' ? 0.5 : 0.35;
  }, []);

  const getPointLabel = useCallback((point: object) => {
    const p = point as GlobePoint;
    const badge = p.type === 'location' ? 'Yard' : 'Vendor';
    return `<div style="background:rgba(0,0,0,0.8);color:white;padding:4px 8px;border-radius:4px;font-size:12px"><b>${p.name}</b><br/><span style="opacity:0.7">${badge}</span></div>`;
  }, []);

  const getArcColor = useCallback((arc: object) => {
    const a = arc as GlobeArc;
    if (a.type === 'po') return ['#a855f7', '#a855f7'];
    const color = STATUS_COLORS[a.status || ''] || '#6b7280';
    return [color, color];
  }, []);

  const getArcDashLength = useCallback((arc: object) => {
    const a = arc as GlobeArc;
    return a.status === 'in_transit' ? 0.4 : 1;
  }, []);

  const getArcDashGap = useCallback((arc: object) => {
    const a = arc as GlobeArc;
    return a.status === 'in_transit' ? 0.2 : 0;
  }, []);

  const getArcDashAnimateTime = useCallback((arc: object) => {
    const a = arc as GlobeArc;
    return a.status === 'in_transit' ? 2000 : 0;
  }, []);

  const getArcStroke = useCallback(() => 0.5, []);

  const getArcLabel = useCallback((arc: object) => {
    const a = arc as GlobeArc;
    if (a.type === 'transfer') {
      const t = a.data as GlobeTransfer;
      return `<div style="background:rgba(0,0,0,0.8);color:white;padding:4px 8px;border-radius:4px;font-size:12px"><b>Transfer</b><br/>Status: ${t.status}<br/>${t.transfer_lines.length} item(s)</div>`;
    }
    const po = a.data as GlobePurchaseOrder;
    return `<div style="background:rgba(0,0,0,0.8);color:white;padding:4px 8px;border-radius:4px;font-size:12px"><b>PO ${po.po_number}</b><br/>Status: ${po.status}</div>`;
  }, []);

  const handlePointClick = useCallback(
    (point: object) => {
      onPointClick?.(point as GlobePoint);
    },
    [onPointClick]
  );

  const handleArcClick = useCallback(
    (arc: object) => {
      onArcClick?.(arc as GlobeArc);
    },
    [onArcClick]
  );

  return (
    <Globe
      ref={globeRef}
      width={width}
      height={height}
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
      backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
      pointsData={pointsData}
      pointLat="lat"
      pointLng="lng"
      pointColor={getPointColor}
      pointAltitude={getPointAltitude}
      pointRadius={getPointRadius}
      pointLabel={getPointLabel}
      onPointClick={handlePointClick}
      arcsData={arcsData}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcColor={getArcColor}
      arcDashLength={getArcDashLength}
      arcDashGap={getArcDashGap}
      arcDashAnimateTime={getArcDashAnimateTime}
      arcStroke={getArcStroke}
      arcLabel={getArcLabel}
      onArcClick={handleArcClick}
      animateIn={true}
    />
  );
}
