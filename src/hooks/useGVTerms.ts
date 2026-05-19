'use client';

import { useState, useEffect, useMemo } from 'react';

export interface GVTerm {
  term_id: string;
  label: string;
}

/**
 * Fetch GV terms for a given domain from the proxy API.
 * Caches in component state — refetches on domain change.
 */
export function useGVTerms(domain: string): { terms: GVTerm[]; loading: boolean; error: string | null } {
  const [terms, setTerms] = useState<GVTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!domain) {
      setTerms([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/gv/terms?domain=${encodeURIComponent(domain)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to fetch terms (${res.status})`);
        }
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setTerms(json.data || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setTerms([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [domain]);

  return { terms, loading, error };
}

/** UOM terms from the GV `uom` domain */
export function useUOMTerms() {
  return useGVTerms('uom');
}

/** Item category terms from the GV `item_category` domain */
export function useItemCategoryTerms() {
  return useGVTerms('item_category');
}

/** Vendor type terms from the GV `vendor_type` domain */
export function useVendorTypeTerms() {
  return useGVTerms('vendor_type');
}

/** Returns a term_id → label lookup map for UOM terms */
export function useUOMLabelMap(): Record<string, string> {
  const { terms } = useUOMTerms();
  return useMemo(
    () => Object.fromEntries(terms.map((t) => [t.term_id, t.label])),
    [terms]
  );
}
