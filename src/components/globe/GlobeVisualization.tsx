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
  color: string;
  typeLabel: string;
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

export type VisibleLayers = {
  locations: boolean;
  vendors: boolean;
  transfers: boolean;
  pos: boolean;
};

interface GlobeVisualizationProps {
  data: GlobeData;
  visibleLayers: VisibleLayers;
  onPointClick?: (point: GlobePoint) => void;
  onArcClick?: (arc: GlobeArc) => void;
  width: number;
  height: number;
}

// Color map for location types
const LOCATION_TYPE_COLORS: Record<string, string> = {
  yard: '#3b82f6',       // blue
  warehouse: '#3b82f6',  // blue
  plant: '#6366f1',      // indigo
  'job site': '#f97316', // orange
  job: '#f97316',        // orange
  truck: '#8b5cf6',      // violet
  office: '#64748b',     // slate
};

const VENDOR_COLOR = '#22c55e';   // green
const DEFAULT_LOCATION_COLOR = '#3b82f6'; // blue fallback

const STATUS_COLORS: Record<string, string> = {
  draft: '#f59e0b',
  in_transit: '#3b82f6',
  completed: '#22c55e',
  cancelled: '#6b7280',
};

function getLocationColor(loc: GlobeLocation): string {
  const typeName = loc.location_type?.name?.toLowerCase() || '';
  return LOCATION_TYPE_COLORS[typeName] || DEFAULT_LOCATION_COLOR;
}

function getLocationTypeLabel(loc: GlobeLocation): string {
  return loc.location_type?.name || 'Location';
}

export function GlobeVisualization({
  data,
  visibleLayers,
  onPointClick,
  onArcClick,
  width,
  height,
}: GlobeVisualizationProps) {
  const globeRef = useRef<any>(null);

  // Initial position + auto-rotate that stops on interaction
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    globe.pointOfView({ lat: 39.8, lng: -98.5, altitude: 2.5 }, 1000);

    const controls = globe.controls();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.3;

      // Stop auto-rotate on any user interaction
      const stopRotate = () => {
        controls.autoRotate = false;
      };
      controls.addEventListener('start', stopRotate);
      return () => {
        controls.removeEventListener('start', stopRotate);
      };
    }
  }, []);

  // Build points data
  const pointsData = useMemo(() => {
    const points: GlobePoint[] = [];

    if (visibleLayers.locations) {
      for (const loc of data.locations) {
        points.push({
          id: loc.id,
          lat: loc.latitude,
          lng: loc.longitude,
          name: loc.name,
          type: 'location',
          color: getLocationColor(loc),
          typeLabel: getLocationTypeLabel(loc),
          data: loc,
        });
      }
    }

    if (visibleLayers.vendors) {
      for (const vendor of data.vendors) {
        points.push({
          id: vendor.id,
          lat: vendor.latitude,
          lng: vendor.longitude,
          name: vendor.name,
          type: 'vendor',
          color: VENDOR_COLOR,
          typeLabel: 'Vendor',
          data: vendor,
        });
      }
    }

    return points;
  }, [data.locations, data.vendors, visibleLayers.locations, visibleLayers.vendors]);

  // Build HTML label elements for each point
  const htmlElementsData = useMemo(() => {
    return pointsData.map((p) => ({
      ...p,
      size: 0,
    }));
  }, [pointsData]);

  // Build arcs data
  const arcsData = useMemo(() => {
    const arcs: GlobeArc[] = [];

    if (visibleLayers.transfers) {
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
    }

    if (visibleLayers.pos) {
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
  }, [data.transfers, data.purchaseOrders, data.vendors, data.locations, visibleLayers.transfers, visibleLayers.pos]);

  const getPointColor = useCallback((point: object) => (point as GlobePoint).color, []);
  const getPointAltitude = useCallback(() => 0.006, []);
  const getPointRadius = useCallback(() => 0.25, []);

  const getPointLabel = useCallback((point: object) => {
    const p = point as GlobePoint;
    return `<div style="background:rgba(0,0,0,0.8);color:white;padding:4px 8px;border-radius:4px;font-size:12px"><b>${p.name}</b><br/><span style="opacity:0.7">${p.typeLabel}</span></div>`;
  }, []);

  // HTML element factory for persistent labels
  const htmlElementFn = useCallback((d: object) => {
    const p = d as GlobePoint;
    const el = document.createElement('div');
    el.style.cssText = `
      pointer-events: none;
      font-size: 10px;
      font-weight: 600;
      color: white;
      text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.5);
      white-space: nowrap;
      transform: translate(-50%, -100%);
      padding: 1px 4px;
      border-radius: 2px;
      background: ${p.color}cc;
    `;
    el.textContent = p.name;
    return el;
  }, []);

  const getArcColor = useCallback((arc: object) => {
    const a = arc as GlobeArc;
    if (a.type === 'po') return ['#a855f7', '#a855f7'];
    const color = STATUS_COLORS[a.status || ''] || '#6b7280';
    return [color, color];
  }, []);

  const getArcDashLength = useCallback((arc: object) => {
    return (arc as GlobeArc).status === 'in_transit' ? 0.4 : 1;
  }, []);

  const getArcDashGap = useCallback((arc: object) => {
    return (arc as GlobeArc).status === 'in_transit' ? 0.2 : 0;
  }, []);

  const getArcDashAnimateTime = useCallback((arc: object) => {
    return (arc as GlobeArc).status === 'in_transit' ? 2000 : 0;
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
    (point: object) => { onPointClick?.(point as GlobePoint); },
    [onPointClick]
  );

  const handleArcClick = useCallback(
    (arc: object) => { onArcClick?.(arc as GlobeArc); },
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
      htmlElementsData={htmlElementsData}
      htmlLat="lat"
      htmlLng="lng"
      htmlAltitude={0.02}
      htmlElement={htmlElementFn}
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
