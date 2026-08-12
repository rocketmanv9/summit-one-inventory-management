import { describe, it, expect } from 'vitest';
import { parseListLine, computeVendorSplit, CONSOLIDATE_THRESHOLD, type SplitLineInput } from '@/lib/shopping-list';

describe('parseListLine', () => {
  it('extracts a leading quantity', () => {
    expect(parseListLine('5 crackfill boxes')).toEqual({ qty: 5, query: 'crackfill boxes' });
    expect(parseListLine('5x tack coat')).toEqual({ qty: 5, query: 'tack coat' });
    expect(parseListLine('2 * traffic cones')).toEqual({ qty: 2, query: 'traffic cones' });
  });
  it('defaults qty to 1 when no leading number', () => {
    expect(parseListLine('traffic cones')).toEqual({ qty: 1, query: 'traffic cones' });
  });
  it('does not treat a SKU-like token as a quantity', () => {
    // No leading standalone number → whole line is the query.
    expect(parseListLine('RB4-500 rebar')).toEqual({ qty: 1, query: 'RB4-500 rebar' });
  });
});

const opt = (vendor_id: string, unit_cost: number | null, is_preferred = false) => ({
  vendor_id,
  vendor_name: vendor_id,
  unit_cost,
  is_preferred,
});

describe('computeVendorSplit', () => {
  it('flags items with no vendor option as unassigned on both splits', () => {
    const lines: SplitLineInput[] = [
      { catalog_item_id: 'a', qty: 1, name: 'A', options: [] },
      { catalog_item_id: 'b', qty: 1, name: 'B', options: [opt('V1', 10)] },
    ];
    const { recommended } = computeVendorSplit(lines);
    expect(recommended.unassigned_item_ids).toEqual(['a']);
    expect(recommended.buckets).toHaveLength(1);
    expect(recommended.total).toBe(10);
  });

  it('prefers the preferred vendor over a cheaper one', () => {
    const lines: SplitLineInput[] = [
      { catalog_item_id: 'a', qty: 2, name: 'A', options: [opt('cheap', 5), opt('pref', 8, true)] },
    ];
    const { recommended } = computeVendorSplit(lines);
    expect(recommended.buckets[0].vendor_id).toBe('pref');
    expect(recommended.total).toBe(16); // 2 × 8
  });

  it('offers consolidation when it stays within the threshold', () => {
    // V1 carries both items; item b is $1 cheaper at V2. Cheapest split = 2 vendors
    // ($10 + $9 = $19). Consolidating to V1 = $10 + $10 = $20, +5% ≤ 10% → offered.
    const lines: SplitLineInput[] = [
      { catalog_item_id: 'a', qty: 1, name: 'A', options: [opt('V1', 10)] },
      { catalog_item_id: 'b', qty: 1, name: 'B', options: [opt('V2', 9), opt('V1', 10)] },
    ];
    const res = computeVendorSplit(lines);
    expect(res.recommended.vendor_count).toBe(2);
    expect(res.recommended.total).toBe(19);
    expect(res.consolidated).not.toBeNull();
    expect(res.consolidated!.vendor_count).toBe(1);
    expect(res.consolidated!.total).toBe(20);
  });

  it('does NOT offer consolidation when it blows the threshold', () => {
    // Consolidating item b from $1 to $10 (V1) would be +90% over cheapest → not offered.
    const lines: SplitLineInput[] = [
      { catalog_item_id: 'a', qty: 1, name: 'A', options: [opt('V1', 10)] },
      { catalog_item_id: 'b', qty: 1, name: 'B', options: [opt('V2', 1), opt('V1', 10)] },
    ];
    const res = computeVendorSplit(lines);
    expect(res.recommended.vendor_count).toBe(2);
    expect(res.consolidated).toBeNull();
    expect(res.consolidation_note).toContain('over the');
  });

  it('reports a single-vendor list needs no split', () => {
    const lines: SplitLineInput[] = [
      { catalog_item_id: 'a', qty: 1, name: 'A', options: [opt('V1', 10)] },
      { catalog_item_id: 'b', qty: 1, name: 'B', options: [opt('V1', 5)] },
    ];
    const res = computeVendorSplit(lines);
    expect(res.recommended.vendor_count).toBe(1);
    expect(res.consolidated).toBeNull();
    expect(res.consolidation_note).toContain('single vendor');
  });

  it('exposes the documented 10% threshold', () => {
    expect(CONSOLIDATE_THRESHOLD).toBe(0.1);
  });
});
