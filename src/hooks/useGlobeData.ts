'use client';

import { useState, useEffect, useCallback } from 'react';
import { OperationsRPC, type GlobeData, type GlobeFilters } from '@/lib/rpc/operations';

export function useGlobeData(filters?: GlobeFilters) {
  const [data, setData] = useState<GlobeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await OperationsRPC.getGlobeData(filters);
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load globe data');
    } finally {
      setLoading(false);
    }
  }, [
    filters?.transfer_status,
    filters?.date_from,
    filters?.date_to,
    filters?.show_vendors,
    filters?.show_pos,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
