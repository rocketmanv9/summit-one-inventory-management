'use client';

import { useState, useEffect, useMemo } from 'react';

export interface EquipmentClassOption {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  family_slug: string | null;
}

/**
 * Fetch the shared GV `equipment_classes` taxonomy from the proxy API.
 * Used to populate the equipment "Class" dropdown.
 */
export function useEquipmentClasses(): {
  classes: EquipmentClassOption[];
  loading: boolean;
  error: string | null;
} {
  const [classes, setClasses] = useState<EquipmentClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/gv/equipment/classes')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to fetch equipment classes (${res.status})`);
        }
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setClasses(json.data || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setClasses([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  return { classes, loading, error };
}

/** Returns an equipment_class id → name lookup map */
export function useEquipmentClassMap(): Record<string, string> {
  const { classes } = useEquipmentClasses();
  return useMemo(
    () => Object.fromEntries(classes.map((c) => [c.id, c.name])),
    [classes]
  );
}
