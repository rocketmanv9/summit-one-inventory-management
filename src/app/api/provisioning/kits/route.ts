import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const prov = (supabase as any).schema('provisioning');

  const url = new URL(req.url);
  const activeOnly = url.searchParams.get('active') === 'true';

  let query = prov
    .from('kits')
    .select('*, kit_lines(count)')
    .eq('tenant_id', session.tenantId!)
    .order('name', { ascending: true })
    .limit(200);

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    log.error('kits.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

const CreateKitSchema = z.object({
  name: z.string().min(1, 'Kit name is required'),
  description: z.string().optional(),
  is_active: z.boolean().optional().default(true),
  lines: z.array(z.object({
    catalog_item_id: z.string().uuid(),
    qty: z.number().int().min(1).default(1),
    is_required: z.boolean().default(true),
    size_source: z.enum(['employee_profile', 'fixed', 'ask_at_provision']).default('employee_profile'),
    fixed_variant_attributes: z.record(z.string(), z.string()).optional(),
    provider_id: z.string().uuid().optional(),
    substitute_catalog_item_id: z.string().uuid().optional(),
    sort_order: z.number().int().default(0),
  })).optional().default([]),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const body = CreateKitSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  // Create kit
  const { data: kit, error: kitError } = await prov
    .from('kits')
    .upsert({
      name: body.name,
      description: body.description,
      is_active: body.is_active,
      last_event_id: idempotencyKey,
    }, { onConflict: 'last_event_id' })
    .select()
    .single();

  if (kitError) {
    log.error('kit.create_failed', { error: kitError.message });
    throw AppError.internal(kitError.message);
  }

  // Create kit lines
  if (body.lines.length > 0) {
    const lines = body.lines.map((line, idx) => ({
      kit_id: kit.id,
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
      log.error('kit.lines_create_failed', { error: linesError.message });
      throw AppError.internal(linesError.message);
    }
  }

  log.info('kit.created', { kitId: kit.id, lineCount: body.lines.length });

  return {
    data: kit,
    status: 201,
    events: [{
      event_name: 'kit.created',
      payload: { kit_id: kit.id, name: kit.name },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/kits' });
