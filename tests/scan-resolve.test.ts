import { describe, it, expect, vi } from 'vitest';
import { resolveScanCode } from '@/lib/scan/resolve';

/**
 * Unit tests for the shared scan-code resolver (src/lib/scan/resolve.ts).
 *
 * The tenant-scoped `inv` client is stubbed with a thenable query builder
 * (same pattern as materialize-counts.test.ts) so we can script per-table /
 * per-column responses and assert the resolution order.
 */

/** Thenable builder whose terminal `.maybeSingle()` resolves the scripted row. */
function makeBuilder(rowFor: (col: string, val: string) => any) {
  const state: { col?: string; val?: string } = {};
  const builder: any = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.limit = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockImplementation((col: string, val: string) => {
    state.col = col;
    state.val = val;
    return builder;
  });
  builder.maybeSingle = vi.fn().mockImplementation(() =>
    Promise.resolve({ data: rowFor(state.col!, state.val!), error: null }),
  );
  return builder;
}

/** Build an `inv` stub from a map of `${table}.${column}=${value}` -> row. */
function makeInv(rows: Record<string, any>) {
  return {
    from: vi.fn().mockImplementation((table: string) =>
      makeBuilder((col, val) => rows[`${table}.${col}=${val}`] ?? null),
    ),
  };
}

describe('resolveScanCode', () => {
  it('resolves a serialized asset by asset_tag first', async () => {
    const inv = makeInv({
      'assets.asset_tag=AT-1': { id: 'asset-1', asset_tag: 'AT-1' },
    });
    const match = await resolveScanCode(inv as any, 'AT-1');
    expect(match).toEqual({ type: 'asset', entity: { id: 'asset-1', asset_tag: 'AT-1' }, href: '/inventory/assets' });
  });

  it('falls back to serial_number when asset_tag misses', async () => {
    const inv = makeInv({
      'assets.serial_number=SN-9': { id: 'asset-2', serial_number: 'SN-9' },
    });
    const match = await resolveScanCode(inv as any, 'SN-9');
    expect(match?.type).toBe('asset');
    expect((match?.entity as any).id).toBe('asset-2');
  });

  it('resolves a fungible catalog item by barcode (the mobile gap)', async () => {
    const inv = makeInv({
      'catalog_items.barcode=012345678905': { id: 'item-1', name: 'Widget', barcode: '012345678905' },
    });
    const match = await resolveScanCode(inv as any, '012345678905');
    expect(match).toEqual({
      type: 'catalog_item',
      entity: { id: 'item-1', name: 'Widget', barcode: '012345678905' },
      href: '/inventory/items',
    });
  });

  it('resolves a catalog item by sku when barcode misses', async () => {
    const inv = makeInv({
      'catalog_items.sku=WIDGET-001': { id: 'item-2', name: 'Widget', sku: 'WIDGET-001' },
    });
    const match = await resolveScanCode(inv as any, 'WIDGET-001');
    expect(match?.type).toBe('catalog_item');
    expect((match?.entity as any).id).toBe('item-2');
  });

  it('returns null when nothing matches (route turns this into a 404 / tool fallback)', async () => {
    const inv = makeInv({});
    const match = await resolveScanCode(inv as any, 'NOPE');
    expect(match).toBeNull();
  });

  it('rejects an empty code', async () => {
    const inv = makeInv({});
    await expect(resolveScanCode(inv as any, '   ')).rejects.toThrow();
  });
});
