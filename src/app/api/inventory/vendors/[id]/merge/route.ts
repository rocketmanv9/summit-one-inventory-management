/**
 * Vendor merge — fold a duplicate vendor into the real one.
 *
 * POST /api/inventory/vendors/[id]/merge
 *   [id] = the SOURCE (the duplicate to retire)
 *   body { target_vendor_id, preview? }
 *     preview: true  → read-only "what will move" counts (no mutation)
 *     preview: false → perform the merge (idempotent; a repeat is a no-op)
 *   → { data: { ...counts, source_vendor_id, target_vendor_id, target_vendor_name } }
 *
 * Everything the source owns (items, contacts, addresses, email domains, open
 * POs, performance history) is re-pointed to the target inside ONE transactional
 * RPC (supply_chain.rpc_merge_vendor) so a half-merge can't happen. Duplicates
 * are skipped rather than clobbering the target's data (same normalized
 * street+zip address, same lower(email) contact, same domain, same catalog item).
 * The source is then deactivated with merged_into_vendor_id/merged_at recorded.
 *
 * Events: the per-table triggers emit for moved child rows and the source's
 * deactivation (vendor.deactivated); the RPC also emits supply_chain.vendor.merged
 * for the merge itself. This route therefore returns events: [] — the DB owns
 * emission (emissionOwner: 'trigger'), consistent with the other vendor routes.
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const BodySchema = z.object({
  target_vendor_id: z.string().uuid('A target vendor is required'),
  preview: z.boolean().optional(),
});

function extractSourceId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('vendors') + 1];
  if (!id) throw AppError.badRequest('Missing vendor id');
  return id;
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'vendors.manage');
  const sourceId = extractSourceId(req);
  const { target_vendor_id: targetId, preview } = BodySchema.parse(await req.json());

  if (sourceId === targetId) {
    throw AppError.badRequest('Pick a different vendor to merge into — a vendor cannot merge into itself.');
  }

  const sc = (supabase as any).schema('supply_chain');

  // Resolve the target name up front so both preview and merge responses can name
  // the survivor (and to 404 clearly if either side is missing / wrong tenant).
  const { data: target, error: targetErr } = await sc
    .from('vendors')
    .select('id, name, active')
    .eq('id', targetId)
    .maybeSingle();
  if (targetErr) { log.error('vendor.merge.target_lookup_failed', { error: targetErr.message }); throw AppError.internal(targetErr.message); }
  if (!target) throw AppError.notFound('Target vendor not found');

  // ---- Preview (read-only): show what will move before the user confirms. -----
  if (preview) {
    const { data: rows, error } = await sc.rpc('rpc_merge_vendor_preview', {
      p_tenant_id: ctx.tenantId!,
      p_source_vendor_id: sourceId,
      p_target_vendor_id: targetId,
    });
    if (error) { log.error('vendor.merge.preview_failed', { error: error.message }); throw AppError.internal(error.message); }
    const p = (rows || [])[0] || {};
    return {
      data: {
        preview: true,
        source_vendor_id: sourceId,
        target_vendor_id: targetId,
        target_vendor_name: target.name,
        target_active: !!target.active,
        ...p,
      },
      status: 200,
      events: [],
    };
  }

  // ---- Merge (mutating, transactional, idempotent). ---------------------------
  const { data: rows, error } = await sc.rpc('rpc_merge_vendor', {
    p_tenant_id: ctx.tenantId!,
    p_source_vendor_id: sourceId,
    p_target_vendor_id: targetId,
    p_last_event_id: idempotencyKey,
  });
  if (error) {
    // Map the RPC's guard raises to clean HTTP statuses.
    const msg = error.message || 'Merge failed';
    if (/not found/i.test(msg)) throw AppError.notFound(msg);
    if (/into itself|different vendor|inactive vendor/i.test(msg)) throw AppError.conflict(msg);
    log.error('vendor.merge_failed', { error: msg, sourceId, targetId });
    throw AppError.internal(msg);
  }

  const result = (rows || [])[0] || {};
  return {
    data: {
      merged: true,
      source_vendor_id: sourceId,
      target_vendor_id: targetId,
      target_vendor_name: target.name,
      ...result,
    },
    status: 200,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors/[id]/merge' });
