/**
 * Pure logic for Isabelle's restock ordering: how much to order and which
 * vendor gets each line. The DB/tool orchestration lives in src/lib/ai/restock.ts;
 * these tests pin the decision rules.
 */

import { describe, it, expect } from 'vitest';
import {
  suggestedOrderQty,
  pickVendorForItem,
  groupTotal,
  type VendorItemRow,
  type RestockGroup,
} from '../src/lib/ai/restock';

describe('suggestedOrderQty', () => {
  it('fills up to target_level when set', () => {
    expect(suggestedOrderQty({ qty_available: 3, reorder_point: 5, target_level: 20 })).toBe(17);
  });

  it('falls back to reorder_point as the target', () => {
    expect(suggestedOrderQty({ qty_available: 2, reorder_point: 10 })).toBe(8);
  });

  it('never orders less than the configured reorder_qty', () => {
    expect(suggestedOrderQty({ qty_available: 9, reorder_point: 10, reorder_qty: 25 })).toBe(25);
  });

  it('orders at least 1 even when barely below the point', () => {
    expect(suggestedOrderQty({ qty_available: 9.9, reorder_point: 10 })).toBe(1);
  });

  it('rounds fractional shortfalls up to whole units', () => {
    expect(suggestedOrderQty({ qty_available: 7.5, reorder_point: 10 })).toBe(3);
  });

  it('treats negative availability as extra shortfall', () => {
    expect(suggestedOrderQty({ qty_available: -4, reorder_point: 10 })).toBe(14);
  });
});

describe('pickVendorForItem', () => {
  const vi = (over: Partial<VendorItemRow>): VendorItemRow => ({
    vendor_id: 'v1',
    catalog_item_id: 'item1',
    unit_cost: null,
    last_known_price: null,
    is_preferred: false,
    active: true,
    ...over,
  });

  it("the item's own preferred vendor wins, with their price when listed", () => {
    const rows = [
      vi({ vendor_id: 'v-pref', unit_cost: 4.5 }),
      vi({ vendor_id: 'v-cheap', unit_cost: 3.0 }),
    ];
    expect(
      pickVendorForItem({ catalog_item_id: 'item1', preferred_vendor_id: 'v-pref' }, rows, 'v-yard'),
    ).toEqual({ vendor_id: 'v-pref', unit_cost: 4.5 });
  });

  it('item preferred vendor wins even with no price list entry (cost unknown)', () => {
    expect(
      pickVendorForItem({ catalog_item_id: 'item1', preferred_vendor_id: 'v-pref' }, [], 'v-yard'),
    ).toEqual({ vendor_id: 'v-pref', unit_cost: null });
  });

  it('a preferred vendor_items row beats a cheaper non-preferred one', () => {
    const rows = [
      vi({ vendor_id: 'v-flagged', unit_cost: 5, is_preferred: true }),
      vi({ vendor_id: 'v-cheap', unit_cost: 3 }),
    ];
    expect(
      pickVendorForItem({ catalog_item_id: 'item1', preferred_vendor_id: null }, rows, null),
    ).toEqual({ vendor_id: 'v-flagged', unit_cost: 5 });
  });

  it('otherwise the cheapest priced vendor wins, using last_known_price as fallback cost', () => {
    const rows = [
      vi({ vendor_id: 'v-a', last_known_price: 2.5 }),
      vi({ vendor_id: 'v-b', unit_cost: 4 }),
    ];
    expect(
      pickVendorForItem({ catalog_item_id: 'item1', preferred_vendor_id: null }, rows, 'v-yard'),
    ).toEqual({ vendor_id: 'v-a', unit_cost: 2.5 });
  });

  it('an unpriced vendor_items row still beats the yard default', () => {
    const rows = [vi({ vendor_id: 'v-a' })];
    expect(
      pickVendorForItem({ catalog_item_id: 'item1', preferred_vendor_id: null }, rows, 'v-yard'),
    ).toEqual({ vendor_id: 'v-a', unit_cost: null });
  });

  it('falls back to the yard preferred vendor when nothing item-specific exists', () => {
    expect(
      pickVendorForItem({ catalog_item_id: 'item1', preferred_vendor_id: null }, [], 'v-yard'),
    ).toEqual({ vendor_id: 'v-yard', unit_cost: null });
  });

  it('inactive price rows are ignored', () => {
    const rows = [vi({ vendor_id: 'v-a', unit_cost: 3, active: false })];
    expect(
      pickVendorForItem({ catalog_item_id: 'item1', preferred_vendor_id: null }, rows, null),
    ).toEqual({ vendor_id: null, unit_cost: null });
  });

  it("other items' price rows never leak in", () => {
    const rows = [vi({ vendor_id: 'v-a', catalog_item_id: 'other-item', unit_cost: 3 })];
    expect(
      pickVendorForItem({ catalog_item_id: 'item1', preferred_vendor_id: null }, rows, null),
    ).toEqual({ vendor_id: null, unit_cost: null });
  });
});

describe('groupTotal', () => {
  it('sums qty × cost, counting unpriced lines as zero', () => {
    const group: RestockGroup = {
      vendor_id: 'v1',
      vendor_name: 'ACME',
      vendor_email: null,
      ordering_mode: null,
      lines: [
        { catalog_item_id: 'a', name: 'A', sku: null, uom_term_id: null, qty: 10, unit_cost: 2.5 },
        { catalog_item_id: 'b', name: 'B', sku: null, uom_term_id: null, qty: 3, unit_cost: null },
      ],
    };
    expect(groupTotal(group)).toBe(25);
  });
});
