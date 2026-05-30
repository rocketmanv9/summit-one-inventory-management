import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('transfers') + 1];
  if (!id) throw AppError.badRequest('Missing transfer id');
  return id;
}

const BodySchema = z.object({ expected_last_event_id: z.string().min(1) });

// Cancel a draft transfer (OCC). transfer trigger owns emission.
export const POST = createSessionWriteRoute(async ({ req, body, log, supabase, idempotencyKey }) => {
  const transferId = extractId(req);
  const { expected_last_event_id } = body as z.infer<typeof BodySchema>;
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.from('transfers')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), last_event_id: idempotencyKey })
    .eq('id', transferId).eq('last_event_id', expected_last_event_id)
    .select('id').maybeSingle();
  if (error) { log.error('transfer.cancel_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.conflict('Transfer was updated by someone else. Please refresh and try again.');

  return { data: { id: transferId }, status: 200, events: [] };
}, { bodySchema: BodySchema, emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/transfers/[id]/cancel' });
