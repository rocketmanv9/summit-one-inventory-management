import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const id = req.url.split('/kits/')[1]?.split('?')[0];
  if (!id) throw AppError.badRequest('Kit ID required');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const prov = (supabase as any).schema('provisioning');

  const { data: kit, error } = await prov
    .from('kits')
    .select('*, kit_lines(*)')
    .eq('id', id)
    .eq('tenant_id', session.tenantId!)
    .limit(1)
    .single();

  if (error || !kit) {
    throw AppError.notFound('Kit not found');
  }

  return Response.json({ data: kit });
}, { serviceName: SERVICE_NAME });

const UpdateKitSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
  last_event_id: z.string(),
  lines: z.array(z.object({
    id: z.string().uuid().optional(),
    catalog_item_id: z.string().uuid(),
    qty: z.number().int().min(1).default(1),
    is_required: z.boolean().default(true),
    size_source: z.enum(['employee_profile', 'fixed', 'ask_at_provision']).default('employee_profile'),
    fixed_variant_attributes: z.record(z.string(), z.string()).optional(),
    provider_id: z.string().uuid().optional().nullable(),
    substitute_catalog_item_id: z.string().uuid().optional().nullable(),
    sort_order: z.number().int().default(0),
  })).optional(),
});

export const PATCH = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = req.url.split('/kits/')[1]?.split('?')[0];
  if (!id) throw AppError.badRequest('Kit ID required');

  const body = UpdateKitSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  // Optimistic concurrency check
  const { data: existing } = await prov
    .from('kits')
    .select('last_event_id')
    .eq('id', id)
    .limit(1)
    .single();

  if (!existing) throw AppError.notFound('Kit not found');
  if (existing.last_event_id !== body.last_event_id) {
    throw AppError.conflict('Kit was modified by another user');
  }

  // Update kit
  const updateData: Record<string, unknown> = { last_event_id: idempotencyKey };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.is_active !== undefined) updateData.is_active = body.is_active;

  const { data: kit, error: kitError } = await prov
    .from('kits')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (kitError) {
    log.error('kit.update_failed', { error: kitError.message });
    throw AppError.internal(kitError.message);
  }

  // Replace kit lines if provided
  if (body.lines) {
    // Delete existing lines
    await prov.from('kit_lines').delete().eq('kit_id', id);

    // Insert new lines
    if (body.lines.length > 0) {
      const lines = body.lines.map((line, idx) => ({
        kit_id: id,
        tenant_id: kit.tenant_id,
        catalog_item_id: line.catalog_item_id,
        qty: line.qty,
        is_required: line.is_required,
        size_source: line.size_source,
        fixed_variant_attributes: line.fixed_variant_attributes,
        provider_id: line.provider_id,
        substitute_catalog_item_id: line.substitute_catalog_item_id,
        sort_order: line.sort_order ?? idx,
      }));

      const { error: linesError } = await prov
        .from('kit_lines')
        .upsert(lines, { onConflict: 'id' });

      if (linesError) {
        log.error('kit.lines_update_failed', { error: linesError.message });
        throw AppError.internal(linesError.message);
      }
    }
  }

  log.info('kit.updated', { kitId: id });

  return {
    data: kit,
    status: 200,
    events: [{
      event_name: 'kit.updated',
      payload: { kit_id: id },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/provisioning/kits/[id]' });
