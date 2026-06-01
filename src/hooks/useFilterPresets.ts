'use client';

import { useState, useEffect, useCallback } from 'react';
import { getAuthToken } from '@/lib/auth-token';
import type { GlobeFilters } from '@/lib/rpc/operations';
import type { VisibleLayers } from '@/components/globe/GlobeVisualization';

export interface FilterPresetConfig {
  filters: GlobeFilters;
  visibleLayers: VisibleLayers;
  transferStatuses: string[];
  poStatuses: string[];
}

export interface FilterPreset {
  id: string;
  name: string;
  config: FilterPresetConfig;
  created_at: string;
  updated_at: string;
}

const API_BASE = '/api/operations/globe/presets';

export function useFilterPresets() {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(API_BASE, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load presets');
      const json = await res.json();
      setPresets(json.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load presets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const savePreset = useCallback(async (name: string, config: FilterPresetConfig) => {
    const optimistic: FilterPreset = {
      id: crypto.randomUUID(),
      name,
      config,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Optimistic update: replace existing by name or append
    setPresets((prev) => {
      const without = prev.filter((p) => p.name !== name);
      return [...without, optimistic].sort((a, b) => a.name.localeCompare(b.name));
    });

    try {
      const token = await getAuthToken();
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Write route requires an idempotency key, else 400 (save silently failed).
          'X-Idempotency-Key': crypto.randomUUID(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ name, config }),
      });
      if (!res.ok) throw new Error('Failed to save preset');
      const json = await res.json();
      // Replace optimistic entry with server response
      setPresets((prev) =>
        prev
          .map((p) => (p.id === optimistic.id ? json.data : p))
          .sort((a: FilterPreset, b: FilterPreset) => a.name.localeCompare(b.name)),
      );
    } catch {
      // Rollback optimistic update
      await fetchPresets();
    }
  }, [fetchPresets]);

  const deletePreset = useCallback(async (id: string) => {
    const previous = presets;
    // Optimistic removal
    setPresets((prev) => prev.filter((p) => p.id !== id));

    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/${id}`, {
        method: 'DELETE',
        headers: {
          'X-Idempotency-Key': crypto.randomUUID(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete preset');
    } catch {
      // Rollback
      setPresets(previous);
    }
  }, [presets]);

  return { presets, loading, error, savePreset, deletePreset, refetch: fetchPresets };
}
