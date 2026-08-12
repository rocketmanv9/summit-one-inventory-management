import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ENTITY_TYPES = ['catalog_item', 'asset', 'tool', 'vehicle', 'equipment'];

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const url = new URL(req.url);
  const entityType = url.searchParams.get('entity_type');
  const entityIds = url.searchParams.get('entity_ids');

  if (!entityType || !ENTITY_TYPES.includes(entityType)) {
    throw AppError.badRequest('entity_type is required and must be one of: ' + ENTITY_TYPES.join(', '));
  }
  if (!entityIds) {
    throw AppError.badRequest('entity_ids is required (comma-separated UUIDs)');
  }

  const ids = entityIds.split(',').map(id => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    return Response.json({ data: [] });
  }
  if (ids.length > 100) {
    throw AppError.badRequest('Maximum 100 entity_ids per request');
  }

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const { data, error } = await supabase
    .from('entity_images')
    .select('entity_id, storage_path')
    .eq('tenant_id', session.tenantId)
    .eq('entity_type', entityType)
    .in('entity_id', ids)
    .limit(100);

  if (error) throw AppError.internal(error.message);

  // Map storage paths to public URLs
  const results = (data || []).map(row => {
    const { data: urlData } = supabase.storage
      .from('entity-images')
      .getPublicUrl(row.storage_path);

    return {
      entity_id: row.entity_id,
      public_url: urlData.publicUrl,
    };
  });

  return Response.json({ data: results });
}, { serviceName: SERVICE_NAME });
