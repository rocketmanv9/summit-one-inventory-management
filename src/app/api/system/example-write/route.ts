import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'my-service';

/**
 * Example write route using the chassis session write factory.
 *
 * createSessionWriteRoute automatically enforces:
 *   - Session authentication via cookies (zero config)
 *   - Tenant-scoped Supabase client (auto-created from env vars)
 *   - Idempotency key validation (400 if missing)
 *   - Tenant-bound operation context with full tracing
 *   - Idempotency guard (atomic DB lock, replay on duplicate)
 *   - Traced fetch() injected for downstream service calls
 *   - Outbox event emission (TypeScript-enforced — you must return events[])
 *   - Structured logging with trace context
 *   - Trace headers on response (X-Trace-ID, X-Correlation-ID)
 *   - AppError catch → structured error JSON response (incl. ZodError → 400)
 *
 * Replace the schema, table name, event type, and business logic with your own.
 */

/** Validate request body with zod — ZodError is auto-caught as 400 by AppError.wrap() */
const CreateExampleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, fetch, supabase, idempotencyKey }) => {
  // Validate input — throws ZodError on invalid body (caught as 400 automatically)
  const body = CreateExampleSchema.parse(await req.json());

  // Insert into tenant-scoped table
  const { data, error } = await supabase
    .from('example_items')
    .upsert({ name: body.name, description: body.description })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  log.info('example.created', { recordId: data.id });

  return {
    data,
    status: 201,
    events: [{
      event_name: 'example.created',
      payload: data,
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/system/example-write',
});
