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
  id?: string;
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
const PO_TRANSIT_COLOR = '#38bdf8'; // sky — shipments on the move

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
  'po-lines-transit',
  'shipment-points',
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
    'text-color': '#ffffff',
    'text-halo-color': '#000000',
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
  filter: ['!=', ['get', 'inTransit'], true],
  paint: {
    'line-color': PO_COLOR,
    'line-width': 2,
    'line-opacity': 0.7,
  },
} satisfies LayerProps;

const poLinesTransitLayer = {
  id: 'po-lines-transit',
  type: 'line' as const,
  filter: ['==', ['get', 'inTransit'], true],
  paint: {
    'line-color': PO_TRANSIT_COLOR,
    'line-width': 3,
    'line-opacity': 0.9,
    'line-dasharray': [2, 1.5],
  },
} satisfies LayerProps;

// In-flight packages: emoji markers positioned along the PO route
const shipmentPointsLayer = {
  id: 'shipment-points',
  type: 'symbol' as const,
  layout: {
    'text-field': '📦',
    'text-size': 22,
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  },
} satisfies LayerProps;

const shipmentLabelLayer = {
  id: 'shipment-labels',
  type: 'symbol' as const,
  layout: {
    'text-field': ['get', 'etaLabel'],
    'text-size': 10,
    'text-offset': [0, 1.6],
    'text-anchor': 'top' as const,
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
  },
  paint: {
    'text-color': '#bae6fd',
    'text-halo-color': '#0c4a6e',
    'text-halo-width': 1.5,
  },
} satisfies LayerProps;

export function GlobeVisualization({
  id,
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

  // ── Build PO lines + in-flight package markers ──
  const { poGeoJSON, poLookup, shipmentGeoJSON } = useMemo(() => {
    const features: Feature[] = [];
    const shipmentFeatures: Feature[] = [];
    const lookup: globalThis.Map<string, GlobeArc> = new globalThis.Map();

    if (visibleLayers.pos) {
      const vendorMap: globalThis.Map<string, GlobeVendor> = new globalThis.Map(data.vendors.map((v) => [v.id, v]));
      const locationMap: globalThis.Map<string, GlobeLocation> = new globalThis.Map(data.locations.map((l) => [l.id, l]));
      const now = Date.now();

      for (const po of data.purchaseOrders) {
        const vendor = vendorMap.get(po.vendor_id);
        const location = po.delivery_location_id ? locationMap.get(po.delivery_location_id) : null;
        if (!location) continue;

        const inTransit = po.status === 'in_transit';

        // Vendors with no geocode (e.g. Amazon Business has no street address)
        // can't anchor an arc — show their in-transit packages as a marker
        // hovering just above the delivery location instead.
        if (!vendor) {
          if (!inTransit) continue;
          const shipment = po.shipments?.length ? po.shipments[po.shipments.length - 1] : null;
          const etaSource = shipment?.delivery_date || po.expected_delivery_date;
          const eta = etaSource
            ? new Date(etaSource).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : null;

          lookup.set(po.id, {
            id: po.id,
            startLat: location.latitude,
            startLng: location.longitude,
            endLat: location.latitude,
            endLng: location.longitude,
            type: 'po',
            status: po.status,
            data: po,
          });
          shipmentFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [location.longitude, location.latitude + 0.012] },
            properties: {
              id: po.id,
              shipmentPo: true,
              poNumber: po.po_number,
              carrier: shipment?.carrier || 'Carrier',
              tracking: shipment?.tracking_number || '',
              etaLabel: eta ? `arrives ${eta}` : 'in transit',
            },
          });
          continue;
        }

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
          properties: { id: po.id, arcType: 'po', inTransit },
        });

        // Place a package marker along the route. Carriers don't expose live
        // GPS, so the position is estimated from time elapsed between the
        // ship date and the promised delivery date.
        const shipment = inTransit && po.shipments?.length ? po.shipments[po.shipments.length - 1] : null;
        if (shipment) {
          const shipTs = shipment.ship_date ? new Date(shipment.ship_date).getTime() : NaN;
          const etaTs = shipment.delivery_date ? new Date(shipment.delivery_date).getTime() : NaN;
          let progress = 0.5;
          if (!isNaN(shipTs) && !isNaN(etaTs) && etaTs > shipTs) {
            progress = Math.max(0.06, Math.min(0.94, (now - shipTs) / (etaTs - shipTs)));
          }
          const lng = vendor.longitude + (location.longitude - vendor.longitude) * progress;
          const lat = vendor.latitude + (location.latitude - vendor.latitude) * progress;
          const eta = shipment.delivery_date
            ? new Date(shipment.delivery_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : null;

          shipmentFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
              id: po.id,
              shipmentPo: true,
              poNumber: po.po_number,
              carrier: shipment.carrier || 'Carrier',
              tracking: shipment.tracking_number || '',
              etaLabel: eta ? `arrives ${eta}` : 'in transit',
            },
          });
        }
      }
    }

    const geojson: FeatureCollection = { type: 'FeatureCollection', features };
    const shipGeojson: FeatureCollection = { type: 'FeatureCollection', features: shipmentFeatures };
    return { poGeoJSON: geojson, poLookup: lookup, shipmentGeoJSON: shipGeojson };
  }, [data.purchaseOrders, data.vendors, data.locations, visibleLayers.pos]);

  // ── Click handler ──
  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      const feature = (e as MapMouseEvent & { features?: Array<{ properties?: Record<string, unknown> }> }).features?.[0];
      if (!feature?.properties) return;

      const { id, pointType, arcType, shipmentPo } = feature.properties;

      if (pointType) {
        const point = pointsLookup.get(id as string);
        if (point) onPointClick?.(point);
      } else if (arcType === 'transfer') {
        const arc = transferLookup.get(id as string);
        if (arc) onArcClick?.(arc);
      } else if (arcType === 'po' || shipmentPo) {
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
      const { id, pointType, arcType, shipmentPo, poNumber, carrier, tracking, etaLabel } = feature.properties;

      if (shipmentPo) {
        setHoverInfo({
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
          name: `📦 PO ${poNumber} — ${carrier}`,
          typeLabel: [etaLabel, tracking].filter(Boolean).join(' · '),
        });
        return;
      }

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
      id={id}
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{
        latitude: 39.8,
        longitude: -98.5,
        zoom: 4,
      }}
      style={{ width, height }}
      mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
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
        <Layer {...poLinesTransitLayer} />
      </Source>

      {/* Points (on top of lines) */}
      <Source id="points" type="geojson" data={pointsGeoJSON}>
        <Layer {...pointsCircleLayer} />
        <Layer {...pointsLabelLayer} />
      </Source>

      {/* In-flight packages (topmost) */}
      <Source id="shipments" type="geojson" data={shipmentGeoJSON}>
        <Layer {...shipmentPointsLayer} />
        <Layer {...shipmentLabelLayer} />
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
