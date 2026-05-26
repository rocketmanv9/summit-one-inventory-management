'use client';

import { useState, useEffect } from 'react';

type EntityType = 'catalog_item' | 'asset' | 'tool' | 'vehicle' | 'equipment';

/**
 * Hook for batch-fetching images for a list of entities.
 * Returns a map of entity_id -> public_url for use in list/table views.
 */
export function useEntityImages(
  entityType: EntityType,
  entityIds: string[]
): { imageMap: Record<string, string>; loading: boolean } {
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (entityIds.length === 0) {
      setImageMap({});
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Deduplicate and batch (max 100 per request)
    const uniqueIds = [...new Set(entityIds)];
    const batches: string[][] = [];
    for (let i = 0; i < uniqueIds.length; i += 100) {
      batches.push(uniqueIds.slice(i, i + 100));
    }

    Promise.all(
      batches.map((batch) =>
        fetch(`/api/inventory/images?entity_type=${entityType}&entity_ids=${batch.join(',')}`)
          .then((res) => (res.ok ? res.json() : { data: [] }))
          .then((json) => json.data || [])
      )
    )
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const batch of results) {
          for (const item of batch) {
            map[item.entity_id] = item.public_url;
          }
        }
        setImageMap(map);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  // Stringify IDs to avoid infinite re-renders from array reference changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityIds.join(',')]);

  return { imageMap, loading };
}
