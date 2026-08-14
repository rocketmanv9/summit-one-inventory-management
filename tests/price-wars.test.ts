/**
 * Price wars — leaderboard + savings math (sprint 2026-08-14 item 09).
 *
 * The detection query itself is exercised live against stage (it needs real
 * vendor_items/PO rows to mean anything). What is worth pinning down here is
 * the pure arithmetic the arena leans on: ranking, who wears the crown, and
 * the two ways a savings number can be wrong (negative, or invented).
 */

import { describe, it, expect } from 'vitest';

import { rankBids, currentLow, roundSavings, spendWindowStart } from '@/lib/price-wars';

const bid = (over: Partial<any> = {}) => ({
  id: over.id ?? 'b1',
  vendor_id: over.vendor_id ?? 'v1',
  vendor_name: over.vendor_name ?? 'Vendor One',
  status: over.status ?? 'invited',
  baseline_unit_cost: over.baseline_unit_cost ?? null,
  current_quote: over.current_quote ?? null,
});

describe('rankBids', () => {
  it('ranks real quotes cheapest-first and crowns only the low', () => {
    const out = rankBids([
      bid({ id: 'a', vendor_name: 'Acme', status: 'quoted', current_quote: 41.5 }),
      bid({ id: 'b', vendor_name: 'Bravo', status: 'quoted', current_quote: 38.75 }),
      bid({ id: 'c', vendor_name: 'Cosmo', status: 'quoted', current_quote: 44 }),
    ]);
    expect(out.map((s) => s.vendor_name)).toEqual(['Bravo', 'Acme', 'Cosmo']);
    expect(out.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(out.filter((s) => s.is_low).map((s) => s.vendor_name)).toEqual(['Bravo']);
  });

  it('puts the not-yet-answered above the declined, and ranks neither', () => {
    const out = rankBids([
      bid({ id: 'a', vendor_name: 'Declined Co', status: 'declined' }),
      bid({ id: 'b', vendor_name: 'Quiet Co', status: 'invited' }),
      bid({ id: 'c', vendor_name: 'Quoted Co', status: 'quoted', current_quote: 10 }),
    ]);
    expect(out.map((s) => s.vendor_name)).toEqual(['Quoted Co', 'Quiet Co', 'Declined Co']);
    expect(out[1].rank).toBeNull();
    expect(out[2].rank).toBeNull();
  });

  it('never crowns a vendor whose status is quoted but whose price is missing', () => {
    const out = rankBids([bid({ status: 'quoted', current_quote: null })]);
    expect(out[0].is_low).toBe(false);
    expect(out[0].rank).toBeNull();
  });

  it('reports the move against their own baseline, negative when they came down', () => {
    const [s] = rankBids([bid({ status: 'quoted', baseline_unit_cost: 50, current_quote: 40 })]);
    expect(s.move_pct).toBe(-20);
  });

  it('has no move to report when we had no price with them before', () => {
    const [s] = rankBids([bid({ status: 'quoted', baseline_unit_cost: null, current_quote: 40 })]);
    expect(s.move_pct).toBeNull();
  });
});

describe('currentLow', () => {
  it('ignores invited and declined vendors entirely', () => {
    expect(currentLow([
      bid({ vendor_id: 'v1', status: 'invited', current_quote: 1 }),
      bid({ vendor_id: 'v2', status: 'declined', current_quote: 2 }),
      bid({ vendor_id: 'v3', vendor_name: 'Real', status: 'quoted', current_quote: 30 }),
    ])).toEqual({ unit_cost: 30, vendor_id: 'v3', vendor_name: 'Real' });
  });

  it('returns null when nobody has quoted — the counter prompt must not invent leverage', () => {
    expect(currentLow([bid({ status: 'invited' }), bid({ status: 'declined' })])).toBeNull();
  });
});

describe('roundSavings', () => {
  it('multiplies the drop by the quantity we said we would buy', () => {
    expect(roundSavings(8, 42.06, 36.2)).toBe(46.88);
  });

  it('floors at zero rather than reporting a negative saving', () => {
    expect(roundSavings(10, 20, 25)).toBe(0);
  });

  it('is null when either end of the comparison is missing', () => {
    expect(roundSavings(10, null, 25)).toBeNull();
    expect(roundSavings(10, 25, null)).toBeNull();
  });
});

describe('spendWindowStart', () => {
  it('looks back twelve months from today', () => {
    expect(spendWindowStart(new Date('2026-08-14T00:00:00Z'))).toBe('2025-08-14');
  });
});
