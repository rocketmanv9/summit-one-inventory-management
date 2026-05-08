import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const catalogItemId = url.searchParams.get('catalog_item_id');
  const locationId = url.searchParams.get('location_id');
  const movementType = url.searchParams.get('movement_type');
  const movementState = url.searchParams.get('movement_state');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  let query = inv
    .from('stock_movements')
    .select('*, catalog_item:catalog_items(id, name, sku), location:locations(id, name)')
    .order('occurred_at', { ascending: false })
    .limit(200);

  if (catalogItemId) query = query.eq('catalog_item_id', catalogItemId);
  if (locationId) query = query.eq('location_id', locationId);
  if (movementType) query = query.eq('movement_type', movementType);
  if (movementState) query = query.eq('posting_status', movementState);

  const { data, error } = await query;

  if (error) {
    log.error('movements.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
