import { z } from 'zod';
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  location_id: z.string().uuid(),
  count_type: z.enum(['full', 'partial', 'spot_check']).default('partial'),
  is_blind: z.boolean().default(false),
  catalog_item_ids: z.array(z.string().uuid()).nullable().optional(),
  frequency_per_year: z.number().int().min(1).max(365).default(4),
  active: z.boolean().default(true),
  notes: z.string().optional(),
});

export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('cycle_count_templates')
    .select('*, location:locations(id, name)')
    .eq('tenant_id', session.tenantId)
    .order('name')
    .limit(200);

  if (error) {
    log.error('count_templates.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = CreateTemplateSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('cycle_count_templates')
    .upsert({
      tenant_id: ctx.tenantId,
      name: body.name,
      description: body.description ?? null,
      location_id: body.location_id,
      count_type: body.count_type,
      is_blind: body.is_blind,
      catalog_item_ids: body.catalog_item_ids ?? null,
      frequency_per_year: body.frequency_per_year,
      active: body.active,
      notes: body.notes ?? null,
      last_event_id: idempotencyKey,
    })
    .select()
    .single();

  if (error) {
    log.error('count_template.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('count_template.created', { templateId: data.id, name: data.name });

  return {
    data,
    status: 201,
    events: [{
      event_name: 'cycle_count_template.created',
      payload: { template_id: data.id, name: data.name, location_id: data.location_id },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/count-templates' });
