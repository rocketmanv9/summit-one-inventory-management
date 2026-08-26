/**
 * Dismiss a vendor duplicate pair — "these are NOT the same company".
 *
 * POST /api/inventory/vendors/duplicates/dismiss
 *   body { vendor_a_id, vendor_b_id }   (either order — normalized server-side)
 *   → { data: { dismissed: true, vendor_a_id, vendor_b_id } }
 *
 * Persists to supply_chain.vendor_duplicate_dismissals with normalized ordering
 * (vendor_a_id < vendor_b_id — the same uuid ordering rpc_vendor_duplicate_pairs
 * emits), so the duplicates GET route filters the pair out of every future scan.
 * Upsert on the pair key makes a repeat dismissal a harmless no-op.
 *
 * Gated on vendors.manage, same as merge — dismissing hides the pair for the
 * whole tenant, so it's an admin decision.
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const BodySchema = z.object({
  vendor_a_id: z.string().uuid(),
  vendor_b_id: z.string().uuid(),
});

/**
 * Normalize to the canonical (a < b) ordering. Lowercase-hex string comparison
 * of canonical uuids matches Postgres uuid ordering (both are big-endian
 * byte-wise), so this agrees with the table's CHECK constraint and with the
 * ordering the pairs RPC emits.
 */
function normalizePair(x: string, y: string): [string, string] {
  const a = x.toLowerCase();
  const b = y.toLowerCase();
  return a < b ? [a, b] : [b, a];
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'vendors.manage');
  const body = BodySchema.parse(await req.json());

  if (body.vendor_a_id.toLowerCase() === body.vendor_b_id.toLowerCase()) {
    throw AppError.badRequest('A pair needs two different vendors.');
  }
  const [aId, bId] = normalizePair(body.vendor_a_id, body.vendor_b_id);

  const sc = (supabase as any).schema('supply_chain');

  // Both sides must be real vendors in this tenant — keeps junk pairs out.
  const { data: found, error: lookupErr } = await sc
    .from('vendors')
    .select('id')
    .in('id', [aId, bId])
    .limit(2);
  if (lookupErr) {
    log.error('vendor.duplicate_dismiss.lookup_failed', { error: lookupErr.message });
    throw AppError.internal(lookupErr.message);
  }
  if ((found || []).length < 2) throw AppError.notFound('One or both vendors not found');

  const { data: row, error } = await sc
    .from('vendor_duplicate_dismissals')
    .upsert(
      {
        tenant_id: ctx.tenantId!,
        vendor_a_id: aId,
        vendor_b_id: bId,
        dismissed_by: ctx.userId ?? null,
        dismissed_at: new Date().toISOString(),
        last_event_id: idempotencyKey,
      },
      { onConflict: 'tenant_id,vendor_a_id,vendor_b_id' },
    )
    .select('id, vendor_a_id, vendor_b_id, dismissed_at')
    .single();
  if (error) {
    log.error('vendor.duplicate_dismiss_failed', { error: error.message, aId, bId });
    throw AppError.internal(error.message);
  }

  return {
    data: { dismissed: true, vendor_a_id: aId, vendor_b_id: bId, dismissed_at: row?.dismissed_at },
    status: 200,
    events: [{
      event_name: 'vendor_duplicate.dismissed',
      payload: { vendor_a_id: aId, vendor_b_id: bId, dismissed_by: ctx.userId ?? null },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors/duplicates/dismiss' });
