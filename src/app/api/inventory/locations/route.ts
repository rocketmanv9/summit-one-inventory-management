import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { createRoute } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('locations')
    .select('id, name, parent_location_id, active, address, location_type:location_types(id, name), max_capacity, capacity_uom_term_id')
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(200);

  if (error) {
    log.error('locations.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

// Permissive body (name required); preserves the prior client behavior of
// forwarding the location payload. Returns the joined row the page renders.
export const POST = createRoute({
  schema: 'inventory',
  table: 'locations',
  returning: '*, location_type:location_type_id(name)',
  bodySchema: z.object({ name: z.string().min(1) }).passthrough(),
});
