import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ENTITY_TYPES = ['catalog_item', 'asset', 'tool', 'vehicle', 'equipment'] as const;

const UploadSchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().uuid(),
  image_data: z.string().min(1, 'image_data is required'),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = UploadSchema.parse(await req.json());

  // Decode base64 data URL
  const match = body.image_data.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) throw AppError.badRequest('Invalid image_data format — expected a base64 data URL');

  const base64 = match[1];
  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length > 5 * 1024 * 1024) {
    throw AppError.badRequest('Encoded image exceeds 5MB limit');
  }

  const tenantId = ctx.tenantId!;
  const storagePath = `${tenantId}/${body.entity_type}/${body.entity_id}.jpg`;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  // Upload to storage (upsert to handle replacement)
  const { error: uploadError } = await supabase.storage
    .from('entity-images')
    .upload(storagePath, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (uploadError) throw AppError.internal(`Storage upload failed: ${uploadError.message}`);

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('entity-images')
    .getPublicUrl(storagePath);

  const publicUrl = urlData.publicUrl;

  // Upsert metadata row
  const { data, error: dbError } = await supabase
    .from('entity_images')
    .upsert(
      {
        tenant_id: tenantId,
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        storage_path: storagePath,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,entity_type,entity_id' }
    )
    .select()
    .single();

  if (dbError) throw AppError.internal(dbError.message);

  log.info('entity_image.uploaded', {
    entity_type: body.entity_type,
    entity_id: body.entity_id,
  });

  return {
    data: { ...data, public_url: publicUrl },
    status: 201,
    events: [{
      event_name: 'entity_image.uploaded',
      payload: {
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        storage_path: storagePath,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/images/upload',
});
