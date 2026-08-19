import { describe, it, expect } from 'vitest';
import { recommendWinner } from '@/lib/price-wars';

const bid = (over: Partial<any>) => ({
  id: over.id ?? crypto.randomUUID(),
  vendor_id: over.vendor_id ?? crypto.randomUUID(),
  vendor_name: over.vendor_name ?? 'Vendor',
  status: over.status ?? 'invited',
  baseline_unit_cost: over.baseline_unit_cost ?? 60,
  current_quote: over.current_quote ?? null,
  ...over,
});

describe('recommendWinner', () => {
  it('recommends nobody when no one has quoted', () => {
    const r = recommendWinner([
      bid({ vendor_name: 'A', status: 'invited' }),
      bid({ vendor_name: 'B', status: 'invited' }),
    ], { targetQty: 100, baseline: 60 });
    expect(r.has_recommendation).toBe(false);
    expect(r.winner_vendor_id).toBeNull();
    expect(r.awaiting_count).toBe(2);
  });

  it('picks the lowest quote and computes savings + runner-up', () => {
    const r = recommendWinner([
      bid({ vendor_name: 'A', status: 'quoted', current_quote: 41, baseline_unit_cost: 60 }),
      bid({ vendor_name: 'B', status: 'quoted', current_quote: 45, baseline_unit_cost: 60 }),
      bid({ vendor_name: 'C', status: 'invited', baseline_unit_cost: 60 }),
    ], { targetQty: 100, baseline: 60 });
    expect(r.has_recommendation).toBe(true);
    expect(r.winner_vendor_name).toBe('A');
    expect(r.winner_unit_cost).toBe(41);
    expect(r.runner_up_vendor_name).toBe('B');
    expect(r.runner_up_unit_cost).toBe(45);
    // (60 - 41) * 100
    expect(r.savings_vs_baseline).toBe(1900);
    expect(r.margin_over_runner_up).toBe(4);
    expect(r.awaiting_count).toBe(1);
    expect(r.awaiting_vendor_names).toEqual(['C']);
    expect(r.quoted[0].is_winner).toBe(true);
    expect(r.summary).toContain('Recommended: A');
  });

  it('recommends among those who replied when some are silent', () => {
    const r = recommendWinner([
      bid({ vendor_name: 'A', status: 'quoted', current_quote: 50, baseline_unit_cost: 60 }),
      bid({ vendor_name: 'B', status: 'invited' }),
    ], { targetQty: 10, baseline: 60 });
    expect(r.has_recommendation).toBe(true);
    expect(r.winner_vendor_name).toBe('A');
    expect(r.runner_up_vendor_name).toBeNull();
    expect(r.awaiting_count).toBe(1);
  });
});
