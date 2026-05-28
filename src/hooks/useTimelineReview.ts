'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useMap } from 'react-map-gl/mapbox';
import type { GlobeData } from '@/lib/rpc/operations';
import { getStoredAccessToken } from '@/lib/auth-token';
import type { TourStop } from '@/app/api/ai/timeline-review/route';

export type ReviewState = 'idle' | 'loading' | 'playing' | 'paused' | 'finished';

export interface TimelineReview {
  state: ReviewState;
  stops: TourStop[];
  currentIndex: number;
  currentStop: TourStop | null;
  error: string | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
}

function serializeEvents(data: GlobeData) {
  const events: Array<{
    id: string;
    type: 'transfer' | 'purchase_order';
    date: string;
    status: string;
    from_name: string | null;
    from_lat: number | null;
    from_lng: number | null;
    to_name: string | null;
    to_lat: number | null;
    to_lng: number | null;
    items: Array<{ name: string; qty: number }>;
    po_number?: string | null;
    vendor_name?: string | null;
  }> = [];

  // Build vendor lookup for POs
  const vendorMap = new Map(data.vendors.map(v => [v.id, v]));
  const locationMap = new Map(data.locations.map(l => [l.id, l]));

  for (const t of data.transfers) {
    if (!t.from_location?.latitude || !t.to_location?.latitude) continue;
    events.push({
      id: t.id,
      type: 'transfer',
      date: t.initiated_at || t.created_at,
      status: t.status,
      from_name: t.from_location.name,
      from_lat: t.from_location.latitude,
      from_lng: t.from_location.longitude,
      to_name: t.to_location.name,
      to_lat: t.to_location.latitude,
      to_lng: t.to_location.longitude,
      items: t.transfer_lines
        .filter(l => l.catalog_items)
        .map(l => ({ name: l.catalog_items!.name, qty: l.qty })),
    });
  }

  for (const po of data.purchaseOrders) {
    const vendor = vendorMap.get(po.vendor_id);
    const location = po.delivery_location_id ? locationMap.get(po.delivery_location_id) : null;
    if (!vendor || !location) continue;
    events.push({
      id: po.id,
      type: 'purchase_order',
      date: po.created_at,
      status: po.status,
      from_name: vendor.name,
      from_lat: vendor.latitude,
      from_lng: vendor.longitude,
      to_name: location.name,
      to_lat: location.latitude,
      to_lng: location.longitude,
      items: [],
      po_number: po.po_number,
      vendor_name: vendor.name,
    });
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Cap at 50
  return events.slice(0, 50);
}

function deriveDateRange(data: GlobeData): { start: string; end: string } {
  const dates: number[] = [];
  for (const t of data.transfers) dates.push(new Date(t.created_at).getTime());
  for (const po of data.purchaseOrders) dates.push(new Date(po.created_at).getTime());
  if (dates.length === 0) {
    const now = new Date().toISOString();
    return { start: now, end: now };
  }
  return {
    start: new Date(Math.min(...dates)).toISOString(),
    end: new Date(Math.max(...dates)).toISOString(),
  };
}

const FLY_DURATION = 2500;
const CARD_ENTER_MS = 300;
const CARD_HOLD_MS = 4000;
const CARD_EXIT_MS = 200;
const PAUSE_BETWEEN_MS = 500;

export function useTimelineReview(data: GlobeData | null, mapId = 'globe-map'): TimelineReview {
  const { [mapId]: mapRef } = useMap();
  const [state, setState] = useState<ReviewState>('idle');
  const [stops, setStops] = useState<TourStop[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  const indexRef = useRef(currentIndex);
  const stopsRef = useRef(stops);
  const pauseResolveRef = useRef<(() => void) | null>(null);

  stateRef.current = state;
  indexRef.current = currentIndex;
  stopsRef.current = stops;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const flyTo = useCallback((lat: number, lng: number, zoom: number, signal: AbortSignal): Promise<void> => {
    return new Promise((resolve, reject) => {
      const map = mapRef?.getMap();
      if (!map) { resolve(); return; }

      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }

      const onAbort = () => {
        map.stop();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      const onMoveEnd = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };

      map.once('moveend', onMoveEnd);
      map.flyTo({
        center: [lng, lat],
        zoom,
        duration: FLY_DURATION,
        curve: 1.42,
      });
    });
  }, [mapRef]);

  const wait = useCallback((ms: number, signal: AbortSignal): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }, []);

  const waitForResume = useCallback((signal: AbortSignal): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      // If already playing, resolve immediately
      if (stateRef.current === 'playing') { resolve(); return; }

      pauseResolveRef.current = resolve;

      const onAbort = () => {
        pauseResolveRef.current = null;
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }, []);

  const runSequence = useCallback(async (tourStops: TourStop[], signal: AbortSignal) => {
    for (let i = 0; i < tourStops.length; i++) {
      if (signal.aborted) return;

      // Check for pause
      if (stateRef.current === 'paused') {
        await waitForResume(signal);
      }

      const stop = tourStops[i];
      setCurrentIndex(i);

      // Fly to location
      try {
        await flyTo(stop.focus_lat, stop.focus_lng, stop.focus_zoom, signal);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        throw e;
      }

      // Card enter + hold
      await wait(CARD_ENTER_MS + CARD_HOLD_MS, signal);

      // Card exit + pause between stops
      if (i < tourStops.length - 1) {
        await wait(CARD_EXIT_MS + PAUSE_BETWEEN_MS, signal);
      }
    }

    // Hold on last card
    await wait(CARD_HOLD_MS, signal);

    setState('finished');
  }, [flyTo, wait, waitForResume]);

  const start = useCallback(async () => {
    if (!data) return;

    const events = serializeEvents(data);
    if (events.length === 0) {
      setError('Not enough activity to review');
      return;
    }

    // Abort any existing sequence
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState('loading');
    setError(null);
    setStops([]);
    setCurrentIndex(-1);

    try {
      const token = getStoredAccessToken();
      const res = await fetch('/api/ai/timeline-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          events,
          date_range: deriveDateRange(data),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      const json = await res.json();
      const tourStops: TourStop[] = json.data?.stops || [];

      if (tourStops.length === 0) {
        throw new Error('AI returned no tour stops');
      }

      setStops(tourStops);
      setState('playing');

      // Start the flyTo sequence
      await runSequence(tourStops, controller.signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message || 'Failed to generate review');
      setState('idle');
    }
  }, [data, runSequence]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState('idle');
    setStops([]);
    setCurrentIndex(-1);
    setError(null);
    pauseResolveRef.current = null;
  }, []);

  const pause = useCallback(() => {
    if (stateRef.current === 'playing') {
      setState('paused');
    }
  }, []);

  const resume = useCallback(() => {
    if (stateRef.current === 'paused') {
      setState('playing');
      // Release the pending waitForResume promise
      if (pauseResolveRef.current) {
        pauseResolveRef.current();
        pauseResolveRef.current = null;
      }
    }
  }, []);

  const next = useCallback(() => {
    const currentStops = stopsRef.current;
    const idx = indexRef.current;
    if (idx < currentStops.length - 1) {
      const nextStop = currentStops[idx + 1];
      setCurrentIndex(idx + 1);
      const map = mapRef?.getMap();
      if (map) {
        map.flyTo({
          center: [nextStop.focus_lng, nextStop.focus_lat],
          zoom: nextStop.focus_zoom,
          duration: FLY_DURATION,
          curve: 1.42,
        });
      }
    }
  }, [mapRef]);

  const prev = useCallback(() => {
    const currentStops = stopsRef.current;
    const idx = indexRef.current;
    if (idx > 0) {
      const prevStop = currentStops[idx - 1];
      setCurrentIndex(idx - 1);
      const map = mapRef?.getMap();
      if (map) {
        map.flyTo({
          center: [prevStop.focus_lng, prevStop.focus_lat],
          zoom: prevStop.focus_zoom,
          duration: FLY_DURATION,
          curve: 1.42,
        });
      }
    }
  }, [mapRef]);

  const currentStop = currentIndex >= 0 && currentIndex < stops.length ? stops[currentIndex] : null;

  return {
    state,
    stops,
    currentIndex,
    currentStop,
    error,
    start,
    pause,
    resume,
    next,
    prev,
    stop,
  };
}
