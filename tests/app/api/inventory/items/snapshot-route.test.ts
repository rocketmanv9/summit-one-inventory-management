import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression guard for the 2026-08-06 "snapshot failed" bug.
 *
 * ROOT CAUSE: `rpc_item_stock_snapshot` (SECURITY DEFINER) resolved tenant via
 * `current_tenant_id()`, which for the service-role client depended on the
 * `app.current_tenant_id` GUC set by a SEPARATE prior `set_claim` request. Over
 * PostgREST connection pooling that GUC did not reliably survive to the snapshot
 * call, so the RPC intermittently saw a NULL tenant and raised
 * "Authentication required" — surfaced to the mobile app as an opaque
 * "Snapshot failed". The transfer sheet's "no stock on hand at any location"
 * was the same failure (empty snapshot -> empty fromOptions).
 *
 * FIX: the route now passes `p_tenant_id: session.tenantId` so tenant resolution
 * is atomic within the single RPC call, and surfaces the underlying error
 * instead of a generic message.
 *
 * These tests assert the FIX at the route boundary — the call path the mobile
 * `inventoryFetch` bridge exercises — using chassis mocks (no live DB).
 */

const TENANT = '052abee2-ffdc-470e-975a-b917dde72b8e';
const ITEM = '79e9f23a-b79b-4301-85f0-5a7a9c26d8e9';

// Spy the RPC so we can assert exactly what the route passes to Postgres.
const rpcSpy = vi.fn();

vi.mock('@rocketmanv9/chassis/nextjs', () => ({
  // Pass-through factory: return a handler that injects a session + logger,
  // mirroring createSessionReadRoute without the cookie/tracing machinery.
  createSessionReadRoute: (handler: any) => {
    return async (req: Request) =>
      handler({
        req,
        session: { tenantId: TENANT, userId: 'test-user' },
        log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      });
  },
}));

vi.mock('@rocketmanv9/chassis/supabase', () => ({
  createTenantServiceClient: vi.fn(async () => ({
    schema: () => ({ rpc: rpcSpy }),
  })),
}));

// Real AppError so the route's error mapping (status codes, messages) is exercised.
vi.mock('@rocketmanv9/chassis/errors', async () => {
  const mk = (status: number) => (msg: string) => {
    const e: any = new Error(msg);
    e.statusCode = status;
    e.appError = true;
    return e;
  };
  return {
    AppError: {
      badRequest: mk(400),
      notFound: mk(404),
      internal: mk(500),
    },
  };
});

import { GET } from '@/app/api/inventory/items/[id]/snapshot/route';

function reqFor(id: string) {
  return new Request(`http://localhost/api/inventory/items/${id}/snapshot`);
}

describe('GET /api/inventory/items/[id]/snapshot — tenant is passed explicitly', () => {
  beforeEach(() => {
    rpcSpy.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('calls rpc_item_stock_snapshot with p_tenant_id from the session (the fix)', async () => {
    rpcSpy.mockResolvedValue({
      data: { on_hand: 2, reserved: 0, available: 2, locations: [], item: { id: ITEM } },
      error: null,
    });

    const res = await GET(reqFor(ITEM));
    expect(res.status).toBe(200);

    // The regression: tenant MUST travel inside the same RPC call, not rely on a
    // prior set_claim request's GUC surviving connection pooling.
    expect(rpcSpy).toHaveBeenCalledWith(
      'rpc_item_stock_snapshot',
      expect.objectContaining({ p_catalog_item_id: ITEM, p_tenant_id: TENANT }),
    );
  });

  it('surfaces the underlying RPC error instead of an opaque "Snapshot failed"', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Authentication required' },
    });

    await expect(GET(reqFor(ITEM))).rejects.toMatchObject({
      statusCode: 500,
      // The message now includes the real cause — the swallowed generic string
      // is what made the original bug expensive to diagnose.
      message: expect.stringContaining('Authentication required'),
    });
  });

  it('maps "not found" RPC errors to 404', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Item not found' },
    });

    await expect(GET(reqFor(ITEM))).rejects.toMatchObject({ statusCode: 404 });
  });
});
