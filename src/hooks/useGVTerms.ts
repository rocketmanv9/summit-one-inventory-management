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

/** Material terms from the GV `materials` domain */
export function useMaterialTerms() {
  return useGVTerms('materials');
}

/** Material product terms from the GV `material_product` domain */
export function useMaterialProductTerms() {
  return useGVTerms('material_product');
}

/** Quality tier terms from the GV `quality_tier` domain */
export function useQualityTierTerms() {
  return useGVTerms('quality_tier');
}

/** Vehicle type terms from the GV `vehicle_type` domain */
export function useVehicleTypeTerms() {
  return useGVTerms('vehicle_type');
}

/** Equipment type terms from the GV `equipment_type` domain */
export function useEquipmentTypeTerms() {
  return useGVTerms('equipment_type');
}

/** Tool type terms from the GV `tool_type` domain */
export function useToolTypeTerms() {
  return useGVTerms('tool_type');
}

/**
 * Maps an asset_kind to the GV term domain that classifies it. Returns '' for
 * kinds with no GV type domain (e.g. 'other' or unclassified), which `useGVTerms`
 * treats as a no-op.
 */
export function assetKindToTypeDomain(assetKind: string | null | undefined): string {
  switch (assetKind) {
    case 'vehicle': return 'vehicle_type';
    case 'equipment': return 'equipment_type';
    case 'tool': return 'tool_type';
    default: return '';
  }
}

/** Returns a term_id → label lookup map for UOM terms */
export function useUOMLabelMap(): Record<string, string> {
  const { terms } = useUOMTerms();
  return useMemo(
    () => Object.fromEntries(terms.map((t) => [t.term_id, t.label])),
    [terms]
  );
}

/** Returns a term_id → label lookup map for any GV domain */
export function useGVLabelMap(domain: string): Record<string, string> {
  const { terms } = useGVTerms(domain);
  return useMemo(
    () => Object.fromEntries(terms.map((t) => [t.term_id, t.label])),
    [terms]
  );
}
