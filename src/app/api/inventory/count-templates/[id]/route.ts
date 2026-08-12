import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { rethrowDeleteError } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  location_id: z.string().uuid().optional(),
  count_type: z.enum(['full', 'partial', 'spot_check']).optional(),
  is_blind: z.boolean().optional(),
  catalog_item_ids: z.array(z.string().uuid()).nullable().optional(),
  frequency_per_year: z.number().int().min(1).max(365).optional(),
  active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

function getTemplateId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('count-templates');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing template ID');
  return id;
}

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const templateId = getTemplateId(req);
  const body = UpdateTemplateSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('cycle_count_templates')
    .update({
      ...body,
      last_event_id: idempotencyKey,
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId)
    .eq('tenant_id', ctx.tenantId)
    .select()
    .single();

  if (error) {
    log.error('count_template.update_failed', { templateId, error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) throw AppError.notFound('Template not found');

  log.info('count_template.updated', { templateId });

  return {
    data,
    status: 200,
    events: [{
      event_name: 'cycle_count_template.updated',
      payload: { template_id: templateId, changes: Object.keys(body) },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/count-templates/:id' });

export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const templateId = getTemplateId(req);

  const inv = (supabase as any).schema('inventory');
  const { error } = await inv
    .from('cycle_count_templates')
    .delete()
    .eq('id', templateId)
    .eq('tenant_id', ctx.tenantId);

  if (error) {
    rethrowDeleteError(error, 'count template');
  }

  log.info('count_template.deleted', { templateId });

  return {
    data: { id: templateId },
    status: 200,
    events: [{
      event_name: 'cycle_count_template.deleted',
      payload: { template_id: templateId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/count-templates/:id' });
