import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
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

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('location_types')
    .select('*')
    .order('name', { ascending: true })
    .limit(100);

  if (error) {
    log.error('location_types.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

const CreateLocationTypeSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  code: z.string().nullish(),
});

// location_types has a DB trigger that emits to the outbox → emissionOwner: 'trigger'.
export const POST = createSessionWriteRoute(async ({ body, log, supabase, idempotencyKey }) => {
  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('location_types')
    .insert({ ...body, last_event_id: idempotencyKey })
    .select('id, last_event_id')
    .single();

  if (error) {
    log.error('location_type.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return { data, status: 201, events: [] };
}, {
  bodySchema: CreateLocationTypeSchema,
  emissionOwner: 'trigger',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/location-types',
});
