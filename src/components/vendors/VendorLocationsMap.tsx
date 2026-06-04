'use client';

import { useMemo, useRef, useCallback, useState } from 'react';
import MapboxMap, { Source, Layer, Popup } from 'react-map-gl/mapbox';
import type { MapRef, MapMouseEvent, LayerProps } from 'react-map-gl/mapbox';
import type { Feature, FeatureCollection } from 'geojson';

/** A geocodable vendor address. Mirrors supply_chain.vendor_addresses fields the
 *  detail modal already loads — no coupling to the operations GlobeData shape. */
export interface VendorMapAddress {
  id: string;
  label?: string | null;
  address_type?: string | null;
  street1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface VendorLocationsMapProps {
  addresses: VendorMapAddress[];
  height?: number;
}

const VENDOR_COLOR = '#22c55e'; // green — matches the operations globe vendor pins
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
const INTERACTIVE_LAYERS = ['vendor-points-circle'];

// Layer styles mirror src/components/globe/GlobeVisualization.tsx (copied, not
// imported, to stay decoupled from the operations RPC types).
const pointsCircleLayer = {
  id: 'vendor-points-circle',
  type: 'circle' as const,
  paint: {
    'circle-radius': 8,
    'circle-color': VENDOR_COLOR,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
} satisfies LayerProps;

const pointsLabelLayer = {
  id: 'vendor-points-label',
  type: 'symbol' as const,
  layout: {
    'text-field': ['get', 'name'],
    'text-size': 11,
    'text-offset': [0, 1.4],
    'text-anchor': 'top' as const,
    'text-allow-overlap': false,
    'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
  },
  paint: {
    'text-color': '#ffffff',
    'text-halo-color': '#000000',
    'text-halo-width': 1.5,
  },
} satisfies LayerProps;

function addressLine(a: VendorMapAddress): string {
  return [a.street1, a.city, a.state, a.zip].filter(Boolean).join(', ') || 'No address details';
}

export function VendorLocationsMap({ addresses, height = 400 }: VendorLocationsMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ lng: number; lat: number; name: string; sub: string } | null>(null);
  const [cursor, setCursor] = useState('grab');

  const geocoded = useMemo(
    () => addresses.filter((a) => a.latitude != null && a.longitude != null),
    [addresses]
  );

  const { geojson, lookup, bounds, center } = useMemo(() => {
    const features: Feature[] = [];
    const map = new globalThis.Map<string, VendorMapAddress>();
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

    for (const a of geocoded) {
      const lng = a.longitude as number;
      const lat = a.latitude as number;
      const name = a.label || a.address_type || 'Location';
      map.set(a.id, a);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { id: a.id, name },
      });
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }

    const fc: FeatureCollection = { type: 'FeatureCollection', features };
    const hasBounds = Number.isFinite(minLng);
    return {
      geojson: fc,
      lookup: map,
      bounds: hasBounds ? ([[minLng, minLat], [maxLng, maxLat]] as [[number, number], [number, number]]) : null,
      center: hasBounds ? ([(minLng + maxLng) / 2, (minLat + maxLat) / 2] as [number, number]) : null,
    };
  }, [geocoded]);

  // Fit to all pins once the map (and style) are ready.
  const handleLoad = useCallback(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    const single = bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1];
    if (single) {
      map.flyTo({ center: bounds[0], zoom: 12, duration: 0 });
    } else {
      map.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 14 });
    }
  }, [bounds]);

  const handleMouseMove = useCallback((e: MapMouseEvent) => {
    const feature = (e as MapMouseEvent & { features?: Array<{ properties?: Record<string, unknown> }> }).features?.[0];
    if (!feature?.properties) { setHoverInfo(null); setCursor('grab'); return; }
    setCursor('pointer');
    const addr = lookup.get(feature.properties.id as string);
    if (addr) setHoverInfo({ lng: addr.longitude as number, lat: addr.latitude as number, name: addr.label || addr.address_type || 'Location', sub: addressLine(addr) });
  }, [lookup]);

  const handleMouseLeave = useCallback(() => { setHoverInfo(null); setCursor('grab'); }, []);

  if (geocoded.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground border rounded-lg bg-muted/20"
        style={{ height }}>
        <p className="font-medium text-foreground">No geocoded locations</p>
        <p className="mt-1 max-w-xs">
          Add or edit a location with a street address — it&apos;s geocoded on save and will appear here on the map.
        </p>
      </div>
    );
  }

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center text-center text-sm text-muted-foreground border rounded-lg bg-muted/20"
        style={{ height }}>
        Map unavailable — missing Mapbox token.
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border" style={{ height }}>
      <MapboxMap
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ longitude: center?.[0] ?? -98.5, latitude: center?.[1] ?? 39.8, zoom: 4 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        interactiveLayerIds={INTERACTIVE_LAYERS}
        onLoad={handleLoad}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        cursor={cursor}
      >
        <Source id="vendor-points" type="geojson" data={geojson}>
          <Layer {...pointsCircleLayer} />
          <Layer {...pointsLabelLayer} />
        </Source>

        {hoverInfo && (
          <Popup longitude={hoverInfo.lng} latitude={hoverInfo.lat} closeButton={false}
            closeOnClick={false} anchor="bottom" offset={12}>
            <div className="text-xs">
              <div className="font-semibold">{hoverInfo.name}</div>
              <div className="text-gray-500">{hoverInfo.sub}</div>
            </div>
          </Popup>
        )}
      </MapboxMap>
    </div>
  );
}
