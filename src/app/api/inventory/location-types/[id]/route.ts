import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segments = new URL(req.url).pathname.split('/');
  const idx = segments.indexOf('location-types');
  const id = segments[idx + 1];
  if (!id) throw AppError.badRequest('Missing location type id');
  return id;
}

// Optimistic concurrency: the caller passes the last_event_id it last read; the
// update/delete only applies if the row still has that value, then stamps a new
// one (the idempotency key). No match → 409, same as the prior client behavior.
const UpdateLocationTypeSchema = z.object({
  expected_last_event_id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  code: z.string().nullish(),
});

export const PATCH = createSessionWriteRoute(async ({ req, body, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const { expected_last_event_id, ...updates } = body;

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('location_types')
    .update({ ...updates, last_event_id: idempotencyKey })
    .eq('id', id)
    .eq('last_event_id', expected_last_event_id)
    .select('id, last_event_id')
    .maybeSingle();

  if (error) {
    log.error('location_type.update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) {
    throw AppError.conflict('Location type was updated by someone else. Please refresh and try again.');
  }

  return { data, status: 200, events: [] };
}, {
  bodySchema: UpdateLocationTypeSchema,
  emissionOwner: 'trigger',
  serviceName: SERVICE_NAME,
  scope: 'PATCH /api/inventory/location-types/[id]',
});

const DeleteLocationTypeSchema = z.object({
  expected_last_event_id: z.string().min(1),
});

export const DELETE = createSessionWriteRoute(async ({ req, body, log, supabase }) => {
  const id = extractId(req);

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('location_types')
    .delete()
    .eq('id', id)
    .eq('last_event_id', body.expected_last_event_id)
    .select('id')
    .maybeSingle();

  if (error) {
    log.error('location_type.delete_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) {
    throw AppError.conflict('Location type was updated by someone else. Please refresh and try again.');
  }

  return { data, status: 200, events: [] };
}, {
  bodySchema: DeleteLocationTypeSchema,
  emissionOwner: 'trigger',
  serviceName: SERVICE_NAME,
  scope: 'DELETE /api/inventory/location-types/[id]',
});
