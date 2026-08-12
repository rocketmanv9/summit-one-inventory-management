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

  // Normalize DB columns/joins to the shape the page renders:
  // posting_status -> movement_state, reason -> reason_code,
  // source_ref_* -> source_document_*, and flatten the joined relations to the
  // plural keys (catalog_items/locations) the table reads.
  const movements = (data ?? []).map((m: any) => ({
    id: m.id,
    catalog_item_id: m.catalog_item_id,
    location_id: m.location_id,
    quantity_delta: m.quantity_delta,
    movement_type: m.movement_type,
    movement_state: m.posting_status,
    reason_code: m.reason,
    source_document_type: m.source_ref_type,
    source_document_id: m.source_ref_id,
    reversal_ref_id: m.reversal_ref_id,
    created_at: m.occurred_at ?? m.created_at,
    catalog_items: m.catalog_item ?? null,
    locations: m.location ?? null,
  }));

  return Response.json({ data: movements });
}, { serviceName: SERVICE_NAME });
