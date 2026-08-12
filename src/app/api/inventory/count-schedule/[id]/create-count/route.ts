import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function getEntryId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('count-schedule');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing schedule entry ID');
  return id;
}

// Turns a planned calendar entry into a real cycle count, carrying over the
// template's location/type/blind/item scope and the assigned counter.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const entryId = getEntryId(req);
  const inv = (supabase as any).schema('inventory');

  const { data: entry, error: entryErr } = await inv
    .from('cycle_count_schedule')
    .select('*, template:cycle_count_templates(id, name, location_id, count_type, is_blind, catalog_item_ids)')
    .eq('id', entryId)
    .eq('tenant_id', ctx.tenantId)
    .single();

  if (entryErr || !entry) throw AppError.notFound('Schedule entry not found');
  if (entry.status !== 'planned') {
    throw AppError.badRequest(`Entry is '${entry.status}' — only planned entries can become counts`);
  }
  if (!entry.template) throw AppError.internal('Schedule entry has no template');

  // A 'partial' template scoped to "everything at the location" maps to a
  // full count — the RPC requires an item scope for partial.
  const effectiveType =
    entry.template.count_type === 'partial' && !entry.template.catalog_item_ids?.length
      ? 'full'
      : entry.template.count_type;

  const { data: countId, error: rpcErr } = await inv.rpc('rpc_inv_cycle_count_start', {
    p_tenant_id: ctx.tenantId,
    p_location_id: entry.template.location_id,
    p_count_type: effectiveType,
    p_catalog_item_ids: entry.template.catalog_item_ids || null,
    p_counted_by_user_id: entry.assigned_to_user_id || ctx.userId,
    p_last_event_id: idempotencyKey,
  });

  if (rpcErr) {
    log.error('count_schedule.create_count_failed', { entryId, error: rpcErr.message });
    throw AppError.internal(rpcErr.message);
  }

  // Carry the template's blind setting onto the new count
  if (entry.template.is_blind) {
    await inv.from('cycle_counts').update({ is_blind: true }).eq('id', countId);
  }

  const { error: updErr } = await inv
    .from('cycle_count_schedule')
    .update({
      status: 'generated',
      cycle_count_id: countId,
      last_event_id: idempotencyKey,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('tenant_id', ctx.tenantId);

  if (updErr) {
    log.error('count_schedule.mark_generated_failed', { entryId, error: updErr.message });
    throw AppError.internal(updErr.message);
  }

  log.info('count_schedule.count_created', { entryId, countId });

  return {
    data: { id: countId, schedule_entry_id: entryId },
    status: 201,
    events: [{
      event_name: 'cycle_count_schedule.materialized',
      payload: { entry_id: entryId, cycle_count_id: countId, template_id: entry.template.id },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/count-schedule/:id/create-count' });
