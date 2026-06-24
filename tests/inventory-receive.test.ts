import { describe, it, expect, vi } from 'vitest';
import { receiveStock } from '@/lib/inventory/receive';

/**
 * Unit tests for additive scan-to-receive (src/lib/inventory/receive.ts).
 * The tenant-scoped `inv` client is stubbed with a thenable balance builder
 * plus a scriptable `rpc`.
 */

function makeBalanceBuilder(data: any, error: any = null) {
  const builder: any = {};
  for (const m of ['select', 'eq', 'limit']) builder[m] = vi.fn().mockReturnValue(builder);
  builder.then = (resolve: any, reject: any) =>
    Promise.resolve({ data, error }).then(resolve, reject);
  return builder;
}

function makeInv(opts: { balance?: any[]; balanceError?: any; rpcResult?: { data?: any; error?: any } }) {
  const rpc = vi.fn().mockResolvedValue(opts.rpcResult ?? { data: { success: true }, error: null });
  return {
    from: vi.fn().mockReturnValue(makeBalanceBuilder(opts.balance ?? [], opts.balanceError ?? null)),
    rpc,
    _rpc: rpc,
  };
}

describe('receiveStock', () => {
  it('adds quantity to the existing on-hand and calls rpc_adjust_inventory with the absolute target', async () => {
    const inv = makeInv({ balance: [{ qty_on_hand: 5 }] });
    const result = await receiveStock(inv as any, {
      catalogItemId: 'item-1',
      locationId: 'loc-1',
      quantity: 10,
    });

    expect(result).toEqual({
      item_id: 'item-1',
      location_id: 'loc-1',
      quantity_added: 10,
      previous_qty: 5,
      new_qty: 15,
    });
    expect(inv._rpc).toHaveBeenCalledWith(
      'rpc_adjust_inventory',
      expect.objectContaining({
        p_catalog_item_id: 'item-1',
        p_location_id: 'loc-1',
        p_new_qty: 15,
      }),
    );
  });

  it('treats a missing balance row as 0 on-hand', async () => {
    const inv = makeInv({ balance: [] });
    const result = await receiveStock(inv as any, {
      catalogItemId: 'item-2',
      locationId: 'loc-1',
      quantity: 3,
    });
    expect(result.previous_qty).toBe(0);
    expect(result.new_qty).toBe(3);
  });

  it('surfaces a guardrail block as a 400 (does not silently succeed)', async () => {
    const inv = makeInv({
      balance: [{ qty_on_hand: 0 }],
      rpcResult: { data: { success: false, error: { message: 'Over-receipt blocked' } }, error: null },
    });
    await expect(
      receiveStock(inv as any, { catalogItemId: 'item-3', locationId: 'loc-1', quantity: 999 }),
    ).rejects.toThrow(/Over-receipt blocked/);
  });

  it('rejects a non-positive quantity before touching the DB', async () => {
    const inv = makeInv({});
    await expect(
      receiveStock(inv as any, { catalogItemId: 'item-4', locationId: 'loc-1', quantity: 0 }),
    ).rejects.toThrow();
    expect(inv._rpc).not.toHaveBeenCalled();
  });

  it('throws when the balance read fails', async () => {
    const inv = makeInv({ balanceError: { message: 'boom' } });
    await expect(
      receiveStock(inv as any, { catalogItemId: 'item-5', locationId: 'loc-1', quantity: 1 }),
    ).rejects.toThrow(/boom/);
  });
});
