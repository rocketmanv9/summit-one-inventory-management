/**
 * Amazon purchaser gate — unified position + per-person access (item 07,
 * sprint 2026-08-17).
 *
 * canUserPunchOut widens who may punch out: the per-person registry
 * (supply_chain.amazon_purchaser_accounts) AND position-based access
 * (public.position_capabilities carrying `amazon.punchout`) both grant. These
 * tests pin the whole truth table so the widening can never silently lock out
 * anyone the seat check allowed before.
 *
 * Supabase is mocked with object stubs — no real DB.
 */

import { describe, it, expect } from 'vitest';

import {
  canUserPunchOut,
  AMAZON_PUNCHOUT_CAPABILITY,
  AMAZON_PURCHASER_REQUIRED,
  assertCanPunchOut,
} from '@/lib/amazon-access';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

/**
 * Build a mock supabase client.
 *
 * @param opts.registryCount   how many rows the tenant has in the purchaser registry
 * @param opts.seat            the caller's amazon_purchaser_accounts row (or null)
 * @param opts.localUser       the caller's local_users row (role/position_id) or null
 * @param opts.capabilityKeys  capability_keys for the caller's position, or null (unconfigured)
 */
function mockSupabase(opts: {
  registryCount: number;
  seat?: any;
  localUser?: { role?: string; position_id?: string | null } | null;
  capabilityKeys?: string[] | null;
}) {
  // supply_chain schema → amazon_purchaser_accounts
  const scFrom = () => {
    const builder: any = {
      _count: false,
      select(_cols: string, options?: { count?: string; head?: boolean }) {
        this._count = !!options?.count;
        return this;
      },
      eq() { return this; },
      order() { return this; },
      limit() { return this; },
      maybeSingle() {
        return Promise.resolve({ data: opts.seat ?? null, error: null });
      },
      then(resolve: any) {
        // Only the count query awaits the builder directly (head:true).
        return resolve({ count: opts.registryCount, data: [], error: null });
      },
    };
    return builder;
  };

  // public schema tables used by resolveUserCapabilities
  const publicFrom = (table: string) => {
    const builder: any = {
      select() { return this; },
      eq() { return this; },
      limit() { return this; },
      maybeSingle() {
        if (table === 'local_users') {
          return Promise.resolve({ data: opts.localUser ?? null, error: null });
        }
        if (table === 'position_capabilities') {
          if (opts.capabilityKeys == null) return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: { capability_keys: opts.capabilityKeys }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  };

  return {
    schema(_name: string) {
      return { from: scFrom };
    },
    from: publicFrom,
  } as any;
}

describe('canUserPunchOut — dormant registry', () => {
  it('empty registry allows everyone (dormant), regardless of user', async () => {
    const supabase = mockSupabase({ registryCount: 0 });
    const d = await canUserPunchOut(supabase, TENANT, USER);
    expect(d.allowed).toBe(true);
    expect(d.dormant).toBe(true);
    expect(d.via).toBeNull();
  });

  it('empty registry allows a missing userId too', async () => {
    const supabase = mockSupabase({ registryCount: 0 });
    const d = await canUserPunchOut(supabase, TENANT, null);
    expect(d.allowed).toBe(true);
    expect(d.dormant).toBe(true);
  });
});

describe('canUserPunchOut — per-person seat', () => {
  it('active seat with can_punch_out is allowed via registry', async () => {
    const supabase = mockSupabase({
      registryCount: 3,
      seat: { id: 'seat-1', user_id: USER, amazon_email: 'buyer@example.com', account_type: 'business', can_punch_out: true, active: true, notes: null },
    });
    const d = await canUserPunchOut(supabase, TENANT, USER);
    expect(d.allowed).toBe(true);
    expect(d.via).toBe('registry');
    expect(d.account?.id).toBe('seat-1');
  });

  it('non-empty registry with no user id is allowed (S2S, no person to gate)', async () => {
    const supabase = mockSupabase({ registryCount: 2 });
    const d = await canUserPunchOut(supabase, TENANT, null);
    expect(d.allowed).toBe(true);
    expect(d.via).toBe('registry');
  });
});

describe('canUserPunchOut — position grant fallback', () => {
  it('no seat but position carries amazon.punchout → allowed via position', async () => {
    const supabase = mockSupabase({
      registryCount: 4,
      seat: null,
      localUser: { role: 'member', position_id: 'pos-buyer' },
      capabilityKeys: ['purchasing', AMAZON_PUNCHOUT_CAPABILITY],
    });
    const d = await canUserPunchOut(supabase, TENANT, USER);
    expect(d.allowed).toBe(true);
    expect(d.via).toBe('position');
    expect(d.reason).toBeNull();
  });

  it('admin (full access) with no seat → allowed via position', async () => {
    const supabase = mockSupabase({
      registryCount: 4,
      seat: null,
      localUser: { role: 'admin', position_id: null },
    });
    const d = await canUserPunchOut(supabase, TENANT, USER);
    expect(d.allowed).toBe(true);
    expect(d.via).toBe('position');
  });

  it('inactive seat but position grants → allowed via position (widening, not lockout)', async () => {
    const supabase = mockSupabase({
      registryCount: 4,
      seat: { id: 'seat-x', user_id: USER, amazon_email: null, account_type: 'business', can_punch_out: true, active: false, notes: null },
      localUser: { role: 'member', position_id: 'pos-buyer' },
      capabilityKeys: [AMAZON_PUNCHOUT_CAPABILITY],
    });
    const d = await canUserPunchOut(supabase, TENANT, USER);
    expect(d.allowed).toBe(true);
    expect(d.via).toBe('position');
  });
});

describe('canUserPunchOut — genuine denial', () => {
  it('no seat AND position lacks amazon.punchout → soft denial (not_registered)', async () => {
    const supabase = mockSupabase({
      registryCount: 4,
      seat: null,
      localUser: { role: 'member', position_id: 'pos-warehouse' },
      capabilityKeys: ['inventory'],
    });
    const d = await canUserPunchOut(supabase, TENANT, USER);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('not_registered');
    expect(d.via).toBeNull();
    expect(d.message).toMatch(/Ask an admin/i);
  });

  it('inactive seat AND no position grant → soft denial keeps account_inactive reason', async () => {
    const supabase = mockSupabase({
      registryCount: 4,
      seat: { id: 'seat-y', user_id: USER, amazon_email: null, account_type: 'business', can_punch_out: true, active: false, notes: null },
      localUser: { role: 'member', position_id: 'pos-warehouse' },
      capabilityKeys: ['inventory'],
    });
    const d = await canUserPunchOut(supabase, TENANT, USER);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('account_inactive');
  });

  it('punchout-off seat AND no position grant → soft denial keeps punchout_disabled reason', async () => {
    const supabase = mockSupabase({
      registryCount: 4,
      seat: { id: 'seat-z', user_id: USER, amazon_email: null, account_type: 'business', can_punch_out: false, active: true, notes: null },
      localUser: { role: 'member', position_id: 'pos-warehouse' },
      capabilityKeys: ['inventory'],
    });
    const d = await canUserPunchOut(supabase, TENANT, USER);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('punchout_disabled');
  });

  it('assertCanPunchOut throws the soft 403 with the amazon_purchaser_required code', async () => {
    const supabase = mockSupabase({
      registryCount: 4,
      seat: null,
      localUser: { role: 'member', position_id: 'pos-warehouse' },
      capabilityKeys: ['inventory'],
    });
    await expect(assertCanPunchOut(supabase, TENANT, USER)).rejects.toMatchObject({
      code: AMAZON_PURCHASER_REQUIRED,
      statusCode: 403,
    });
  });
});
