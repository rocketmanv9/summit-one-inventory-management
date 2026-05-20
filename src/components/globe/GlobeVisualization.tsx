'use client';

import { useState, useMemo, useCallback } from 'react';
import MapboxMap, { Source, Layer, Popup } from 'react-map-gl/mapbox';
import type { MapMouseEvent, LayerProps } from 'react-map-gl/mapbox';
import type { Feature, FeatureCollection } from 'geojson';
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
const PO_COLOR = '#a855f7';       // purple

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

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

const INTERACTIVE_LAYERS = [
  'points-circle',
  'transfer-lines-solid',
  'transfer-lines-dashed',
  'po-lines',
];

// ---------- Layer styles ----------

const pointsCircleLayer = {
  id: 'points-circle',
  type: 'circle' as const,
  paint: {
    'circle-radius': 7,
    'circle-color': ['get', 'color'],
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
} satisfies LayerProps;

const pointsLabelLayer = {
  id: 'points-label',
  type: 'symbol' as const,
  layout: {
    'text-field': ['get', 'name'],
    'text-size': 11,
    'text-offset': [0, 1.4],
    'text-anchor': 'top' as const,
    'text-allow-overlap': false,
    'text-ignore-placement': false,
    'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
  },
  paint: {
    'text-color': '#1e293b',
    'text-halo-color': '#ffffff',
    'text-halo-width': 1.5,
  },
} satisfies LayerProps;

const transferLinesSolidLayer = {
  id: 'transfer-lines-solid',
  type: 'line' as const,
  filter: ['!=', ['get', 'dashed'], true],
  paint: {
    'line-color': ['get', 'color'],
    'line-width': 2,
    'line-opacity': 0.8,
  },
} satisfies LayerProps;

const transferLinesDashedLayer = {
  id: 'transfer-lines-dashed',
  type: 'line' as const,
  filter: ['==', ['get', 'dashed'], true],
  paint: {
    'line-color': ['get', 'color'],
    'line-width': 2,
    'line-opacity': 0.8,
    'line-dasharray': [2, 2],
  },
} satisfies LayerProps;

const poLinesLayer = {
  id: 'po-lines',
  type: 'line' as const,
  paint: {
    'line-color': PO_COLOR,
    'line-width': 2,
    'line-opacity': 0.7,
  },
} satisfies LayerProps;

export function GlobeVisualization({
  data,
  visibleLayers,
  onPointClick,
  onArcClick,
  width,
  height,
}: GlobeVisualizationProps) {
  const [hoverInfo, setHoverInfo] = useState<{
    lng: number;
    lat: number;
    name: string;
    typeLabel: string;
  } | null>(null);
  const [cursor, setCursor] = useState('grab');

  // ── Build points (locations + vendors) ──
  const { pointsGeoJSON, pointsLookup } = useMemo(() => {
    const features: Feature[] = [];
    const lookup: globalThis.Map<string, GlobePoint> = new globalThis.Map();

    if (visibleLayers.locations) {
      for (const loc of data.locations) {
        const point: GlobePoint = {
          id: loc.id,
          lat: loc.latitude,
          lng: loc.longitude,
          name: loc.name,
          type: 'location',
          color: getLocationColor(loc),
          typeLabel: getLocationTypeLabel(loc),
          data: loc,
        };
        lookup.set(loc.id, point);
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [loc.longitude, loc.latitude] },
          properties: { id: loc.id, name: loc.name, color: point.color, typeLabel: point.typeLabel, pointType: 'location' },
        });
      }
    }

    if (visibleLayers.vendors) {
      for (const vendor of data.vendors) {
        const point: GlobePoint = {
          id: vendor.id,
          lat: vendor.latitude,
          lng: vendor.longitude,
          name: vendor.name,
          type: 'vendor',
          color: VENDOR_COLOR,
          typeLabel: 'Vendor',
          data: vendor,
        };
        lookup.set(vendor.id, point);
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [vendor.longitude, vendor.latitude] },
          properties: { id: vendor.id, name: vendor.name, color: VENDOR_COLOR, typeLabel: 'Vendor', pointType: 'vendor' },
        });
      }
    }

    const geojson: FeatureCollection = { type: 'FeatureCollection', features };
    return { pointsGeoJSON: geojson, pointsLookup: lookup };
  }, [data.locations, data.vendors, visibleLayers.locations, visibleLayers.vendors]);

  // ── Build transfer lines ──
  const { transferGeoJSON, transferLookup } = useMemo(() => {
    const features: Feature[] = [];
    const lookup: globalThis.Map<string, GlobeArc> = new globalThis.Map();

    if (visibleLayers.transfers) {
      for (const transfer of data.transfers) {
        const from = transfer.from_location;
        const to = transfer.to_location;
        if (!from?.latitude || !from?.longitude || !to?.latitude || !to?.longitude) continue;

        const color = STATUS_COLORS[transfer.status || ''] || '#6b7280';
        const dashed = transfer.status === 'in_transit';

        const arc: GlobeArc = {
          id: transfer.id,
          startLat: from.latitude,
          startLng: from.longitude,
          endLat: to.latitude,
          endLng: to.longitude,
          type: 'transfer',
          status: transfer.status,
          data: transfer,
        };
        lookup.set(transfer.id, arc);

        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [from.longitude, from.latitude],
              [to.longitude, to.latitude],
            ],
          },
          properties: { id: transfer.id, color, dashed, arcType: 'transfer' },
        });
      }
    }

    const geojson: FeatureCollection = { type: 'FeatureCollection', features };
    return { transferGeoJSON: geojson, transferLookup: lookup };
  }, [data.transfers, visibleLayers.transfers]);

  // ── Build PO lines ──
  const { poGeoJSON, poLookup } = useMemo(() => {
    const features: Feature[] = [];
    const lookup: globalThis.Map<string, GlobeArc> = new globalThis.Map();

    if (visibleLayers.pos) {
      const vendorMap: globalThis.Map<string, GlobeVendor> = new globalThis.Map(data.vendors.map((v) => [v.id, v]));
      const locationMap: globalThis.Map<string, GlobeLocation> = new globalThis.Map(data.locations.map((l) => [l.id, l]));

      for (const po of data.purchaseOrders) {
        const vendor = vendorMap.get(po.vendor_id);
        const location = po.delivery_location_id ? locationMap.get(po.delivery_location_id) : null;
        if (!vendor || !location) continue;

        const arc: GlobeArc = {
          id: po.id,
          startLat: vendor.latitude,
          startLng: vendor.longitude,
          endLat: location.latitude,
          endLng: location.longitude,
          type: 'po',
          status: po.status,
          data: po,
        };
        lookup.set(po.id, arc);

        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [vendor.longitude, vendor.latitude],
              [location.longitude, location.latitude],
            ],
          },
          properties: { id: po.id, arcType: 'po' },
        });
      }
    }

    const geojson: FeatureCollection = { type: 'FeatureCollection', features };
    return { poGeoJSON: geojson, poLookup: lookup };
  }, [data.purchaseOrders, data.vendors, data.locations, visibleLayers.pos]);

  // ── Click handler ──
  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      const feature = (e as MapMouseEvent & { features?: Array<{ properties?: Record<string, unknown> }> }).features?.[0];
      if (!feature?.properties) return;

      const { id, pointType, arcType } = feature.properties;

      if (pointType) {
        const point = pointsLookup.get(id as string);
        if (point) onPointClick?.(point);
      } else if (arcType === 'transfer') {
        const arc = transferLookup.get(id as string);
        if (arc) onArcClick?.(arc);
      } else if (arcType === 'po') {
        const arc = poLookup.get(id as string);
        if (arc) onArcClick?.(arc);
      }
    },
    [pointsLookup, transferLookup, poLookup, onPointClick, onArcClick]
  );

  // ── Hover handler ──
  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      const feature = (e as MapMouseEvent & { features?: Array<{ properties?: Record<string, unknown> }> }).features?.[0];
      if (!feature?.properties) {
        setHoverInfo(null);
        setCursor('grab');
        return;
      }

      setCursor('pointer');
      const { id, pointType, arcType } = feature.properties;

      if (pointType) {
        const point = pointsLookup.get(id as string);
        if (point) {
          setHoverInfo({ lng: point.lng, lat: point.lat, name: point.name, typeLabel: point.typeLabel });
        }
      } else if (arcType === 'transfer') {
        const arc = transferLookup.get(id as string);
        if (arc) {
          const t = arc.data as GlobeTransfer;
          setHoverInfo({
            lng: e.lngLat.lng,
            lat: e.lngLat.lat,
            name: `Transfer (${t.status})`,
            typeLabel: `${t.transfer_lines.length} item(s)`,
          });
        }
      } else if (arcType === 'po') {
        const arc = poLookup.get(id as string);
        if (arc) {
          const po = arc.data as GlobePurchaseOrder;
          setHoverInfo({
            lng: e.lngLat.lng,
            lat: e.lngLat.lat,
            name: `PO ${po.po_number}`,
            typeLabel: po.status,
          });
        }
      }
    },
    [pointsLookup, transferLookup, poLookup]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverInfo(null);
    setCursor('grab');
  }, []);

  return (
    <MapboxMap
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{
        latitude: 39.8,
        longitude: -98.5,
        zoom: 4,
      }}
      style={{ width, height }}
      mapStyle="mapbox://styles/mapbox/light-v11"
      interactiveLayerIds={INTERACTIVE_LAYERS}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      cursor={cursor}
    >
      {/* Transfer lines */}
      <Source id="transfers" type="geojson" data={transferGeoJSON}>
        <Layer {...transferLinesSolidLayer} />
        <Layer {...transferLinesDashedLayer} />
      </Source>

      {/* PO lines */}
      <Source id="pos" type="geojson" data={poGeoJSON}>
        <Layer {...poLinesLayer} />
      </Source>

      {/* Points (on top of lines) */}
      <Source id="points" type="geojson" data={pointsGeoJSON}>
        <Layer {...pointsCircleLayer} />
        <Layer {...pointsLabelLayer} />
      </Source>

      {/* Hover popup */}
      {hoverInfo && (
        <Popup
          longitude={hoverInfo.lng}
          latitude={hoverInfo.lat}
          closeButton={false}
          closeOnClick={false}
          anchor="bottom"
          offset={12}
        >
          <div className="text-xs">
            <div className="font-semibold">{hoverInfo.name}</div>
            <div className="text-gray-500">{hoverInfo.typeLabel}</div>
          </div>
        </Popup>
      )}
    </MapboxMap>
  );
}
