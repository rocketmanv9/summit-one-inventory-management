import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ENTITY_TYPES = ['catalog_item', 'asset', 'tool', 'vehicle', 'equipment'] as const;

const DeleteSchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().uuid(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = DeleteSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  // Look up existing record
  const { data: existing } = await supabase
    .from('entity_images')
    .select('id, storage_path')
    .eq('tenant_id', tenantId)
    .eq('entity_type', body.entity_type)
    .eq('entity_id', body.entity_id)
    .limit(1)
    .single();

  if (!existing) throw AppError.notFound('No image found for this entity');

  // Remove from storage
  const { error: storageError } = await supabase.storage
    .from('entity-images')
    .remove([existing.storage_path]);

  if (storageError) {
    log.warn('entity_image.storage_delete_failed', { error: storageError.message });
  }

  // Delete metadata row
  const { error: dbError } = await supabase
    .from('entity_images')
    .delete()
    .eq('id', existing.id);

  if (dbError) throw AppError.internal(dbError.message);

  log.info('entity_image.deleted', {
    entity_type: body.entity_type,
    entity_id: body.entity_id,
  });

  return {
    data: { deleted: true },
    status: 200,
    events: [{
      event_name: 'entity_image.deleted',
      payload: {
        entity_type: body.entity_type,
        entity_id: body.entity_id,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, {
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/images/delete',
});
