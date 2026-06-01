'use client';

import { useState, useEffect, useCallback } from 'react';

type EntityType = 'catalog_item' | 'asset' | 'tool' | 'vehicle' | 'equipment';

interface UseEntityImageReturn {
  imageUrl: string | null;
  loading: boolean;
  uploading: boolean;
  error: string | null;
  upload: (imageData: string) => Promise<void>;
  remove: () => Promise<void>;
}

/**
 * Hook for managing a single entity's image.
 * Fetches the current image on mount, provides upload/remove actions.
 */
export function useEntityImage(entityType: EntityType, entityId: string | null): UseEntityImageReturn {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch current image
  useEffect(() => {
    if (!entityId) {
      setImageUrl(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/inventory/images?entity_type=${entityType}&entity_ids=${entityId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch image');
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          const match = (json.data || []).find((d: { entity_id: string }) => d.entity_id === entityId);
          setImageUrl(match?.public_url || null);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [entityType, entityId]);

  const upload = useCallback(async (imageData: string) => {
    if (!entityId) return;
    setUploading(true);
    setError(null);

    try {
      const res = await fetch('/api/inventory/images/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          image_data: imageData,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error?.message || err.error || 'Upload failed');
      }

      const json = await res.json();
      setImageUrl(json.data?.public_url || null);
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setUploading(false);
    }
  }, [entityType, entityId]);

  const remove = useCallback(async () => {
    if (!entityId) return;
    setUploading(true);
    setError(null);

    try {
      const res = await fetch('/api/inventory/images/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Delete failed' }));
        throw new Error(err.error?.message || err.error || 'Delete failed');
      }

      setImageUrl(null);
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setUploading(false);
    }
  }, [entityType, entityId]);

  return { imageUrl, loading, uploading, error, upload, remove };
}
